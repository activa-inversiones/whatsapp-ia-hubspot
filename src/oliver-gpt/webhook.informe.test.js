// webhook.informe.test.js — [2026-08-24]
//
// EL PRIMER TEST DE COMPORTAMIENTO DEL ENVIO DEL INFORME TERMICO. Hasta hoy este camino
// —el que le manda un documento firmado a un cliente real— solo tenia tests que miraban
// el CODIGO FUENTE con expresiones regulares. Eso alcanza para ver si una linea existe;
// no alcanza para ver si el envio ocurre una vez, ninguna o dos.
//
// Y no era teorico. Dos defectos MEDIDOS EN PRODUCCION el 24-ago, que ningun test de
// fuente podia cazar:
//
//   1. EL DUPLICADO. Los dos clientes atendidos ese dia recibieron su informe DOS veces
//      (folios CM-FR-006-2026-0001/0002 y 0003/0004), con 90 y 310 ms entre emisiones.
//      Dos `calcular_cotizacion` del mismo turno —una por ventana del proyecto— pasaban
//      los dos por un candado que hacia leer-y-despues-escribir con `await` en medio.
//
//   2. EL INFORME INVISIBLE. La BD decia "entregado" y Meta habia aceptado los PDF, pero
//      en `conversation_messages` no habia NI UNA FILA del informe. El dueno miro el
//      cockpit y concluyo, razonablemente, que no habia llegado. La propuesta (CM-FR-004)
//      si se ve porque en junio le pusieron un espejo explicito; el informe nunca lo tuvo.
//      Un envio que el sistema no puede mostrar es, para quien opera, un envio que no paso.
//
// Hermetico: `global.fetch` se anula y todo lo que toca red se inyecta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook } from './webhook.js';

// Nada de este test sale a la red. Lo que igual la intente (catalogo de vidrios,
// correlativo ISO) esta envuelto en try/catch y degrada, que es justo lo que queremos
// ejercitar: el informe sale igual.
global.fetch = async () => { throw new Error('sin red en tests'); };

const DATOS_COMUNA = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2,
  zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27',
};

const VENTANAS = [
  { id: 'V1', producto: 'Ventana PVC S60 corredera', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', ambiente: 'Living', cantidad: 1, uw: 2.71 },
  { id: 'V2', producto: 'Ventana PVC H98 corredera', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw: null },
];

function makeRes() {
  return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } };
}

/**
 * @param disparos  cuantas veces el turno llama a enviarInformeTermico. 2 = el caso real
 *                  del proyecto de dos ventanas que produjo el duplicado.
 */
function makeDeps({ disparos = 1, envioOk = true, overrides = {} } = {}) {
  const spy = { docsEnviados: [], convEvents: [], pdfArgs: [], textos: [] };
  const estado = new Map();
  let tokenSeq = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());

  const deps = {
    conv: new Map(), seen: new Set(),
    dormir: async () => {},                       // sin esperas humanas en test

    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }),
    // Leer-calcular-escribir en un paso, sin await: la acumulacion de ventanas tenia la
    // misma carrera que el candado y perdia las ventanas de las cotizaciones hermanas.
    fusionarEstado: (k, calcular, ttl = 300) => {
      const e = estado.get(k);
      const actual = vigente(e) ? e.valor : null;
      const { valor, guardar } = calcular(actual) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? actual : valor;
    },
    // El test-and-set atomico, con la MISMA regla que el real: ni un await adentro.
    reservarEstado: (k, ttl = 300) => {
      if (vigente(estado.get(k))) return null;
      const token = `t${++tokenSeq}`;
      estado.set(k, { valor: token, expira: Date.now() + ttl * 1000 });
      return token;
    },
    liberarReserva: (k, token) => {
      const e = estado.get(k);
      if (!token || !vigente(e) || e.valor !== token) return false;
      estado.delete(k); return true;
    },

    parseInbound: () => ({ ok: true, from: '56995420506', text: 'dos ventanas', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async (to, text) => { spy.textos.push(text); return { ok: true, msgId: 'm1' }; },

    // ── lo que hoy NO es inyectable y por eso este camino no se podia probar ──
    pedirInformeComuna: async () => DATOS_COMUNA,
    generarInformeTermicoPdf: async (datos, opts) => { spy.pdfArgs.push(opts); return Buffer.alloc(1024, 7); },
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,

    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => {
      spy.docsEnviados.push({ to, mediaId, filename });
      return envioOk ? { ok: true, msgId: 'doc.1' } : { ok: false, error: 'Meta rechazo' };
    },

    handleTurn: async ({ userText, state, toolCtx }) => {
      // El turno dispara el informe tantas veces como ventanas cotizo, SIN await —
      // exactamente como lo hace `calcular_cotizacion` en tools.js.
      // 🔴 [2026-08-24 · Codex, 2a pasada] UNA VENTANA POR LLAMADA, que es lo que hace
      // `calcular_cotizacion` de verdad: `d.items` se arma con UNA sola partida
      // (tools.js:708), asi que cada invocacion manda su ventana y nada mas. El fake
      // anterior inyectaba el array COMPLETO en cada disparo — o sea probaba un camino
      // que no existe, y por eso los tests daban verde sobre una funcionalidad rota.
      for (let i = 0; i < disparos; i++) {
        const v = VENTANAS[i] || VENTANAS[0];
        toolCtx.enviarInformeTermico('Temuco', {
          glassLabel: v.vidrio, uw: v.uw, producto: v.producto, ventanas: [v],
        });
      }
      return { reply: 'Listo', history: [], toolCalls: [], state: { ...state, name: 'Vanessa Wainer' } };
    },

    bridge: {
      getConversationControl: async () => ({ ai_paused: false, operator_status: 'ai' }),
      pushConversationEvent: async (p) => { spy.convEvents.push(p); return { ok: true }; },
      pushLeadEvent: async () => ({ ok: true }),
      pushQuoteEvent: async () => ({ ok: true }),
    },
    notifyHighValue: async () => ({ sent: true }),
  };
  Object.assign(deps, overrides);
  return { deps, spy };
}

/** El hook es fire-and-forget: el webhook vuelve antes. Se espera a que decante. */
async function esperar(cond, ms = 3000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

test('camino feliz — el informe sale UNA vez y con el proyecto completo', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el informe tiene que salir');
  await new Promise((r) => setTimeout(r, 120));                 // margen por si saliera otro

  assert.equal(spy.docsEnviados.length, 1, 'exactamente un documento');
  assert.match(spy.docsEnviados[0].filename, /^Informe-Termico-Temuco\.pdf$/);
  assert.deepEqual(spy.pdfArgs[0].ventanas, [VENTANAS[0]],
    'con una sola cotizacion, el informe lleva esa ventana');
});

test('🔴 EL DUPLICADO — dos cotizaciones del mismo turno mandan UN solo informe', async () => {
  // Reproduccion del incidente: folios 0003 y 0004 al mismo cliente con 90 ms de
  // diferencia. Con el candado leer-luego-escribir este test daba 2.
  const { deps, spy } = makeDeps({ disparos: 2 });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(spy.docsEnviados.length, 1, 'el cliente recibe UN informe, no dos');
});

test('🔴 EL INFORME INVISIBLE — queda registrado en la conversacion, como la propuesta', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  // [Codex · P2] Se espera EL DOCUMENTO, no "cualquier evento con este source": el aviso
  // de texto llega antes y satisfacia el ancla mientras el envio seguia en curso. Un test
  // que mira demasiado temprano falla —o peor, pasa— por razones que no son la que prueba.
  assert.ok(await esperar(() => spy.convEvents.some((e) => e.message_type === 'document'
    && e.metadata?.source === 'oliver_gpt_informe_termico')), 'el espejo del documento');

  const doc = spy.convEvents.find((e) => e.message_type === 'document'
    && e.metadata?.source === 'oliver_gpt_informe_termico');
  assert.ok(doc, 'sin este evento el informe es invisible en el cockpit');
  assert.equal(doc.direction, 'outbound');
  assert.equal(doc.actor_type, 'ai');
  assert.match(doc.body, /Informe t[eé]rmico/i, 'el operador tiene que leer QUE se mando');
  assert.ok(doc.metadata.informe_number, 'y con que folio, que es la evidencia ISO');

  const aviso = spy.convEvents.find((e) => e.direction === 'outbound'
    && /Deme un momento/.test(e.body || ''));
  assert.ok(aviso, 'el aviso previo tambien: si no, el documento aparece sin contexto');
});

test('🔒 si Meta RECHAZA, no se le miente al cockpit y el proximo turno reintenta', async () => {
  const { deps, spy } = makeDeps({ envioOk: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0));
  await new Promise((r) => setTimeout(r, 150));

  const doc = spy.convEvents.find((e) => e.metadata?.source === 'oliver_gpt_informe_termico'
    && e.message_type === 'document');
  assert.equal(doc, undefined, 'registrar una entrega que no ocurrio es peor que no registrar');

  // Y el candado corto quedo LIBRE: un envio fallido no puede dejar al cliente sin
  // informe hasta que venza el TTL. Ese bug ya bloqueo a 4 clientes por 30 dias.
  const { deps: deps2, spy: spy2 } = makeDeps({ envioOk: true });
  deps2.leerEstado = deps.leerEstado; deps2.escribirEstado = deps.escribirEstado;
  deps2.reservarEstado = deps.reservarEstado; deps2.liberarReserva = deps.liberarReserva;
  await handleWebhook({ body: {} }, makeRes(), deps2);
  assert.ok(await esperar(() => spy2.docsEnviados.length > 0),
    'el reintento del proximo turno tiene que poder tomar el candado de nuevo');
});

test('🔒 [Codex · P1] si algo LANZA a mitad, el candado no queda trabado 5 minutos', async () => {
  // EL AGUJERO QUE CAZO CODEX: la reserva se tomaba y las salidas por `return` la soltaban,
  // pero una EXCEPCION no. Si `generarInformeTermicoPdf` (o THERMAL, o el envio) lanzaba,
  // el candado quedaba puesto sin que nadie hubiera mandado nada: el cliente sin informe y
  // el reintento bloqueado hasta que venciera el TTL.
  const { deps, spy } = makeDeps({
    overrides: { generarInformeTermicoPdf: async () => { throw new Error('pdfkit exploto'); } },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(spy.docsEnviados.length, 0, 'no salio nada, como corresponde');

  // El proximo turno TIENE que poder intentarlo de nuevo.
  const { deps: deps2, spy: spy2 } = makeDeps();
  deps2.leerEstado = deps.leerEstado; deps2.escribirEstado = deps.escribirEstado;
  deps2.reservarEstado = deps.reservarEstado; deps2.liberarReserva = deps.liberarReserva;
  await handleWebhook({ body: {} }, makeRes(), deps2);
  assert.ok(await esperar(() => spy2.docsEnviados.length > 0),
    'una excepcion no puede dejar al cliente esperando 5 minutos');
});

test('🔒 tras una entrega CONFIRMADA la reserva no se suelta sola', async () => {
  // El reverso del test anterior: el `finally` no puede soltar la reserva cuando el envio
  // SI ocurrio, o se reabriria la ventana del duplicado justo despues de mandar.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0));
  await new Promise((r) => setTimeout(r, 100));

  const { deps: deps2, spy: spy2 } = makeDeps();
  deps2.leerEstado = deps.leerEstado; deps2.escribirEstado = deps.escribirEstado;
  deps2.reservarEstado = deps.reservarEstado; deps2.liberarReserva = deps.liberarReserva;
  await handleWebhook({ body: {} }, makeRes(), deps2);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(spy2.docsEnviados.length, 0, 'el candado de 30 dias tiene que frenar el segundo');
});

test('🔴 [Codex · 2a pasada] DOS cotizaciones = UN informe con LAS DOS ventanas', async () => {
  // EL HALLAZGO QUE DESTAPO QUE EL ARREGLO NO ARREGLABA NADA. `calcular_cotizacion` cotiza
  // UNA partida por llamada (tools.js:708 arma `items: [{...}]`), asi que un cliente con
  // dos ventanas produce DOS llamadas, cada una con SU ventana.
  //
  // Asi se lee la evidencia real de produccion: los folios 0003 (Uw 2,71) y 0004 (sin Uw)
  // del mismo cliente NO eran el mismo informe repetido — eran la ventana 1 y la ventana 2,
  // cada una en su propio documento. Con el candado y sin acumular, ese cliente habria
  // recibido UN informe con UNA sola ventana: peor cobertura que antes del arreglo.
  //
  // Lo que se le promete al dueño es "las 8 ventanas en UN informe", asi que las sucesivas
  // cotizaciones tienen que ACUMULARSE, no reemplazarse ni bloquearse.
  const { deps, spy } = makeDeps({ disparos: 2 });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0));
  await new Promise((r) => setTimeout(r, 250));

  assert.equal(spy.docsEnviados.length, 1, 'un solo documento');
  assert.deepEqual(spy.pdfArgs[spy.pdfArgs.length - 1].ventanas, VENTANAS,
    'y ese documento tiene que llevar LAS DOS ventanas del proyecto');
});

test('🔒 [Codex · 2a pasada] si Meta rechaza el AVISO, tampoco se registra', async () => {
  // El espejo del documento ya exigia entrega confirmada, pero el del aviso ignoraba el
  // resultado de `enviarSinPausa` y registraba igual. El operador veia en el cockpit un
  // mensaje que el cliente nunca recibio — el mismo error que se corrigio al lado.
  const { deps, spy } = makeDeps({
    overrides: { sendWhatsAppText: async () => ({ ok: false, error: 'Meta rechazo texto' }) },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el informe igual se manda');
  await new Promise((r) => setTimeout(r, 150));

  const aviso = spy.convEvents.find((e) => /Deme un momento/.test(e.body || ''));
  assert.equal(aviso, undefined, 'un mensaje que no salio no puede figurar en la conversacion');
  // El documento SI: su envio es independiente y se confirmo aparte.
  assert.ok(spy.convEvents.some((e) => e.message_type === 'document'
    && e.metadata?.source === 'oliver_gpt_informe_termico'));
});

test('🔴 [Codex 3a] una ventana que llega TARDE igual entra al informe', async () => {
  // Las tools corren secuencialmente: la ultima partida de un proyecto largo puede
  // terminar despues de los tiempos humanos. Con una sola foto quedaba afuera del
  // documento y nadie se enteraba. Ahora se relee hasta que el proyecto deja de crecer.
  // `dormir` real pero corto: con el instantaneo del resto de los tests, las vueltas de
  // estabilizacion pasan volando y no le dan tiempo a nadie — el test no probaria nada.
  const { deps, spy } = makeDeps({ overrides: { dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms || 0, 40))) } });
  const tercera = { id: 'V3', producto: 'Fijo S60', medidas: '600x600mm', vidrio: 'DVH 5/12/5', ambiente: 'Baño', cantidad: 1, uw: 2.9 };
  const original = deps.handleTurn;
  deps.handleTurn = async (args) => {
    const r = await original(args);
    // La cotizacion lenta: llega despues de que el hook ya tomo su primera lectura.
    setTimeout(() => {
      args.toolCtx.enviarInformeTermico('Temuco', {
        glassLabel: tercera.vidrio, uw: tercera.uw, producto: tercera.producto, ventanas: [tercera],
      });
    }, 60);
    return r;
  };
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0, 6000));
  await new Promise((r) => setTimeout(r, 200));

  const ultimas = spy.pdfArgs[spy.pdfArgs.length - 1].ventanas;
  assert.ok(ultimas.some((v) => v.medidas === tercera.medidas),
    'la ventana rezagada tiene que estar en el documento que se mando');
});
