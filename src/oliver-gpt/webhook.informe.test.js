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
// Fetch enrutado. Solo se atiende el CORRELATIVO de la propuesta, porque sin folio ISO el
// PDF no se emite y el informe —que ahora cuelga de la propuesta entregada— no llegaria a
// existir: el test estaria midiendo el correlativo, no el informe.
// Todo lo demas responde "no disponible" para ejercitar los caminos de degradacion, que es
// como se comporta el sistema cuando sales-os o THERMAL no contestan.
global.fetch = async (url) => {
  if (String(url).includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-9999' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

const DATOS_COMUNA = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2,
  zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27',
};

const VENTANAS = [
  { id: 'V1', producto: 'Ventana PVC S60 corredera', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', ambiente: 'Living', cantidad: 1, uw: 2.71 },
  { id: 'V2', producto: 'Ventana PVC H98 corredera', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw: null },
];

let SECUENCIA = 0;

function makeRes() {
  return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } };
}

/**
 * @param disparos  cuantas veces el turno llama a enviarInformeTermico. 2 = el caso real
 *                  del proyecto de dos ventanas que produjo el duplicado.
 */
function makeDeps({ disparos = 1, envioOk = true, ventanas = null, overrides = {} } = {}) {
  // Telefono propio por test: el candado de 30 dias va por numero, y compartirlo hacia que
  // el segundo test en adelante quedara bloqueado por el informe del primero.
  const telefono = `5699${String(++SECUENCIA).padStart(7, '0')}`;
  const spy = { upserts: [], escrituras: [], docsEnviados: [], propuestas: [], convEvents: [], pdfArgs: [], textos: [], adjuntosZoho: [], notasZoho: [] };
  const estado = new Map();
  let tokenSeq = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());

  const deps = {
    // 🔴 AISLAMIENTO POR TEST. Sin `locks` propio, todos los tests comparten el mutex
    // global por telefono: mientras un despacho fire-and-forget del test anterior sigue
    // corriendo, el siguiente turno queda encolado y el test agota su espera. Se veia como
    // "los primeros pasan y los ultimos no", que es la firma del estado compartido.
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},                       // sin esperas humanas en test

    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => { spy.escrituras.push([k, v]); estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); },
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

    parseInbound: () => ({ ok: true, from: telefono, text: 'dos ventanas', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async (to, text) => { spy.textos.push(text); return { ok: true, msgId: 'm1' }; },

    // ── lo que hoy NO es inyectable y por eso este camino no se podia probar ──
    pedirInformeComuna: async () => DATOS_COMUNA,
    generarInformeTermicoPdf: async (datos, opts) => { spy.pdfArgs.push(opts); return Buffer.alloc(1024, 7); },
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,

    upsertZohoDeal: async (...a) => { spy.upserts.push(a); return 'deal.777'; },
    addZohoNote: async (...a) => { spy.notasZoho.push(a); return { ok: true }; },
    attachPdfToDeal: async (dealId, buf, filename) => {
      spy.adjuntosZoho.push({ dealId, bytes: buf?.length || 0, filename });
      return { ok: true };
    },
    // La PROPUESTA tambien pasa por aca: se separan por nombre de archivo, porque contar
    // los dos juntos daria "2 documentos" y el test parecia verde por el motivo equivocado.
    generatePdf: async () => Buffer.alloc(2048, 3),
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => {
      const esInforme = /^Informe-Termico/.test(filename || '');
      (esInforme ? spy.docsEnviados : spy.propuestas).push({ to, mediaId, filename });
      if (!esInforme) return { ok: true, msgId: 'prop.1' };
      return envioOk ? { ok: true, msgId: 'doc.1' } : { ok: false, error: 'Meta rechazo' };
    },

    handleTurn: async ({ userText, state, toolCtx }) => {
      // 🔴 [2026-08-24] EL INFORME SALE CON LA PROPUESTA. El cliente arma su proyecto a lo
      // largo de VARIOS mensajes (Alejandro dio sus 10 ventanas en 5 turnos distintos), asi
      // que ni una cotizacion ni un turno tienen el proyecto completo. La propuesta SI: el
      // sistema ya acumula las partidas entre turnos en `pending_quote.items`.
      if (disparos > 0) {
        await toolCtx.generarPdf({
          items: (ventanas || VENTANAS).slice(0, disparos).map((v) => ({
            product: v.producto, producto_label: v.producto, measures: v.medidas,
            measures_original: v.medidas, glass_label: v.vidrio, ambiente: v.ambiente,
            qty: v.cantidad, unit_price: 100000, total_price: 100000,
            termico: v.uw === null ? null : { uw: v.uw },
          })),
          comuna: 'Temuco', name: 'Alejandro',
        });
      }
      return { reply: 'Listo', history: [], toolCalls: [], state: { ...state, name: 'Alejandro' } };
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

/**
 * Las medidas identifican la ventana; el `id` ya no viaja (lo asigna resumenVentanas).
 * Se normaliza el sufijo "mm" porque el guard de medidas del PDF reescribe
 * `measures_original` y puede devolverlas sin unidad: comparar el texto crudo hacia fallar
 * un test que estaba mirando el comportamiento correcto.
 */
const medidasDe = (vs) => (vs || []).map((v) => String(v.medidas || '').replace(/mm$/, ''));

async function esperar(cond, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

/* =========================================================================
 * EL PROYECTO COMPLETO
 * ========================================================================= */

test('🔴 el informe lleva TODAS las ventanas de la propuesta, y sale UNA vez', async () => {
  const { deps, spy } = makeDeps({ disparos: 2 });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el informe tiene que salir');
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(spy.docsEnviados.length, 1, 'exactamente un informe');
  assert.equal(spy.propuestas.length, 1, 'y una propuesta');
  assert.match(spy.docsEnviados[0].filename, /^Informe-Termico-Temuco\.pdf$/);
  assert.deepEqual(medidasDe(spy.pdfArgs.at(-1).ventanas), medidasDe(VENTANAS),
    'las MISMAS ventanas que declara la propuesta');
});

test('🔴 EL CASO ALEJANDRO: 10 ventanas listadas en 5 mensajes → informe con las 10', async () => {
  // El defecto que motivo todo: su informe salio con UNA ventana de diez. El cliente arma
  // el proyecto a lo largo de VARIOS mensajes, asi que ni una cotizacion ni un turno lo
  // tienen completo. La propuesta SI —el sistema acumula las partidas entre turnos desde
  // jun-2026— y de ahi sale ahora el informe.
  const diez = [
    { producto: 'Corredera S60', medidas: '2500x2000mm', vidrio: 'DVH 5/12/5', ambiente: 'Living', cantidad: 1, uw: 2.7 },
    ...[1, 2, 3].map((i) => ({ producto: 'Fijo S60', medidas: `200${i}x600mm`, vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw: 2.8 })),
    ...[1, 2, 3, 4].map((i) => ({ producto: 'Fijo S60', medidas: `150${i}x350mm`, vidrio: 'DVH 5/12/5', ambiente: 'Comedor', cantidad: 1, uw: null })),
    ...[1, 2].map((i) => ({ producto: 'Proyectante S60', medidas: `80${i}x500mm`, vidrio: 'DVH 5/12/5', ambiente: 'Bano', cantidad: 1, uw: 2.9 })),
  ];
  const { deps, spy } = makeDeps({ ventanas: diez, disparos: diez.length });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0));

  assert.deepEqual(medidasDe(spy.pdfArgs.at(-1).ventanas), medidasDe(diez),
    'las diez, en el orden del proyecto');
});

test('sin propuesta entregada NO hay informe: no se le promete nada a nadie', async () => {
  const { deps, spy } = makeDeps({ disparos: 0 });
  await handleWebhook({ body: {} }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(spy.docsEnviados.length, 0);
});

/* =========================================================================
 * VISIBILIDAD — el defecto que hizo preguntar "¿por que no llego?"
 * ========================================================================= */

test('🔴 EL INFORME INVISIBLE — queda registrado en la conversacion, como la propuesta', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.convEvents.some((e) => e.message_type === 'document'
    && e.metadata?.source === 'oliver_gpt_informe_termico')), 'el espejo del documento');

  const doc = spy.convEvents.find((e) => e.message_type === 'document'
    && e.metadata?.source === 'oliver_gpt_informe_termico');
  assert.equal(doc.direction, 'outbound');
  assert.equal(doc.actor_type, 'ai');
  assert.match(doc.body, /Informe t[eé]rmico/i, 'el operador tiene que leer QUE se mando');
  assert.ok(doc.metadata.informe_number, 'y con que folio, que es la evidencia ISO');

  const aviso = spy.convEvents.find((e) => e.direction === 'outbound'
    && /Deme un momento/.test(e.body || ''));
  assert.ok(aviso, 'el aviso previo tambien: si no, el documento aparece sin contexto');
});

test('🔴 el PDF del informe queda ARCHIVADO, igual que la cotizacion', async () => {
  // Reclamo del dueno, textual: "yo abro el sistema y deberia estar guardado... tiene que
  // estar almacenado, al lado de la cotizacion". Del informe solo quedaba folio y hash.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  // La PROPUESTA tambien se adjunta al Deal: se busca el del informe por su nombre, o el
  // test pasaria mirando el archivo equivocado.
  const delInforme = () => spy.adjuntosZoho.find((a) => /^Informe-Termico/.test(a.filename || ''));
  assert.ok(await esperar(() => !!delInforme()), 'el informe tiene que archivarse');

  const adj = delInforme();
  assert.equal(adj.dealId, 'deal.777');
  assert.ok(adj.bytes > 0, 'el PDF de verdad, no un puntero');
  assert.match(adj.filename, /Informe-Termico.*\.pdf$/, 'distinguible de la propuesta');
});

/* =========================================================================
 * NADA SE DA POR ENTREGADO SIN CONFIRMACION
 * ========================================================================= */

test('🔒 si Meta RECHAZA el informe: ni cockpit, ni archivo', async () => {
  const { deps, spy } = makeDeps({ envioOk: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'se intento el envio');
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(spy.convEvents.find((e) => e.metadata?.source === 'oliver_gpt_informe_termico'
    && e.message_type === 'document'), undefined,
  'registrar una entrega que no ocurrio es peor que no registrar');
  assert.equal(spy.adjuntosZoho.filter((a) => /^Informe-Termico/.test(a.filename || '')).length, 0,
    'ni se archiva copia de algo que no salio');
});

test('🔒 si Meta rechaza el AVISO, tampoco se registra', async () => {
  const { deps, spy } = makeDeps({
    overrides: { sendWhatsAppText: async () => ({ ok: false, error: 'Meta rechazo texto' }) },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el informe igual se manda');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(spy.convEvents.find((e) => /Deme un momento/.test(e.body || '')), undefined,
    'un mensaje que no salio no puede figurar en la conversacion');
});

test('🔒 si Zoho falla, el cliente NO pierde su informe', async () => {
  // El archivo es trazabilidad NUESTRA; el informe es del cliente. Nunca al reves.
  const { deps, spy } = makeDeps({
    overrides: { attachPdfToDeal: async () => { throw new Error('Zoho caido'); } },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el envio no depende de Zoho');
});

test('🔒 si el informe explota, la PROPUESTA igual sale', async () => {
  // La regla dura del proyecto: el informe nunca puede tumbar ni demorar el camino del precio.
  const { deps, spy } = makeDeps({
    overrides: { generarInformeTermicoPdf: async () => { throw new Error('pdfkit exploto'); } },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(spy.propuestas.length, 1, 'el cliente recibe su precio igual');
  assert.equal(spy.docsEnviados.length, 0);
});

/* =========================================================================
 * SIN DUPLICADOS
 * ========================================================================= */

test('🔴 dos propuestas seguidas al mismo cliente = UN solo informe', async () => {
  // El candado de 30 dias. Un informe repetido deja de ser un informe y pasa a ser spam.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0));
  await new Promise((r) => setTimeout(r, 200));

  // Segunda vuelta del MISMO cliente. (La propuesta tiene su propio guard anti-duplicado
  // de 2 min, asi que puede no reemitirse; lo que se prueba aca es el informe.)
  await handleWebhook({ body: {} }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(spy.docsEnviados.length, 1, 'el cliente recibe UN informe, no dos');
});

test('🔴 el informe deja RASTRO del msgId, o su acuse no se puede interpretar', async () => {
  // Meta contesta 200 al aceptar el envio y manda el resultado real despues, con este
  // mismo msgId. Sin saber a que documento corresponde, un `failed` pasa desapercibido —
  // que es justo como un informe termino figurando "entregado" con hora mientras el
  // cliente no tenia nada.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.escrituras.some(([k]) => k.startsWith('wamsg:'))),
    'tiene que guardarse el rastro del envio');

  const rastros = spy.escrituras.filter(([k]) => k.startsWith('wamsg:'));
  // LOS DOS documentos dejan rastro: una propuesta que no llega es una venta detenida, y
  // hasta hoy tampoco se veia.
  const porTipo = Object.fromEntries(rastros.map(([k, v]) => [v.tipo, { k, v }]));
  assert.ok(porTipo.propuesta, 'la propuesta tambien deja rastro');
  const inf = porTipo.informe_termico;
  assert.ok(inf, 'y el informe');
  assert.equal(inf.k, 'wamsg:doc.1', 'indexado por el id que devolvio Meta');
  assert.ok(inf.v.folio, 'con el folio, para poder nombrarlo si falla');
  assert.equal(inf.v.telefono, deps.parseInbound().from, 'y el telefono, para soltar su candado');
});

test('🔴 [Codex final] el informe REUSA el Deal de la propuesta, no lo pisa', async () => {
  // `upsertZohoDeal` arma el nombre del Deal con `items[0].producto_label` y reescribe la
  // descripcion. El informe le pasaba items con otra forma ({producto, medidas, cantidad}),
  // asi que el nombre caia al generico "Ventanas" y pisaba el bueno: un documento
  // secundario degradando el registro comercial del cliente.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.adjuntosZoho.some((a) => /^Informe-Termico/.test(a.filename || ''))));

  // La PROPUESTA hace su upsert (ahi estan los datos completos). El informe, ninguno.
  assert.equal(spy.upserts.length, 1, 'un solo upsert por turno: el de la propuesta');
  const adj = spy.adjuntosZoho.find((a) => /^Informe-Termico/.test(a.filename || ''));
  assert.equal(adj.dealId, 'deal.777', 'y el informe se cuelga de ESE Deal');
});

test('🔒 sin Deal de la propuesta, el informe NO archiva (pero igual se entrega)', async () => {
  // Mejor no archivar que crear un Deal a medias con datos incompletos.
  const { deps, spy } = makeDeps({ overrides: { upsertZohoDeal: async () => null } });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'el cliente igual recibe su informe');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(spy.adjuntosZoho.filter((a) => /^Informe-Termico/.test(a.filename || '')).length, 0);
});
