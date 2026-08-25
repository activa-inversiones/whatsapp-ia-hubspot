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
  { id: 'V2', producto: 'Ventana PVC H98 corredera 3 hojas', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw: null },
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
  const spy = { upserts: [], escrituras: [], docsEnviados: [], propuestas: [], convEvents: [], pdfArgs: [], textos: [], adjuntosZoho: [], notasZoho: [], mediaGuardada: [] };
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

    parseInbound: () => ({ ok: true, from: telefono, text: 'dos ventanas correderas', msgId: `wamid.${Math.random()}`, type: 'text' }),
    sendWhatsAppText: async (to, text) => { spy.textos.push(text); return { ok: true, msgId: 'm1' }; },

    // ── lo que hoy NO es inyectable y por eso este camino no se podia probar ──
    pedirInformeComuna: async () => DATOS_COMUNA,
    generarInformeTermicoPdf: async (datos, opts) => { spy.pdfArgs.push(opts); return Buffer.alloc(1024, 7); },
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,

    // El registro en sales-os: es lo que hace que el documento entre a media_attachments y,
    // desde ahi, que el hook de server.js lo suba a WorkDrive. Se inyecta porque el modulo
    // real decide `MEDIA_ENABLED` al importarse, mirando env que en test no existen.
    saveMedia: async (o) => { spy.mediaGuardada.push(o); return { ok: true, media: { id: 1 } }; },

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
            color: 'Nogal',            // [2026-08-25] el gate ahora exige color: sin el no hay PDF
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

test('🎥 tras la propuesta se manda UN video de fabrica, y no se repite', async () => {
  const { deps, spy } = makeDeps();
  spy.videos = [];
  const estadoVideos = { fabrica: 'media.vid1', cnc_corte: 'media.vid2' };
  const leerOrig = deps.leerEstado;
  deps.leerEstado = async (k) => (k === 'videos_fabrica:media_ids' ? estadoVideos : leerOrig(k));
  deps.sendWaVideo = async (to, mediaId, caption) => {
    spy.videos.push({ to, mediaId, caption });
    return { ok: true, msgId: 'v1' };
  };
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.videos.length > 0), 'tiene que salir un video');
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(spy.videos.length, 1, 'UNO, no todos: es un regalo, no una descarga');
  assert.equal(spy.videos[0].mediaId, 'media.vid1', 'por media_id — nada de almacenar el archivo');
  assert.match(spy.videos[0].caption, /fábrica|Temuco/i, 'con algo que invite a conocernos');
});

test('🎥 sin videos cargados no se manda nada (y no rompe la propuesta)', async () => {
  const { deps, spy } = makeDeps();
  spy.videos = [];
  // 🔴 [2026-08-25] SE FUERZA LA FUENTE ENTERA, no solo el KV. `mediaIdsDisponibles` cae al
  // archivo `data/videos-media-ids.json` cuando el KV viene vacio; desde que ese archivo
  // entro al repo (commit c4e3052, al subir los 6 videos) este test quedo en rojo: pedia
  // "sin videos cargados" y el sistema encontraba los 6 del archivo. El test no estaba mal
  // de origen — envejecio mal, que es peor, porque un rojo permanente entrena a ignorar los rojos.
  deps.mediaIdsDisponibles = async () => ({});
  deps.sendWaVideo = async (...a) => { spy.videos.push(a); return { ok: true }; };
  await handleWebhook({ body: {} }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(spy.videos.length, 0, 'sin media_id cargado, no se intenta');
  assert.equal(spy.propuestas.length, 1, 'y la propuesta sale igual');
});

test('🎥 si el media_id CADUCO, se descarta para que la proxima carga lo reponga', async () => {
  // Los media_id de Meta vencen a los ~30 dias. Reintentar contra un id muerto es gastar
  // envios; descartarlo hace que `subir-videos-wa` lo reponga la proxima vez.
  const { deps, spy } = makeDeps();
  spy.videos = []; spy.guardado = null;
  const ids = { fabrica: 'media.VENCIDO' };
  const leerOrig = deps.leerEstado;
  deps.leerEstado = async (k) => (k === 'videos_fabrica:media_ids' ? ids : leerOrig(k));
  const escribirOrig = deps.escribirEstado;
  deps.escribirEstado = (k, v, ttl) => {
    if (k === 'videos_fabrica:media_ids') spy.guardado = v;
    return escribirOrig(k, v, ttl);
  };
  deps.sendWaVideo = async () => ({ ok: false, error: 'media id not found' });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.guardado !== null, 4000), 'tiene que reescribir los ids');
  assert.ok(!('fabrica' in spy.guardado), 'el id vencido se descarta');
});

test('🎥 al cliente que YA vio uno se le manda OTRO, no el mismo', async () => {
  // Mandar dos veces el mismo se lee como bot trabado — el proyecto ya pago ese precio:
  // 73 mensajes identicos a 26 clientes en 60 dias.
  const { deps, spy } = makeDeps();
  spy.videos = [];
  const ids = { fabrica: 'media.vid1', cnc_corte: 'media.vid2' };
  const leerOrig = deps.leerEstado;
  deps.leerEstado = async (k) => {
    if (k === 'videos_fabrica:media_ids') return ids;
    if (k.startsWith('videos_fabrica:vistos:')) return ['fabrica'];   // ya vio el primero
    return leerOrig(k);
  };
  deps.sendWaVideo = async (to, mediaId) => { spy.videos.push(mediaId); return { ok: true }; };

  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.videos.length > 0), 'tiene que salir un video');
  assert.equal(spy.videos[0], 'media.vid2', 'el que NO vio, no el que ya tiene');
});


// ═══════════════════════════════════════════════════════════════════════════════
// EL INFORME TAMBIEN ES UN REGISTRO ISO, Y HASTA HOY NO SE ARCHIVABA
//
// La propuesta se registra en sales-os desde jun-2026 (webhook.js:1895) y por eso el hook
// de `server.js` la sube a la carpeta COTIZACIONES de WorkDrive: medido 2026-08-25, 149
// documentos salientes archivados desde que el hook existe. El informe termico nunca paso
// por ahi — se sube a Meta, se manda y se adjunta al Deal, y ahi termina. Consecuencias
// medidas: no esta en `media_attachments`, no se archiva en Drive, y en el cockpit no
// aparece como adjunto del cliente.
//
// Un documento firmado que se le entrega a un cliente y del que la empresa no guarda copia
// es exactamente lo que un auditor pide primero.
// ═══════════════════════════════════════════════════════════════════════════════

test('📁 el informe entregado se REGISTRA como documento saliente (lo que dispara el archivo en WorkDrive)', async () => {
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0), 'primero tiene que entregarse');
  assert.ok(await esperar(() => spy.mediaGuardada.some((m) => /^Informe-Termico/.test(m.filename || '')), 4000),
    'el informe entregado tiene que quedar registrado en sales-os');

  const informes = spy.mediaGuardada.filter((m) => /^Informe-Termico/.test(m.filename || ''));
  // 🔴 [Codex, compuerta cruzada] EXACTAMENTE UNO. La version anterior de este test usaba
  // `find`, que se conforma con "hay al menos uno" — y el duplicado del informe no es
  // hipotetico: el 24-ago dos clientes recibieron el suyo DOS veces (folios 0001/0002 y
  // 0003/0004). Un test que pasa con dos registros no protege del bug que ya ocurrio.
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(spy.mediaGuardada.filter((m) => /^Informe-Termico/.test(m.filename || '')).length, 1,
    'un envio = un registro');
  const reg = informes[0];
  // Estos dos campos NO son decorativos: `isOutboundArchivable` (sales-os) solo archiva
  // 'document', y el hook solo mira `direction === 'outbound'`. Con otro valor el registro
  // entra a la BD y se queda ahi, marcado 'skip:no-es-registro'.
  assert.equal(reg.direction, 'outbound', "sin 'outbound' el hook de WorkDrive ni lo mira");
  assert.equal(reg.mediaType, 'document', "sin 'document' se descarta por no ser registro ISO");
  assert.equal(reg.mimeType, 'application/pdf');
  assert.ok(reg.buffer && reg.buffer.length > 0, 'con los bytes: sin ellos no hay nada que archivar');
  assert.equal(reg.phone, spy.docsEnviados[0].to, 'al telefono del cliente que lo recibio');
});

test('📁 el registro lleva el media_id de WhatsApp, que es como el cockpit encuentra el archivo', async () => {
  // Mismo motivo por el que se agrego a la propuesta en jun-2026: sin el wa_media_id, el
  // link /api/v5/media/{id} del cockpit daba "not found" y el operador no podia abrir el PDF.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.mediaGuardada.some((m) => /^Informe-Termico/.test(m.filename || '')), 4000));
  const reg = spy.mediaGuardada.find((m) => /^Informe-Termico/.test(m.filename || ''));
  assert.equal(reg.waMediaId, spy.docsEnviados[0].mediaId, 'el mismo id con el que se envio');
});

test('📁 el informe que NO se entrego no se registra: no se archiva lo que el cliente nunca recibio', async () => {
  const { deps, spy } = makeDeps({ envioOk: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(spy.mediaGuardada.filter((m) => /^Informe-Termico/.test(m.filename || '')).length, 0,
    'un archivo de algo no entregado es un registro falso');
});

test('📁 si sales-os no responde, el informe igual se entrega', async () => {
  // El archivo es trazabilidad NUESTRA; el informe es del cliente. Nunca al reves.
  const { deps, spy } = makeDeps();
  deps.saveMedia = async () => { throw new Error('sales-os caido'); };
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0, 4000), 'el cliente recibe su informe igual');
});


test('📁 el archivo lleva el correlativo: dos informes de la misma comuna no se pisan', async () => {
  // Al cliente se le manda "Informe-Termico-Temuco.pdf" —igual para TODOS los de Temuco—.
  // En WorkDrive se sube con override-name-exist:false a la misma carpeta que las
  // cotizaciones, asi que sin correlativo el segundo informe de Temuco quedaria
  // indistinguible del primero. El nombre del archivo es lo unico que ve un auditor
  // antes de abrirlo.
  const { deps, spy } = makeDeps();
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.mediaGuardada.some((m) => /^Informe-Termico/.test(m.filename || '')), 4000));
  const reg = spy.mediaGuardada.find((m) => /^Informe-Termico/.test(m.filename || ''));

  const ev = spy.convEvents.find((e) => e?.metadata?.informe_number);
  assert.ok(ev, 'el evento de conversacion trae el correlativo');
  assert.ok(reg.filename.includes(ev.metadata.informe_number),
    `el archivo tiene que llevar el correlativo ${ev.metadata.informe_number}, y se llama ${reg.filename}`);
  assert.match(reg.filename, /\.pdf$/, 'y seguir siendo un .pdf');

  // Lo que RECIBE el cliente no cambia: ese nombre se lee en el telefono.
  assert.equal(spy.docsEnviados[0].filename, 'Informe-Termico-Temuco.pdf',
    'al cliente se le sigue mandando el nombre legible');
});

test('📁 si sales-os se cuelga (no responde nunca), el informe ya salio igual', async () => {
  // [Codex, compuerta] El test de fallo usaba `throw`, que es un rechazo inmediato. Una
  // peticion COLGADA es otra cosa: la promesa queda pendiente para siempre. Importa que ni
  // asi el cliente se quede sin documento — por eso el registro va DESPUES de la entrega.
  const { deps, spy } = makeDeps();
  deps.saveMedia = () => new Promise(() => {});      // nunca resuelve
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.docsEnviados.length > 0, 4000),
    'el informe se entrega aunque el registro quede colgado');
  assert.ok(spy.convEvents.some((e) => e?.metadata?.informe_number),
    'y queda visible en la conversacion');
});
