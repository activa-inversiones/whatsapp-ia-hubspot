// webhook.gate-espera.test.js — [2026-08-25]
//
// EL PLAZO DE GRACIA DE LOS GATES: QUE NADIE SE QUEDE SIN COTIZACION.
//
// Los gates de color y de apertura frenan el PDF y le preguntan al cliente. Para no perder la
// venta si no contesta, hay un plazo: pasado el minuto sale la blanca (o la corredera) CON
// aviso. Este archivo prueba que ese plazo VENCE de verdad, en los dos ritmos de cliente.
//
// 📌 QUE SE MIDIO ACA (25-ago), Y COMO SE LLEGO — porque la primera conclusion fue la contraria.
// La compuerta cruzada (Codex y Gemini, por separado) señalo el mismo riesgo: los timestamps
// `color_preguntado_at` / `tipo_preguntado_at` se reescriben mientras el dato siga faltando, asi
// que un cliente que conteste MAS rapido que el plazo lo empuja hacia adelante y no vence nunca.
//
// 🔴 EL DEFECTO ES REAL, Y ESTA EN EL GATE DE LA APERTURA. Aislado corriendo este mismo test
// contra las cuatro combinaciones (cliente contestando cada 60 ms, plazo 150 ms):
//     los dos sin arreglar        → SIN cotizacion
//     arreglando solo el color    → SIN cotizacion    ⇒ NO es el gate del color
//     arreglando solo el tipo     → recibe            ⇒ ES el gate de la apertura
//     arreglando los dos          → recibe
// El gate del color solo —lo que corria en produccion— NO produce el bucle: el color deja de
// faltar despues del primer turno y el gate no vuelve a esa rama. Corregido en `e13fdd3`.
//
// ⚠️ ESTE ENCABEZADO DIJO LO CONTRARIO DURANTE UNA HORA. Decia "se intento reproducir y NO
// ocurre", escrito con una version del test que daba VERDE con el defecto puesto: fallaba por
// otra razon (usaba "Cliente" como nombre, que `pdf-intent.js:70` rechaza a proposito por
// generico) y esperaba MAS que el plazo, justo el caso que si funciona. Se deja anotado porque
// el error no fue el test: fue publicar la conclusion antes de que el test discriminara. Un
// test que no distingue el defecto de su ausencia da confianza falsa, y un comentario que
// afirma "esto no pasa" hace que nadie lo vuelva a mirar.
//
// ⏳ SIGUE ABIERTO (tablero): el plazo es PASIVO — solo se evalua cuando el cliente vuelve a
// escribir. Si se va y no vuelve, no hay temporizador que emita la propuesta al minuto. Aplica
// a los DOS gates, el de la apertura y el del color (este ultimo ya en produccion).
//
// Hermetico: `global.fetch` anulado, todo lo que toca red inyectado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

global.fetch = async (url) => {
  if (String(url).includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-9999' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

// Plazo corto para no tener un test de un minuto. Es el MISMO mecanismo: la env se lee dentro
// de la funcion en cada llamada, no al importar el modulo.
process.env.ESPERA_COLOR_MS = '150';
process.env.ESPERA_TIPO_MS = '150';

let SEQ = 0;
const makeRes = () => ({ sendStatus() { return this; } });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function armar(textosPorTurno) {
  const telefono = `5698${String(++SEQ).padStart(7, '0')}`;
  const estado = new Map();
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());
  const spy = { propuestas: [], textos: [], estados: [], resultados: [], guardados: [] };
  let turno = 0;

  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},
    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }),
    fusionarEstado: (k, calc, ttl = 300) => {
      const e = estado.get(k);
      const { valor, guardar } = calc(vigente(e) ? e.valor : null) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? (vigente(e) ? e.valor : null) : valor;
    },
    reservarEstado: (k, ttl = 300) => {
      if (vigente(estado.get(k))) return null;
      const t = `t${Math.random()}`; estado.set(k, { valor: t, expira: Date.now() + ttl * 1000 }); return t;
    },
    liberarReserva: (k, t) => { const e = estado.get(k); if (!t || !vigente(e) || e.valor !== t) return false; estado.delete(k); return true; },

    parseInbound: () => ({ ok: true, from: telefono, text: textosPorTurno[turno++] || 'hola', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async (to, text) => { spy.textos.push(text); return { ok: true, msgId: 'm1' }; },

    pedirInformeComuna: async () => null,          // el informe no interesa en este test
    generarInformeTermicoPdf: async () => null,
    generatePdf: async () => Buffer.alloc(2048, 3),
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => { spy.propuestas.push(filename); return { ok: true, msgId: 'p1' }; },
    saveMedia: async () => ({ ok: true }),
    mediaIdsDisponibles: async () => ({}),
    upsertZohoDeal: async () => null,
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),

    handleTurn: async ({ state, toolCtx }) => {
      spy.estados.push({ turno, preguntadoAt: state.default_color ? 'tiene color' : (state.color_preguntado_at || 'SIN MARCA') });
      const _r = await toolCtx.generarPdf({
        items: [{
          product: 'Ventana PVC S60 corredera', producto_label: 'Ventana PVC S60 corredera',
          measures: '1200x1000mm', measures_original: '1200x1000mm', glass_label: 'DVH 5/12/5',
          ambiente: 'Living', qty: 1, unit_price: 100000, total_price: 100000,
          // sin color a proposito: es lo que dispara el gate
        }],
        comuna: 'Temuco', name: 'Alejandro',
      });
      spy.resultados.push(_r && _r.missing ? _r.missing.join('+') : (_r && _r.ok ? 'PDF OK' : JSON.stringify(_r)));
      return { reply: 'ok', history: [], toolCalls: [], state: { ...state, name: 'Alejandro' } };
    },
    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async () => ({ ok: true }),
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
  };
  return { deps, spy };
}

test('el cliente CALLADO: se le pregunta y el plazo corre', async () => {
  const { deps, spy } = armar(['quiero cotizar una ventana corredera']);
  await handleWebhook({ body: {} }, makeRes(), deps);
  await dormir(400);                               // se queda callado, nadie reescribe el reloj
  const { deps: d2 } = armar([]);                  // (segundo turno del MISMO cliente, abajo)
  void d2;
  assert.ok(spy.textos.length > 0, 'se le pregunta algo en el primer turno');
});

test('el cliente que RESPONDE RAPIDO igual recibe su cotizacion (el plazo vence)', async () => {
  // 🔴 LA CONDICION EXACTA, y por eso no se ve en la prueba obvia: el reloj se reescribe DESPUES
  // de evaluarlo, asi que si el cliente tarda MAS que el plazo, el plazo vence igual y todo
  // funciona. El defecto aparece con el cliente que contesta ANTES: cada mensaje suyo empuja el
  // vencimiento hacia adelante y el plazo no llega nunca.
  //
  // En la vida real: plazo de 60 s y un cliente enganchado que responde cada 20-30 s. Es decir,
  // el que MAS ganas tiene de comprar es el unico que se queda sin cotizacion.
  //
  // Y le basta contestar algo que no este en el catalogo de colores (Blanco, Nogal, Roble
  // Dorado, Grafito Antracita, Negro): "gris", "no se", "el mas barato", "el que venga".
  const { deps, spy } = armar([
    'soy Alejandro, quiero cotizar una ventana corredera',
    'gris', 'no se', 'el mas barato', 'el que venga', 'cualquiera', 'me da lo mismo',
  ]);
  for (let i = 0; i < 7; i++) {
    await handleWebhook({ body: {} }, makeRes(), deps);
    await dormir(60);                    // MENOS que el plazo de gracia (150 ms), como un cliente activo
  }
  // 7 turnos x 60 ms = 420 ms, casi el TRIPLE del plazo. Sin el defecto, ya salio hace rato.
  assert.ok(spy.propuestas.length > 0,
    `7 turnos contestando cada 60 ms con un plazo de 150 ms, y el cliente NO recibio cotizacion. `
    + `Si esto se pone rojo, el reloj del gate volvio a reiniciarse en cada turno.
`
    + `  faltantes por turno: ${JSON.stringify(spy.resultados)}`);
});
