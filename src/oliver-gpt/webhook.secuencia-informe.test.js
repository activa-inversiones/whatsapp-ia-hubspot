// webhook.secuencia-informe.test.js — [2026-08-27]
//
// LA SECUENCIA INFORME-PRIMERO (Variante B · tablero #524). Pedido del dueño, textual:
// *"¿por qué aún estamos entregando cotización a cliente y no lo que se aprobó desde el
// principio? … primero optimicemos todo lo ya ganado de los informes"*.
//
// Lo que estos tests miden es el ORDEN DE ENVÍO, que es exactamente lo que el dueño vio
// mal en producción (caso Dady, 27-ago: propuesta 0368 primero, informe 0033 después):
//
//   clásico (flag OFF):        propuesta → informe → video      (lo de siempre, intacto)
//   informe-primero (flag ON): valor → informe → video → propuesta
//
// Y la condición NO NEGOCIABLE de la propuesta aprobada: el cliente JAMÁS se queda sin
// su PDF de precio — informe caído, colgado o ya-enviado ⇒ la propuesta sale igual.
//
// Hermético: `global.fetch` se anula y todo lo que toca red se inyecta (mismo patrón que
// webhook.informe.test.js, del que este arnés es hijo).

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWebhook, secuenciaInformePrimero, huellaDelInforme } from './webhook.js';

global.fetch = async (url) => {
  if (String(url).includes('/internal/quotes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ quote_number: 'CM-FR-004-2026-9999' }) };
  }
  if (String(url).includes('/internal/informes/next-number')) {
    return { ok: true, status: 200, json: async () => ({ informe_number: 'CM-FR-006-2026-9999' }) };
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

const DATOS_COMUNA = {
  comuna: 'Temuco', regimen: 'PDA', uw_max_Wm2K: 3.2,
  zona_termica_NCh1079: 'F', criterio_ref: 'PDA Temuco art. 27',
};

const VENTANAS = [
  { producto: 'Ventana PVC S60 corredera', medidas: '2000x1400mm', vidrio: 'DVH 5/12/5', ambiente: 'Living', cantidad: 1, uw: 2.71 },
  { producto: 'Ventana PVC H98 corredera 3 hojas', medidas: '3250x1460mm', vidrio: 'DVH 5/12/5', ambiente: 'Dormitorio', cantidad: 1, uw: null },
];

let SECUENCIA = 0;

function makeRes() {
  return { sentStatus: undefined, sendStatus(c) { this.sentStatus = c; return this; } };
}

/**
 * Arnés con LÍNEA DE TIEMPO: cada envío al cliente (texto, documento, video) se anota en
 * `spy.linea` en el orden REAL en que salió. El orden es el objeto de estos tests.
 */
function makeDeps({ modoOn = true, informeEnvioOk = true, informeCuelga = false, overrides = {} } = {}) {
  const telefono = `5698${String(++SECUENCIA).padStart(7, '0')}`;
  const spy = { linea: [], textos: [], pdfArgs: [], convEvents: [] };
  const estado = new Map();
  let tokenSeq = 0;
  const vigente = (e) => e && (!e.expira || e.expira > Date.now());

  const deps = {
    conv: new Map(), seen: new Set(), locks: new Map(),
    dormir: async () => {},                       // sin esperas humanas en test

    // El gate se inyecta: el flag real vive en env de Railway y acá se prueba la SECUENCIA,
    // no la lectura de env (esa se prueba abajo, unitaria, sobre secuenciaInformePrimero).
    secuenciaInformePrimero: () => modoOn,
    seqInformeTimeoutMs: 400,                     // techo corto: el test del cuelgue no puede esperar 120 s

    leerEstado: async (k) => (vigente(estado.get(k)) ? estado.get(k).valor : null),
    escribirEstado: (k, v, ttl = 300) => { estado.set(k, { valor: v, expira: Date.now() + ttl * 1000 }); },
    fusionarEstado: (k, calcular, ttl = 300) => {
      const e = estado.get(k);
      const actual = vigente(e) ? e.valor : null;
      const { valor, guardar } = calcular(actual) || {};
      if (guardar && valor != null) estado.set(k, { valor, expira: Date.now() + ttl * 1000 });
      return valor === undefined ? actual : valor;
    },
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
    sendWhatsAppText: async (to, text) => {
      spy.textos.push(text);
      spy.linea.push({ tipo: 'texto', detalle: String(text).slice(0, 60) });
      return { ok: true, msgId: `m${spy.linea.length}` };
    },

    pedirInformeComuna: async () => DATOS_COMUNA,
    generarInformeTermicoPdf: async (datos, opts) => {
      if (informeCuelga) return new Promise(() => {});   // nunca resuelve: el techo decide
      spy.pdfArgs.push(opts);
      return Buffer.alloc(1024, 7);
    },
    laminasParaInforme: async () => null,
    laminaTermopanel: async () => null,
    saveMedia: async () => ({ ok: true, media: { id: 1 } }),

    upsertZohoDeal: async () => 'deal.777',
    addZohoNote: async () => ({ ok: true }),
    attachPdfToDeal: async () => ({ ok: true }),
    generatePdf: async () => Buffer.alloc(2048, 3),
    uploadWaDocument: async () => 'media.1',
    sendWaDocument: async (to, mediaId, filename) => {
      const esInforme = /^Informe-Termico/.test(filename || '');
      const esVientos = /^Informe-Vientos/.test(filename || '');
      spy.linea.push({ tipo: esVientos ? 'vientos' : (esInforme ? 'informe' : 'propuesta'), detalle: filename });
      if (esVientos) return { ok: true, msgId: 'vien.1' };
      if (!esInforme) return { ok: true, msgId: 'prop.1' };
      return informeEnvioOk ? { ok: true, msgId: 'doc.1' } : { ok: false, error: 'Meta rechazo' };
    },
    // El video de cortesía: un id cargado alcanza para medir DÓNDE cae en la línea.
    mediaIdsDisponibles: async () => ({ presentacion: 'wamedia.video.1' }),
    sendWaVideo: async (to, mediaId, caption) => {
      spy.linea.push({ tipo: 'video', detalle: String(caption).slice(0, 40) });
      return { ok: true, msgId: 'vid.1' };
    },
    // [2026-08-28] El informe de VIENTOS: THERMAL se inyecta (regla: se pide, no se
    // incorpora — y en test no hay red). El PDF también.
    pedirVientos: async ({ ventanas }) => ({
      ventanas: ventanas.map((v) => ({
        nombre: v.nombre, ancho_mm: v.ancho_mm, alto_mm: v.alto_mm,
        vidrio: `DVH ${v.vidrio.ext_mm}/${v.vidrio.camara_mm}/${v.vidrio.int_mm} recocido`,
        cantidad: v.cantidad,
        capacidad: { lr_corta_kPa: 1.89, lr_larga_kPa: 0.82 },
        veredicto: { evaluable: true, cumple_corta: true },
        flechas: { referencia: { flecha_maxima_mm: 14.5 } },
      })),
      demanda: { presion_kPa: 0.675, q_basica_kg_m2: 57.3, factor_forma_C: 1.2 },
    }),
    generarInformeVientosPdf: async () => Buffer.alloc(512, 9),

    handleTurn: async ({ state, toolCtx }) => {
      await toolCtx.generarPdf({
        items: VENTANAS.map((v) => ({
          product: v.producto, producto_label: v.producto, measures: v.medidas,
          measures_original: v.medidas, glass_label: v.vidrio, ambiente: v.ambiente,
          qty: v.cantidad, unit_price: 100000, total_price: 100000,
          color: 'Nogal',
          termico: v.uw === null ? null : { uw: v.uw },
        })),
        comuna: 'Temuco', name: 'Dady',
      });
      return { reply: 'Listo', history: [], toolCalls: [], state: { ...state, name: 'Dady' } };
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
  return { deps, spy, telefono };
}

async function esperar(cond, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

const tipos = (spy) => spy.linea.map((e) => e.tipo);
const pos = (spy, tipo) => tipos(spy).indexOf(tipo);

/* =========================================================================
 * EL GATE (unitario): quién entra al piloto y quién no
 * ========================================================================= */

test('gate: flag OFF ⇒ nadie, aunque la lista tenga el teléfono', () => {
  assert.equal(secuenciaInformePrimero('56911111111', { flag: false, lista: ['56911111111'] }), false);
});

test('gate: flag ON con lista VACÍA ⇒ nadie (sin lista no hay piloto)', () => {
  assert.equal(secuenciaInformePrimero('56911111111', { flag: true, lista: [] }), false);
});

test('gate: flag ON + teléfono en lista ⇒ entra; fuera de lista ⇒ no', () => {
  const lista = ['56922222222'];
  assert.equal(secuenciaInformePrimero('56922222222', { flag: true, lista }), true);
  assert.equal(secuenciaInformePrimero('+56 9 2222 2222', { flag: true, lista }), true, 'normaliza el formato');
  assert.equal(secuenciaInformePrimero('56933333333', { flag: true, lista }), false);
});

test('gate: comodín * ⇒ todos (rollout, decisión del dueño)', () => {
  assert.equal(secuenciaInformePrimero('56944444444', { flag: true, lista: ['*'] }), true);
});

/* =========================================================================
 * LA SECUENCIA (comportamiento): el orden que el dueño pidió
 * ========================================================================= */

test('🔴 modo informe-primero: valor → informe → video → propuesta, en ESE orden', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'la propuesta tiene que salir');
  // [Dueño 28-ago] El ANTICIPO (qué contiene la propuesta, con ancho y alto nombrados)
  // viaja ANTES del documento del precio.
  const iAnticipo = spy.linea.findIndex((e) => e.tipo === 'texto' && /considera/.test(e.detalle));
  assert.ok(iAnticipo >= 0, 'el anticipo de la propuesta tiene que salir');
  assert.ok(iAnticipo < pos(spy, 'propuesta'), 'y ANTES del PDF del precio');

  // El detalle de la línea se recorta a 60 chars, así que se busca por el ARRANQUE del
  // copy aprobado ("Perfecto, {nombre}. Mientras le preparo su Propuesta…").
  const iValor = spy.linea.findIndex((e) => e.tipo === 'texto' && /^Perfecto.*Mientras le preparo/.test(e.detalle));
  assert.ok(iValor >= 0, `el mensaje de valor tiene que salir (línea: ${JSON.stringify(tipos(spy))})`);
  assert.ok(pos(spy, 'informe') >= 0, 'el informe tiene que salir');
  assert.ok(pos(spy, 'video') >= 0, 'el video tiene que salir');
  assert.ok(iValor < pos(spy, 'informe'), 'el mensaje de valor va ANTES del informe');
  // [28-ago, dueño] El informe de VIENTOS es el 2º documento: térmico → vientos → video.
  assert.ok(pos(spy, 'vientos') >= 0, `el informe de vientos tiene que salir — línea: ${JSON.stringify(tipos(spy))}`);
  assert.ok(pos(spy, 'informe') < pos(spy, 'vientos'), 'el térmico va ANTES del de vientos');
  assert.ok(pos(spy, 'vientos') < pos(spy, 'video'), 'el de vientos va ANTES del video');
  assert.ok(pos(spy, 'video') < pos(spy, 'propuesta'),
    `el video va ANTES de la propuesta — línea real: ${JSON.stringify(tipos(spy))}`);

  // [Codex, compuerta] CONTEOS EXACTOS, no solo primeras posiciones: un duplicado
  // posterior daba verde igual. Un informe, una propuesta, a lo más un video.
  await new Promise((r) => setTimeout(r, 200));
  const cuenta = (t) => tipos(spy).filter((x) => x === t).length;
  assert.equal(cuenta('informe'), 1, 'exactamente UN informe');
  assert.equal(cuenta('propuesta'), 1, 'exactamente UNA propuesta');
  assert.ok(cuenta('video') <= 1, 'a lo más UN video');

  // [Gemini, compuerta] El aviso clásico ("Deme un momento…") SOBRA cuando el mensaje
  // de valor ya anunció el informe: dos anuncios seguidos delatan al bot.
  assert.ok(!spy.textos.some((t) => /Deme un momento/.test(String(t))),
    'con mensaje de valor NO va el aviso clásico redundante');

  // [Dueño, 27-ago — doctrina] *"Los clientes no saben leer siglas… nosotros debemos
  // prepararlos para poder venderles"* + su afinación: *"coloca las siglas pero
  // explícalas antes"*. ⇒ cada sigla aparece DESPUÉS de su explicación en palabras.
  const textoValor = String(spy.textos.find((t) => /Mientras le preparo/.test(String(t))) || '');
  assert.match(textoValor, /informe térmico/, 'dice TÉRMICO (así se llama el documento), no "técnico"');
  assert.doesNotMatch(textoValor, /informe técnico/, 'el "informe técnico" quedó prohibido');
  const antesQue = (concepto, sigla) => {
    const i = textoValor.indexOf(concepto); const j = textoValor.indexOf(sigla);
    assert.ok(i >= 0, `falta la explicación "${concepto}"`);
    assert.ok(j >= 0, `falta la sigla "${sigla}" (el dueño las quiere, explicadas)`);
    assert.ok(i < j, `la explicación "${concepto}" debe ir ANTES de la sigla "${sigla}"`);
  };
  antesQue('transmitancia térmica', 'Uw');
  antesQue('zona térmica F según la clasificación oficial chilena', 'NCh 1079');
  antesQue('Ministerio de Vivienda', 'MINVU');
  antesQue('separador de borde cálido', 'warm-edge');
  // [Dueño] El diferenciador con su raya de claims: baja probabilidad EN EL BORDE,
  // jamás promesa absoluta de cero condensación. Y su upgrade del 27-ago: la
  // certificación alemana Passive House + el MECANISMO (retiene temperatura donde
  // el aluminio la pierde), respaldado por la lámina comparativa del informe.
  assert.match(textoValor, /probabilidad de condensación en el borde queda muy baja/,
    'el warm-edge se vende sin prometer condensación cero');
  assert.match(textoValor, /certificación del instituto alemán Passive House/,
    'la credencial del separador, como la dictó el dueño');
  assert.match(textoValor, /mayor temperatura interior/, 'el mecanismo: retiene, no pierde');
  assert.match(textoValor, /separador de aluminio/, 'el contraste con el aluminio, que el informe dibuja');
  assert.match(textoValor, /me comenta por favor, estaré muy atento/,
    'la invitación a preguntar, con la redacción textual del dueño');
  // [Dueño, 27-ago] "Con esto (los guiones largos) se ve falso" + negritas de WhatsApp
  // en los tres titulares + el especialista con su credencial formal verificada.
  assert.doesNotMatch(textoValor, /—/, 'cero guiones largos: se leen a máquina');
  assert.match(textoValor, /\*Cuánto aíslan del frío sus ventanas:\*/, 'titular 1 en negrita');
  assert.match(textoValor, /\*Por qué con una buena ventana la condensación baja muchísimo:\*/, 'titular 2 en negrita');
  assert.match(textoValor, /\*Nuestro especialista:\*/, 'titular 3 en negrita');
  assert.match(textoValor, /ingeniero Marcelo Cifuentes/, 'el especialista con su título');
  assert.match(textoValor, /Resolución 266\/2025/, 'la credencial formal respaldada');
  assert.doesNotMatch(textoValor, /EXENTA/, 'el EXENTA N°63 NO está verificado: fuera (guardián)');
  assert.equal(spy.pdfArgs.at(-1)?.nombre, 'Dady',
    'el informe sale "Preparado para" el cliente aunque state.name aún no exista');
});

test('🔴 el video se CUELGA ⇒ su techo lo corta y la propuesta sale igual (P1 de Codex)', async () => {
  const { deps, spy } = makeDeps({
    modoOn: true,
    overrides: {
      seqVideoTimeoutMs: 300,
      sendWaVideo: () => new Promise(() => {}),   // nunca resuelve: el techo decide
    },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `un video colgado JAMÁS puede dejar al cliente sin precio — línea: ${JSON.stringify(tipos(spy))}`);
});

test('🌬️ THERMAL caído ⇒ la secuencia sigue SIN vientos y nadie nota el hueco', async () => {
  // El regalo no anunciado: el mensaje de valor no lo promete, así que su ausencia no
  // rompe ninguna promesa. La línea sale completa, solo sin el documento de vientos.
  const { deps, spy } = makeDeps({ modoOn: true, overrides: { pedirVientos: async () => null } });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  assert.equal(pos(spy, 'vientos'), -1, 'sin THERMAL no hay informe de vientos, y no pasa nada');
  assert.ok(pos(spy, 'informe') < pos(spy, 'video'), 'el resto de la secuencia intacta');
});

test('🌬️ el motor de vientos se CUELGA ⇒ su techo lo corta y el precio sale igual', async () => {
  const { deps, spy } = makeDeps({ modoOn: true, overrides: {
    seqVientosTimeoutMs: 300,
    pedirVientos: () => new Promise(() => {}),   // nunca resuelve: el techo decide
  } });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `vientos colgado JAMÁS retiene el precio — línea: ${JSON.stringify(tipos(spy))}`);
});

test('🌬️ el candado de 30 días evita el informe de vientos repetido', async () => {
  const { deps, spy, telefono } = makeDeps({ modoOn: true });
  // El candado ya puesto para la huella REAL del proyecto del test (última ventana):
  const huella = huellaDelInforme({
    comuna: 'Temuco', producto: 'Ventana PVC H98 corredera 3 hojas', glassLabel: 'DVH 5/12/5',
  });
  await deps.escribirEstado(`informe_vientos:${telefono}:${huella}`, { at: Date.now() }, 300);
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  assert.equal(pos(spy, 'vientos'), -1, 'proyecto ya informado: sin repetido');
});

test('🔴 el gate LANZA ⇒ se degrada al modo clásico y la propuesta sale (P2 de Codex)', async () => {
  const { deps, spy } = makeDeps({
    modoOn: true,
    overrides: { secuenciaInformePrimero: () => { throw new Error('gate roto'); } },
  });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `el gate roto no puede tumbar la propuesta — línea: ${JSON.stringify(tipos(spy))}`);
});

test('🔴 modo clásico (flag OFF): la propuesta sigue saliendo PRIMERO, como siempre', async () => {
  const { deps, spy } = makeDeps({ modoOn: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'informe') >= 0), 'el informe sale (después)');

  assert.ok(pos(spy, 'propuesta') >= 0);
  assert.ok(pos(spy, 'propuesta') < pos(spy, 'informe'),
    `clásico = propuesta antes del informe — línea real: ${JSON.stringify(tipos(spy))}`);
});

test('🔴 el informe FALLA (Meta rechaza) ⇒ recuperación honesta y la propuesta sale IGUAL', async () => {
  const { deps, spy } = makeDeps({ modoOn: true, informeEnvioOk: false });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `el cliente JAMÁS se queda sin su PDF — línea real: ${JSON.stringify(tipos(spy))}`);
  // [Codex/Gemini, compuerta] Se le PROMETIÓ el informe (mensaje de valor) y Meta lo
  // rechazó: al cliente se le dice, no se le desaparece la promesa.
  assert.ok(spy.textos.some((t) => /más de lo esperado/.test(String(t))),
    'tras prometer el informe y fallar, va la línea de recuperación');
  // Y si el video llegara a salir (candado de tanda mediante), va DESPUÉS del precio,
  // nunca colado entre la promesa rota y la propuesta.
  if (pos(spy, 'video') >= 0) {
    assert.ok(pos(spy, 'propuesta') < pos(spy, 'video'), 'video solo después de la propuesta');
  }
});

test('🔴 el informe se CUELGA ⇒ el techo lo corta y la propuesta sale igual', async () => {
  const { deps, spy } = makeDeps({ modoOn: true, informeCuelga: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0),
    `con el informe colgado el techo (400 ms en test) libera la propuesta — línea: ${JSON.stringify(tipos(spy))}`);
});

test('el informe declara las MISMAS ventanas que la propuesta (paridad de documentos)', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => spy.pdfArgs.length > 0));
  const medidas = (vs) => (vs || []).map((v) => String(v.medidas || '').replace(/mm$/, ''));
  assert.deepEqual(medidas(spy.pdfArgs.at(-1).ventanas), medidas(VENTANAS));
});

/* =========================================================================
 * RITMO Y REPETICIÓN (dueño, 28-ago, tras SU prueba de Toltén):
 * "le dijo 2 veces lo mismo al cliente cuando le agregué una ventana" +
 * "me entregó el informe térmico en segundos... que se vea más natural secuencial"
 * ========================================================================= */

test('🔴 [dueño 28-ago] un cambio de proyecto minutos después NO repite el discurso completo', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0), 'primera propuesta debe salir');
  assert.equal(spy.textos.filter((t) => /warm-edge/.test(String(t))).length, 1,
    'primera vez: el discurso completo, una vez');

  // El cliente agrega una ventana: MISMO teléfono, proyecto distinto (huella nueva) —
  // exactamente el caso real de Toltén (0375 → marco fijo → 0375-B).
  deps.handleTurn = async ({ state, toolCtx }) => {
    await toolCtx.generarPdf({
      items: [{ product: 'Fijo S60', producto_label: 'Fijo S60', measures: '2500x2000mm',
        measures_original: '2500x2000mm', glass_label: 'DVH 4/16/4', ambiente: 'Living',
        qty: 1, unit_price: 100000, total_price: 100000, color: 'Blanco', termico: { uw: 2.6 } }],
      comuna: 'Temuco', name: 'Dady',
    });
    return { reply: 'Listo', history: [], toolCalls: [], state: { ...state, name: 'Dady' } };
  };
  const antes = spy.linea.length;
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => tipos(spy).slice(antes).includes('propuesta')), 'segunda propuesta debe salir');

  assert.equal(spy.textos.filter((t) => /warm-edge/.test(String(t))).length, 1,
    'el discurso completo NO se repite en la segunda ronda');
  assert.ok(spy.textos.some((t) => /informes del proyecto al día/.test(String(t))),
    'en su lugar sale la variante corta');
  assert.ok(!spy.textos.some((t) => /enseguida/.test(String(t))),
    '[Copilot] la variante corta no promete "enseguida": la secuencia toma minutos a propósito');
  assert.equal(tipos(spy).filter((t) => t === 'informe').length, 2,
    'los DOCUMENTOS sí se reenvían: el proyecto cambió y el contenido es nuevo');
});

test('🔴 [dueño 28-ago] piso de ritmo: entre el mensaje de valor y el térmico se espera lo que falte', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  // Techo realista: con el techo corto del arnés (400 ms) el TOPE del piso (Codex,
  // re-pase) lo suprime a propósito — eso se prueba aparte, abajo.
  deps.seqInformeTimeoutMs = 200_000;
  const esperas = [];
  deps.dormir = async (ms) => { esperas.push({ ms, antesDe: spy.linea.length }); };
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  // En test la generación es instantánea, así que el piso pide casi completo (~45 s).
  const piso = esperas.find((e) => e.ms >= 40_000 && e.ms <= 45_000);
  assert.ok(piso, `falta la espera del piso; esperas vistas: ${esperas.map((e) => e.ms).join(',')}`);
  assert.ok(piso.antesDe <= pos(spy, 'informe'),
    'el piso corre ANTES de que el documento térmico salga');
  // Y la respiración antes del informe de vientos subió de 6 a 25 s.
  assert.ok(esperas.some((e) => e.ms === 25_000),
    `falta la pausa de 25 s del informe de vientos; vistas: ${esperas.map((e) => e.ms).join(',')}`);
});


test('🔴 [Codex, re-pase] el piso espera SOLO lo que falta: generación lenta no suma espera', async () => {
  const { deps, spy } = makeDeps({ modoOn: true });
  deps.seqTermicoMs = 200;                       // piso chico para poder superarlo de verdad
  const esperas = [];
  deps.dormir = async (ms) => { esperas.push(ms); };
  const pdfOriginal = deps.generarInformeTermicoPdf;
  deps.generarInformeTermicoPdf = async (...a) => {   // generación REAL de 300 ms > piso
    await new Promise((r) => setTimeout(r, 300));
    return pdfOriginal(...a);
  };
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  assert.ok(!esperas.some((ms) => ms > 0 && ms <= 200),
    `el piso ya estaba cumplido y no debía dormir nada; esperas: ${esperas.join(',')}`);
});


test('🔴 [Codex, re-pase] el piso queda ACOTADO por el techo: jamás empuja el térmico después del precio', async () => {
  // Con el techo del arnés en 400 ms, el tope (techo - 15 s de margen) es 0: el piso de
  // 45 s tiene que suprimirse solo. Sin el tope, este test dormiría 45 s y el térmico
  // caería después de la propuesta.
  const { deps, spy } = makeDeps({ modoOn: true });
  const esperas = [];
  deps.dormir = async (ms) => { esperas.push(ms); };
  await handleWebhook({ body: {} }, makeRes(), deps);
  assert.ok(await esperar(() => pos(spy, 'propuesta') >= 0));
  assert.ok(!esperas.some((ms) => ms >= 40_000 && ms <= 45_000),
    `el piso debía suprimirse por el tope; esperas: ${esperas.join(',')}`);
  assert.ok(pos(spy, 'informe') < pos(spy, 'propuesta'),
    'y el orden térmico antes que propuesta se conserva');
});
