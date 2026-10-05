// avisarVidrio.test.js — [2026-10-05 · r8] LA ORQUESTACIÓN DEL AVISO AL DUEÑO POR SATÉN PERDIDO.
//
// «La propuesta dice satén y se cotizó con vidrio claro»: el dueño tiene que enterarse. Este archivo fija
// cómo `avisarVidrio({ avisos, folio, logWarn, canales, estado })` lo garantiza. Las funciones puras que
// comparte con escalation.js (frase, motivo) se prueban en vidrioCotizado.test.js; el cableado de los canales
// reales, en canalesAvisoVidrio.test.js, y la prueba de punta a punta con el notificador real, en
// avisoVidrio.integracion.test.js.
//
// ── POR QUÉ TEXTO Y PLANTILLA, SIEMPRE (la causa raíz de r7) ──────────────────────────────────────────────
// r7 mandaba la plantilla SOLO si el texto libre era rechazado de forma síncrona con 131047. Pero
// AGENTS.md:15-19 (medido el 05-sep) dice lo contrario del caso real: fuera de la ventana de 24 h Meta ACEPTA
// el texto libre con HTTP 200 —incluso devolviendo un id— y lo marca `failed` (131047) DESPUÉS, por webhook.
// Entonces `notifyHighValue` devuelve `sent:true`, el aviso se da por entregado y la plantilla nunca sale: el
// respaldo de r7 era código muerto justo en el caso medido. Y el bot NO sabe cuándo le escribió el dueño por
// última vez (no hay rastreo de la ventana del dueño), así que tampoco puede elegir el canal. La regla del
// repo es «fuera de la ventana va PLANTILLA APROBADA»; la escalación #888 (webhook.js:1810-1876) resuelve lo
// mismo mandando AMBAS siempre. Acá igual, una vez por folio.
//
// Hermético: canales y almacén FALSOS (con la semántica de estadoPersistente.js y un reloj inyectado). Los
// fakes de la plantilla tienen la FORMA REAL de /admin/send-template (index.js:5280): {ok, template, phone, result}.

import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarVidrio, avisarVidrio, textoBanoPerdido, AVISO_VIDRIO_REPETIR_MS, claveAvisoVidrio } from './vidrioCotizado.js';
import * as estadoReal from './estadoPersistente.js';

const FOLIO = 'CM-FR-004-2026-0601';
const ETIQUETA = '4+12+4 satén (baño)';
const MOTOR = '4+12+4';                                     // el vidrio claro con que cotizó el motor
const SATEN = () => {
  const avisos = [];
  aplicarVidrio({ glass_label: ETIQUETA }, '4+12+4', { avisos });
  return avisos;
};

// Lo que devuelve notifyHighValue (services/highValueNotifier.js).
const TEXTO_OK = () => ({ sent: true, tier: 'MEDIUM' });
const TEXTO_VENTANA = () => ({ sent: false, reason: 'envio_fallido', code: 131047, error: '{"error":{"code":131047}}' });
const TEXTO_COOLDOWN = () => ({ sent: false, reason: 'cooldown' });
const TEXTO_DUDOSO = () => ({ sent: false, reason: 'envio_dudoso', error: 'timeout of 15000ms exceeded', timedOut: true });
// Lo que devuelve sendAvisoVidrioTemplate: la respuesta de /admin/send-template, que NO trae el error arriba.
const PLANTILLA_OK = () => ({ ok: true, template: 'informe_diario', phone: '56900000009', result: { ok: true, msgId: 'wamid.T1' } });
const PLANTILLA_META_RECHAZA = () => ({
  ok: false, template: 'informe_diario', phone: '56900000009',
  result: { ok: false, error: '{"error":{"code":132000,"message":"Number of parameters mismatch"}}' },
});
const PLANTILLA_SIN_PIN = () => ({ ok: false, error: 'ADMIN_PIN_missing' });          // fallo propio de escalation.js
const PLANTILLA_TIMEOUT = () => ({ ok: false, error: 'The operation was aborted due to timeout', timedOut: true });
const PANEL_OK = () => ({ ok: true });

/** Reloj, almacén (misma semántica que estadoPersistente.js: reservar atómico, TTL) y espías, por test. */
function mundo({ texto = TEXTO_OK, plantilla = PLANTILLA_OK, panel = PANEL_OK } = {}) {
  let t = 1_760_000_000_000;
  const reloj = { ahora: () => t, avanzar: (ms) => { t += ms; } };
  const kv = new Map();
  let seq = 0;
  const vivo = (e) => e && e.expira > t;
  const escrituras = [];
  const estado = {
    reservar: (k, ttl) => { if (vivo(kv.get(k))) return null; const tk = `tk${++seq}`; kv.set(k, { valor: tk, expira: t + ttl * 1000 }); return tk; },
    liberar: (k, tk) => { const e = kv.get(k); if (!vivo(e) || e.valor !== tk) return false; kv.delete(k); return true; },
    leer: async (k) => (vivo(kv.get(k)) ? kv.get(k).valor : null),
    escribir: (k, v, ttl) => { escrituras.push({ k, v, ttl }); kv.set(k, { valor: v, expira: t + ttl * 1000 }); return v; },
  };
  const visto = { texto: [], plantilla: [], panel: [], logs: [] };
  const canales = {
    texto: async (x) => { visto.texto.push(x); return texto(); },
    plantilla: async (x) => { visto.plantilla.push(x); return plantilla(); },
    panel: async (x) => { visto.panel.push(x); return panel(); },
  };
  const logWarn = (a, tx) => visto.logs.push(`${a} ${tx}`);
  const avisar = (avisos = SATEN(), folio = FOLIO) => avisarVidrio({ avisos, folio, logWarn, canales, estado, ahora: reloj.ahora });
  const logsDe = (prefijo) => visto.logs.filter((l) => l.startsWith(prefijo));
  return { reloj, kv, estado, escrituras, visto, canales, avisar, logsDe, logWarn };
}

/* ── lo que ya hacía r4/r5, ahora con la firma por objeto ───────────────────────────────────────────── */

test('loguea cada aviso UNA vez con el folio (el bloque del Uw vuelve a pasar por el mismo item)', async () => {
  const avisos = [];
  const b = { glass_label: ETIQUETA };
  aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });
  aplicarVidrio(b, '4+12+4', { avisos });          // el bloque del Uw vuelve a pasar: no duplica el log
  const m = mundo();
  await m.avisar(avisos);
  assert.equal(m.visto.logs.length, 2, JSON.stringify(m.visto.logs));
  assert.match(m.visto.logs[0], /^vidrio\.producto_distinto .*CM-FR-004-2026-0601.*Laminado 6\+6.*4\+12\+4/);
  assert.match(m.visto.logs[1], /^vidrio\.bano_perdido .*CM-FR-004-2026-0601.*satén/);
});

test('el log del tablero sale SINCRÓNICO, antes de cualquier await (los llamadores no esperan esta promesa)', () => {
  const m = mundo();
  const p = m.avisar();
  assert.equal(m.logsDe('vidrio.bano_perdido').length, 1, 'ya está logueado al volver de la llamada');
  return p;
});

test('satén perdido ⇒ UN aviso de TEXTO por folio, con el folio y todas las etiquetas (y solo las del satén)', async () => {
  const avisos = [];
  aplicarVidrio({ glass_label: ETIQUETA }, '4+12+4', { avisos });
  aplicarVidrio({ glass_label: ETIQUETA }, '4+12+4', { avisos });   // misma etiqueta: una vez
  aplicarVidrio({ glass_label: 'Termopanel 5+12+5 esmerilado' }, '5+12+5', { avisos });
  aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', { avisos });          // otro producto: NO es para el dueño
  const m = mundo();
  await m.avisar(avisos);
  assert.equal(m.visto.texto.length, 1, `un solo aviso por folio: ${JSON.stringify(m.visto.texto)}`);
  assert.equal(m.visto.texto[0], textoBanoPerdido(FOLIO, [ETIQUETA, 'Termopanel 5+12+5 esmerilado']));
  assert.doesNotMatch(m.visto.texto[0], /Laminado/);
});

test('sin satén perdido NO se molesta al dueño ni se toca el almacén; y SIEMPRE devuelve una promesa', async () => {
  const avisos = [];
  aplicarVidrio({ glass_label: 'Laminado 6+6' }, '4+12+4', { avisos });
  aplicarVidrio({ glass_label: 'Termopanel DVH' }, '4+12+4', { avisos });
  const m = mundo();
  const p = m.avisar(avisos);
  assert.ok(p && typeof p.then === 'function', 'promesa también cuando no hay nada que avisar');
  assert.equal(await p, undefined);
  assert.deepEqual([m.visto.texto, m.visto.plantilla, m.visto.panel], [[], [], []], 'producto_distinto va al tablero, no al celular del dueño');
  assert.equal(m.kv.size, 0, 'ni siquiera se reserva');
  const q = m.avisar([]);
  assert.equal(typeof q.then, 'function');
  await q;
  assert.deepEqual(m.visto.texto, []);
});

/* ── LA CAUSA RAÍZ DE r7: texto Y plantilla, siempre ─────────────────────────────────────────────────── */

test('🔴 GUARDIA [r8] el texto salió (sent:true) y la plantilla SALE IGUAL: Meta acepta el texto fuera de la ventana y lo falla después', async () => {
  // Es EL defecto: en r7 esto era `sent:true` ⇒ «avisado» ⇒ la plantilla nunca salía. El bot no puede saber si
  // el 200 fue de verdad (ventana abierta) o el 200 engañoso de AGENTS.md:15-19 (ventana cerrada).
  const m = mundo({ texto: TEXTO_OK, plantilla: PLANTILLA_OK });
  await m.avisar();
  assert.equal(m.visto.texto.length, 1);
  assert.equal(m.visto.plantilla.length, 1, 'con el texto «enviado», la plantilla sale igual');
  assert.deepEqual(m.visto.plantilla[0], { folio: FOLIO, etiquetas: [ETIQUETA] },
    'avisarVidrio es dueño del folio: el closure del llamador ya no lo captura');
  assert.deepEqual(m.visto.panel, [], 'las dos salieron: nada que gritar');
  assert.deepEqual(m.logsDe('vidrio.aviso_no_salio'), []);
  assert.deepEqual(m.logsDe('vidrio.canal_degradado'), []);
});

test('el texto lo rechaza la ventana (131047 síncrono) y la plantilla sale: avisado, y el canal de texto queda dicho como degradado', async () => {
  const m = mundo({ texto: TEXTO_VENTANA, plantilla: PLANTILLA_OK });
  await m.avisar();
  assert.deepEqual(m.logsDe('vidrio.aviso_no_salio'), [], 'el dueño SÍ se enteró (plantilla)');
  assert.deepEqual(m.visto.panel, []);
  const deg = m.logsDe('vidrio.canal_degradado');
  assert.equal(deg.length, 1, JSON.stringify(m.visto.logs));
  assert.match(deg[0], new RegExp(FOLIO));
  assert.match(deg[0], /texto/);
  assert.match(deg[0], /131047/);
});

test('el texto salió y la plantilla falló por algo real ⇒ avisado (texto), pero el canal roto NO queda invisible (como #888)', async () => {
  const m = mundo({ texto: TEXTO_OK, plantilla: PLANTILLA_META_RECHAZA });
  await m.avisar();
  assert.deepEqual(m.logsDe('vidrio.aviso_no_salio'), []);
  assert.deepEqual(m.visto.panel, [], 'el dueño ya sabe: pedirle que mire a mano sería una alarma falsa');
  const deg = m.logsDe('vidrio.canal_degradado');
  assert.equal(deg.length, 1);
  assert.match(deg[0], /plantilla/);
  assert.match(deg[0], /132000/, 'el error de Meta, que vive en result.error del endpoint');
});

test('cooldown cuenta como avisado (el texto de este folio YA salió antes); y la plantilla también va', async () => {
  const m = mundo({ texto: TEXTO_COOLDOWN, plantilla: PLANTILLA_META_RECHAZA });
  await m.avisar();
  assert.deepEqual(m.logsDe('vidrio.aviso_no_salio'), []);
  assert.deepEqual(m.visto.panel, []);
  assert.equal(m.visto.plantilla.length, 1);
  const deg = m.logsDe('vidrio.canal_degradado');
  assert.equal(deg.length, 1, 'solo la plantilla: cooldown no es una falla');
  assert.doesNotMatch(deg[0], /texto/);
});

test('el notificador lanzó (null) pero la plantilla salió ⇒ avisado', async () => {
  const m = mundo({ texto: () => null, plantilla: PLANTILLA_OK });
  await m.avisar();
  assert.deepEqual(m.logsDe('vidrio.aviso_no_salio'), []);
  assert.deepEqual(m.visto.panel, []);
  assert.match(m.logsDe('vidrio.canal_degradado')[0], /excepcion/);
});

/* ── ninguno salió: log + UN evento en el panel, cualquiera sea el motivo ───────────────────────────── */

for (const [caso, texto, esperaTexto] of [
  ['Meta rechaza el texto (131047)', TEXTO_VENTANA, /envio_fallido code=131047/],
  ['no hay teléfono del dueño', () => ({ sent: false, reason: 'no_owner_phone' }), /no_owner_phone/],
  ['el notificador lanzó (safe() devuelve null)', () => null, /excepcion/],
  ['el notificador no confirmó nada ({})', () => ({}), /sin_confirmacion/],
  ['el notificador lanzó por dentro (reason excepcion)', () => ({ sent: false, reason: 'excepcion', error: 'socket hang up' }), /excepcion socket hang up/],
  ['un código de Meta que no es la ventana', () => ({ sent: false, reason: 'envio_fallido', code: 190, error: 'token vencido' }), /code=190 token vencido/],
  ['standard_lead (no puede pasar por acá, pero si pasara el dueño NO se enteró)', () => ({ sent: false, reason: 'standard_lead' }), /standard_lead/],
]) {
  test(`ninguno de los dos salió — ${caso} ⇒ log con AMBOS motivos y UN evento en el panel`, async () => {
    const m = mundo({ texto, plantilla: PLANTILLA_META_RECHAZA });
    await m.avisar();
    const noSalio = m.logsDe('vidrio.aviso_no_salio');
    assert.equal(noSalio.length, 1, JSON.stringify(m.visto.logs));
    assert.match(noSalio[0], new RegExp(FOLIO));
    assert.match(noSalio[0], esperaTexto, 'el motivo del texto');
    assert.match(noSalio[0], /132000/, 'y el de la plantilla: el error de Meta de result.error, no «sin_confirmacion»');
    assert.doesNotMatch(noSalio[0], /plantilla: sin_confirmacion/, 'BAJO-1: el motivo de Meta no se pierde en «sin_confirmacion»');

    // El MISMO mecanismo de la escalación #888 (webhook.js:1861): un evento en la conversación, con `aviso_fallido`.
    assert.equal(m.visto.panel.length, 1, `un evento: ${JSON.stringify(m.visto.panel)}`);
    const { body, metadata } = m.visto.panel[0];
    assert.match(body, new RegExp(FOLIO));
    assert.match(body, /satén/);
    assert.match(body, /NO salió/, 'dice qué pasó, no un código');
    assert.match(body, /a mano/, 'y qué hacer');
    assert.equal(metadata.aviso_fallido, true);
    assert.equal(metadata.folio, FOLIO);
    assert.deepEqual(metadata.etiquetas, [ETIQUETA]);
    assert.match(String(metadata.motivo_notify), esperaTexto);
    assert.match(String(metadata.motivo_template), /132000/);
  });
}

for (const [caso, plantilla, esperaMotivo] of [
  ['la plantilla la rechaza Meta (forma REAL del endpoint: el error en result.error)', PLANTILLA_META_RECHAZA, /Number of parameters mismatch/],
  ['falta ADMIN_PIN', PLANTILLA_SIN_PIN, /ADMIN_PIN_missing/],
  ['la plantilla lanzó (safe() devuelve null)', () => null, /excepcion/],
  ['la plantilla no confirma nada ({})', () => ({}), /sin_confirmacion/],
  ['el endpoint responde ok:true pero sent:false (candado de seguimiento)', () => ({ ok: true, sent: false, reason: 'candado_48h' }), /candado_48h/],
]) {
  test(`el motivo de la plantilla llega entero al log y al panel — ${caso}`, async () => {
    const m = mundo({ texto: TEXTO_VENTANA, plantilla });
    await m.avisar();
    assert.match(m.logsDe('vidrio.aviso_no_salio')[0], esperaMotivo);
    assert.match(String(m.visto.panel[0].metadata.motivo_template), esperaMotivo);
  });
}

test('un canal que RECHAZA su promesa (en vez de devolver null) tampoco revienta: se loguea, queda el evento y la propuesta sigue', async () => {
  const m = mundo({ texto: () => { throw new Error('socket hang up'); }, plantilla: () => { throw new Error('boom'); } });
  await assert.doesNotReject(m.avisar());
  assert.match(m.logsDe('vidrio.aviso_no_salio')[0], /socket hang up.*boom/);
  assert.equal(m.visto.panel.length, 1);
});

/* ── dudoso: pudo haber llegado ⇒ no se reenvía, y el panel dice «dudoso» ───────────────────────────── */

test('timeout de la plantilla (abort de 10 s) con el texto caído = DUDOSO: no se reenvía y el panel dice «dudoso, mirá el chat»', async () => {
  // El abort de escalation.js (10 s) vence ANTES que el axios del endpoint (20 s): la request ya salió y Meta
  // pudo entregarla. Tratarlo como «no salió» manda otra plantilla en el próximo reintento (duplicado al dueño).
  const m = mundo({ texto: TEXTO_VENTANA, plantilla: PLANTILLA_TIMEOUT });
  await m.avisar();
  assert.deepEqual(m.logsDe('vidrio.aviso_no_salio'), [], 'no se afirma que no salió');
  assert.equal(m.logsDe('vidrio.aviso_dudoso').length, 1);
  assert.equal(m.visto.panel.length, 1);
  assert.match(m.visto.panel[0].body, /dudoso/i);
  assert.match(m.visto.panel[0].body, /chat/i);
  assert.doesNotMatch(m.visto.panel[0].body, /NO salió/);
  assert.equal(m.visto.panel[0].metadata.dudoso, true);
  assert.equal(m.visto.panel[0].metadata.aviso_fallido, true);

  // Y NO se reenvía: la marca de «no repetir» quedó puesta.
  await m.avisar();
  assert.equal(m.visto.plantilla.length, 1, 'la plantilla no se reenvía ante la duda');
  assert.equal(m.visto.texto.length, 1);
  assert.equal(m.visto.panel.length, 1, 'ni se repite el evento');
});

test('el texto en timeout (envio_dudoso) y la plantilla caída = dudoso; con la plantilla OK es avisado y no hay evento', async () => {
  const dudoso = mundo({ texto: TEXTO_DUDOSO, plantilla: PLANTILLA_META_RECHAZA });
  await dudoso.avisar();
  assert.equal(dudoso.logsDe('vidrio.aviso_dudoso').length, 1);
  assert.match(dudoso.visto.panel[0].body, /dudoso/i);
  await dudoso.avisar();
  assert.equal(dudoso.visto.plantilla.length, 1, 'no se reenvía');

  const salvado = mundo({ texto: TEXTO_DUDOSO, plantilla: PLANTILLA_OK });
  await salvado.avisar();
  assert.deepEqual(salvado.visto.panel, []);
  assert.deepEqual(salvado.logsDe('vidrio.aviso_dudoso'), []);
});

/* ── una vez por folio: reserva atómica + marca durable + reloj ──────────────────────────────────────── */

test('una vez por folio: el mismo folio otra vez (corrección de IG) NO manda ni texto ni plantilla', async () => {
  const m = mundo();
  await m.avisar();
  await m.avisar();
  assert.equal(m.visto.texto.length, 1);
  assert.equal(m.visto.plantilla.length, 1);
  // Otro folio sí avisa.
  await m.avisar(SATEN(), 'CM-FR-004-2026-0602');
  assert.equal(m.visto.texto.length, 2);
  assert.equal(m.visto.plantilla.length, 2);
});

test('⏱️ reloj: la marca VENCE a los AVISO_VIDRIO_REPETIR_MS ⇒ vuelve a avisar; un milisegundo antes, no', async () => {
  const m = mundo();
  await m.avisar();
  m.reloj.avanzar(AVISO_VIDRIO_REPETIR_MS - 1);
  await m.avisar();
  assert.equal(m.visto.plantilla.length, 1, 'todavía dentro de la ventana');
  m.reloj.avanzar(1);
  await m.avisar();
  assert.equal(m.visto.texto.length, 2, 'vencida la ventana, vuelve a avisar');
  assert.equal(m.visto.plantilla.length, 2);
});

test('⏱️ reloj: la ventana la decide `tocaAvisar` sobre el `at` de la marca, no solo el TTL del almacén (el almacén durable puede devolver una marca vieja)', async () => {
  const m = mundo();
  await m.avisar();
  // Un almacén que NO vence (Postgres con TTL flojo): la marca sigue ahí pero es vieja.
  const kMarca = claveAvisoVidrio('vidrio', FOLIO, ETIQUETA, MOTOR);
  const marca = m.kv.get(kMarca);
  m.kv.set(kMarca, { valor: marca.valor, expira: Number.MAX_SAFE_INTEGER });
  m.reloj.avanzar(AVISO_VIDRIO_REPETIR_MS + 1);
  await m.avisar();
  assert.equal(m.visto.plantilla.length, 2, 'la marca ilegible/vieja no silencia para siempre');
});

test('la marca se escribe SOLO si el aviso llegó (o es dudoso): con la marca puesta nada se reenvía; sin ella, el reintento sale', async () => {
  const m = mundo({ texto: TEXTO_VENTANA, plantilla: PLANTILLA_META_RECHAZA });
  await m.avisar();
  assert.equal(m.escrituras.filter((e) => e.k === claveAvisoVidrio('vidrio', FOLIO, ETIQUETA, MOTOR)).length, 0, 'no llegó: sin marca');
  await m.avisar();
  assert.equal(m.visto.texto.length, 2, 'el reintento vuelve a intentar los DOS canales');
  assert.equal(m.visto.plantilla.length, 2);
});

test('la marca lleva `at` (lo que lee tocaAvisar) y vive exactamente la ventana de repetición', async () => {
  const m = mundo({ texto: TEXTO_OK, plantilla: PLANTILLA_OK });
  await m.avisar();
  const marca = m.escrituras.find((e) => e.k === claveAvisoVidrio('vidrio', FOLIO, ETIQUETA, MOTOR));
  assert.ok(marca, 'se escribió la marca bajo claveAvisoVidrio(\'vidrio\', folio, etiqueta, motor)');
  assert.equal(marca.v.at, m.reloj.ahora());
  assert.equal(marca.ttl, AVISO_VIDRIO_REPETIR_MS / 1000, 'una sola constante');
  assert.equal(marca.v.via, 'texto+plantilla');
  assert.deepEqual(marca.v.etiquetas, [ETIQUETA], 'la clave solo trae la identidad del vidrio: las etiquetas quedan adentro del valor, para poder auditar la marca');
});

test('🧱 la reserva y la marca viven en CLAVES DISTINTAS (si no, la reserva pisa la marca durable y tras un redeploy se lee a sí misma)', async () => {
  // estadoPersistente.reservar() hace escribir(clave, token): MEMORIA + PUT a Postgres. Con una sola clave, tras
  // un redeploy el PUT de la reserva pisa la marca durable y el leer() siguiente pega en MEMORIA (el token): el
  // «sobrevive al redeploy» no existe. Con dos claves, leer(marca) llega a Postgres.
  const m = mundo();
  const reservadas = [];
  const reservarOriginal = m.estado.reservar;
  m.estado.reservar = (k, ttl) => { reservadas.push(k); return reservarOriginal(k, ttl); };
  await m.avisar();
  const kMarca = claveAvisoVidrio('vidrio', FOLIO, ETIQUETA, MOTOR);
  assert.equal(reservadas.length, 1);
  assert.notEqual(reservadas[0], kMarca);
  assert.equal(reservadas[0], claveAvisoVidrio('vidrio_en_vuelo', FOLIO, ETIQUETA, MOTOR), 'la reserva tiene su propia clave, también por vidrio');
  assert.ok(m.escrituras.some((e) => e.k === kMarca));
  assert.ok(!m.escrituras.some((e) => e.k === reservadas[0]), 'y el aviso nunca escribe encima de la clave de la reserva');
});

test('BAJO-3: dos llamadas casi simultáneas del mismo folio mandan UNA sola plantilla (reserva atómica ANTES de enviar)', async () => {
  const m = mundo();
  const lenta = m.canales.plantilla;
  m.canales.plantilla = async (x) => { await new Promise((r) => { setImmediate(r); }); return lenta(x); };
  await Promise.all([m.avisar(), m.avisar(), m.avisar()]);
  assert.equal(m.visto.plantilla.length, 1);
  assert.equal(m.visto.texto.length, 1);
});

test('la reserva se suelta al terminar (aunque todo falle): el reintento siguiente PUEDE reservar', async () => {
  const m = mundo({ texto: () => { throw new Error('x'); }, plantilla: () => { throw new Error('y'); } });
  await m.avisar();
  await m.avisar();
  assert.equal(m.visto.plantilla.length, 2, 'si la reserva quedara tomada, el segundo intento ni empezaría');
});

/* ── el evento del panel: uno por folio, y solo si de verdad quedó escrito ──────────────────────────── */

test('BAJO-2: la marca del evento del panel se fija SOLO si pushConversationEvent devolvió ok:true (nunca lanza: devuelve {ok:false})', async () => {
  for (const [caso, panel] of [['skipped (ingesta apagada)', () => ({ ok: false, skipped: true })], ['{ok:false}', () => ({ ok: false })],
    ['null (safe() tragó una excepción)', () => null], ['undefined', () => undefined]]) {
    const m = mundo({ texto: TEXTO_VENTANA, plantilla: PLANTILLA_META_RECHAZA, panel });
    await m.avisar();
    await m.avisar();
    assert.equal(m.visto.panel.length, 2, `${caso}: el evento no quedó escrito ⇒ el reintento lo vuelve a intentar`);
  }
  const bien = mundo({ texto: TEXTO_VENTANA, plantilla: PLANTILLA_META_RECHAZA, panel: PANEL_OK });
  await bien.avisar();
  await bien.avisar();
  await bien.avisar();
  assert.equal(bien.visto.panel.length, 1, 'ok:true ⇒ UN evento, no uno por reintento');
  // …y pasada la ventana, si el problema sigue, se vuelve a avisar.
  bien.reloj.avanzar(AVISO_VIDRIO_REPETIR_MS);
  await bien.avisar();
  assert.equal(bien.visto.panel.length, 2);
});

test('un canal del panel que lanza no rompe nada', async () => {
  const m = mundo({ texto: TEXTO_VENTANA, plantilla: PLANTILLA_META_RECHAZA, panel: () => { throw new Error('panel caido'); } });
  await assert.doesNotReject(m.avisar());
  assert.equal(m.logsDe('vidrio.aviso_no_salio').length, 1, 'el log queda aunque el evento falle');
});

test('ante la duda, avisa: si NO se puede leer la marca, el aviso sale igual; si no se puede escribir, no revienta', async () => {
  const m = mundo();
  m.estado.leer = async () => { throw new Error('kv caido'); };
  await assert.doesNotReject(m.avisar());
  assert.equal(m.visto.texto.length, 1);
  assert.equal(m.visto.plantilla.length, 1);
  const n = mundo();
  n.estado.escribir = () => { throw new Error('kv caido'); };
  await assert.doesNotReject(n.avisar());
  assert.equal(n.visto.plantilla.length, 1);
});

/* ── con el almacén REAL (services/estadoPersistente.js, solo memoria en los tests) ──────────────────── */

test('🧪 con estadoPersistente REAL: avisa una vez por folio; si no llegó, la reserva se suelta y el reintento sale', async () => {
  estadoReal._reset();
  const estado = { reservar: estadoReal.reservar, liberar: estadoReal.liberarReserva, leer: estadoReal.leer, escribir: estadoReal.escribir };
  const folio = 'CM-FR-004-2026-0650';
  const llamadas = { texto: 0, plantilla: 0 };
  let sana = false;
  const canales = {
    texto: async () => { llamadas.texto += 1; return sana ? TEXTO_OK() : TEXTO_VENTANA(); },
    plantilla: async () => { llamadas.plantilla += 1; return sana ? PLANTILLA_OK() : PLANTILLA_META_RECHAZA(); },
    panel: async () => PANEL_OK(),
  };
  const avisar = () => avisarVidrio({ avisos: SATEN(), folio, logWarn: () => {}, canales, estado });
  await avisar();                                    // no llegó
  await avisar();
  assert.deepEqual(llamadas, { texto: 2, plantilla: 2 }, 'sin marca ni reserva colgada: reintenta los dos');
  sana = true;
  await avisar();
  assert.deepEqual(llamadas, { texto: 3, plantilla: 3 });
  await avisar();                                    // llegó: la marca real corta
  await avisar();
  assert.deepEqual(llamadas, { texto: 3, plantilla: 3 }, 'una vez por folio con el almacén real');
  assert.ok(estadoReal.leerLocal(claveAvisoVidrio('vidrio', folio, ETIQUETA, MOTOR))?.at > 0, 'la marca quedó en el almacén');
  assert.ok(estadoReal.reservar(claveAvisoVidrio('vidrio_en_vuelo', folio, ETIQUETA, MOTOR), 1), 'y la reserva en vuelo está libre');
  estadoReal._reset();
});

/* ── #1089 y #1090: la marca de «ya avisé» es por FOLIO + VIDRIO y dura lo que vive el folio reusado ──────────────────
 *
 * CAUSA RAÍZ (las dos tienen la misma raíz: la marca decía «este FOLIO ya se avisó» y nada más):
 *  · #1089: las tres claves (marca, panel, reserva en vuelo) salían de `claveAviso(tipo, folio)`. El vidrio no entraba
 *    en la clave, así que una corrección del cliente en IG —que REUSA el folio— con un satén NUEVO pegaba contra la
 *    marca (y contra la reserva) del primero y salía por la puerta sin avisar. La otra cara se vio después: con la
 *    clave sacada del TEXTO de la etiqueta, el mismo satén dicho con otras palabras («satinado», «Satén baño») contaba
 *    como nuevo y avisaba otra vez; la clave sale del sentido (`identidadDeVidrio`).
 *  · #1090: la vida de la marca era `COOLDOWN_MS` (2 h), la ventana del cooldown del TEXTO en highValueNotifier. El
 *    folio se reusa hasta 48 h (FOLIO_REUSO_MS): pasadas 2 h, el MISMO folio con los MISMOS vidrios volvía a mandar
 *    texto y plantilla, cada 2 h, mientras la corrección siguiera.
 * Cada prueba se puso en ROJO con el defecto puesto antes de tocar el código. */

const SATEN_5 = '5+12+5 satén (dormitorio)';          // otro vidrio de verdad: otro espesor
/** Los avisos que junta `aplicarVidrio` para estas etiquetas (todas satén y el motor cotizó claro). */
const avisosDe = (...etiquetas) => {
  const avisos = [];
  for (const e of etiquetas) aplicarVidrio({ glass_label: e }, MOTOR, { avisos });
  return avisos;
};

test('🔴 [#1089] una corrección del MISMO folio con un vidrio NUEVO se avisa, y solo ese; los que ya se avisaron no se repiten', async () => {
  const m = mundo();
  await m.avisar(avisosDe(ETIQUETA));
  m.reloj.avanzar(10 * 60 * 1000);                      // el cliente corrige en IG: el folio se REUSA
  await m.avisar(avisosDe(ETIQUETA, SATEN_5));
  assert.equal(m.visto.texto.length, 2, `el vidrio nuevo tiene que avisarse: ${JSON.stringify(m.visto.texto)}`);
  assert.equal(m.visto.texto[1], textoBanoPerdido(FOLIO, [SATEN_5]), 'el aviso habla solo del nuevo: el otro ya se le dijo al dueño');
  assert.deepEqual(m.visto.plantilla.at(-1), { folio: FOLIO, etiquetas: [SATEN_5] });
  // Los dos juntos, en cualquier orden, ya no son novedad.
  await m.avisar(avisosDe(SATEN_5, ETIQUETA));
  await m.avisar(avisosDe(ETIQUETA));
  assert.equal(m.visto.texto.length, 2, 'ni el orden ni un subconjunto de lo ya avisado vuelve a molestar al dueño');
  assert.equal(m.visto.plantilla.length, 2);
});

test('[#1089] mayúsculas, tildes y espacios de más no vuelven «nuevo» al mismo vidrio', async () => {
  const m = mundo();
  await m.avisar(avisosDe('4+12+4 satén (baño)'));
  await m.avisar(avisosDe('4+12+4  SATEN  (BAÑO) '));
  await m.avisar(avisosDe('4+12+4 Saten (bano)'));
  assert.equal(m.visto.texto.length, 1);
  assert.equal(m.visto.plantilla.length, 1);
});

test('🔴 [#1089] dos llamadas SIMULTÁNEAS del mismo folio con vidrios distintos: cada vidrio se avisa UNA vez (la reserva es por vidrio; el nuevo no se pierde)', async () => {
  const m = mundo();
  await Promise.all([m.avisar(avisosDe(ETIQUETA)), m.avisar(avisosDe(ETIQUETA, SATEN_5))]);
  const dichas = m.visto.texto.join('\n');
  assert.equal(m.visto.texto.length, 2, `una por llamada: ${JSON.stringify(m.visto.texto)}`);
  assert.equal(dichas.split(`"${ETIQUETA}"`).length - 1, 1, 'el vidrio compartido se avisa una sola vez');
  assert.equal(dichas.split(`"${SATEN_5}"`).length - 1, 1, 'y el nuevo no se pierde porque la otra llamada tenía el folio en vuelo');
});

test('🔴 [#1089] fraseos distintos del MISMO satén en el mismo folio avisan UNA sola vez; un vidrio distinto de verdad sí avisa', async () => {
  const m = mundo();
  await m.avisar(avisosDe('4+12+4 satén (baño)'));
  m.reloj.avanzar(60_000);
  for (const otroFraseo of ['4+12+4 satinado (baño)', 'Satén baño', 'Termopanel satén', '4/12/4 SATÉN', 'DVH 4-12-4 esmerilado']) {
    await m.avisar(avisosDe(otroFraseo));
    m.reloj.avanzar(60_000);
  }
  assert.equal(m.visto.texto.length, 1, `el mismo satén con otras palabras no es novedad: ${JSON.stringify(m.visto.texto)}`);
  assert.equal(m.visto.plantilla.length, 1);
  // …pero un satén de OTRO espesor es otro vidrio: ese sí se avisa (y solo ese).
  await m.avisar(avisosDe('5+12+5 satén (baño)'));
  assert.equal(m.visto.texto.length, 2);
  assert.equal(m.visto.texto[1], textoBanoPerdido(FOLIO, ['5+12+5 satén (baño)']));
});

test('[#1089] dos etiquetas del MISMO vidrio en una misma emisión salen juntas en UN aviso (se listan las dos), y después ninguna se repite', async () => {
  const m = mundo();
  await m.avisar(avisosDe('4+12+4 satén (baño)', 'Termopanel 4+12+4 esmerilado'));
  assert.equal(m.visto.texto.length, 1);
  assert.equal(m.visto.texto[0], textoBanoPerdido(FOLIO, ['4+12+4 satén (baño)', 'Termopanel 4+12+4 esmerilado']), 'el dueño ve las dos etiquetas del documento');
  assert.deepEqual(m.visto.plantilla[0].etiquetas, ['4+12+4 satén (baño)', 'Termopanel 4+12+4 esmerilado']);
  await m.avisar(avisosDe('Termopanel 4+12+4 esmerilado'));
  await m.avisar(avisosDe('4+12+4 satén (baño)'));
  assert.equal(m.visto.texto.length, 1);
});

test('🔴 [#1090] el MISMO folio con los MISMOS vidrios NO se repite por días: ni a las 2 h, ni a las 47 h; vuelve recién pasada la vida del folio reusado + margen', async () => {
  const H = 3600_000;
  const m = mundo();
  const t0 = m.reloj.ahora();
  const avanzarHasta = (ms) => m.reloj.avanzar(ms - (m.reloj.ahora() - t0));   // ms desde el primer aviso
  await m.avisar();
  for (const horas of [2.01, 12, 47.9, 48.5, 71.9]) {
    avanzarHasta(horas * H);
    await m.avisar();
    assert.equal(m.visto.texto.length, 1, `a las ${horas} h el aviso ya se repitió: el folio reusado sigue siendo el mismo folio`);
    assert.equal(m.visto.plantilla.length, 1, `a las ${horas} h la plantilla se repitió`);
  }
  avanzarHasta(AVISO_VIDRIO_REPETIR_MS);                // vencida la marca
  await m.avisar();
  assert.equal(m.visto.texto.length, 2, 'vencida la marca, un problema que sigue ahí vuelve a avisarse');
  assert.equal(m.visto.plantilla.length, 2);
});
