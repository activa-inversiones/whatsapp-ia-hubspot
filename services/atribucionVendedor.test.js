// GUARDIAS DE UNA DECISIÓN DEL DUEÑO (30-sep-2026), no de una implementación:
//   «Cuando un vendedor de /equipo con oliver_interno cotiza por WhatsApp con Oliver, puede
//    ratificar el teléfono del cliente; si el cliente no existe como lead se crea, y la
//    cotización cuenta al CLIENTE (no al vendedor), con su folio ISO normal».
// Si alguno de estos tests se pone rojo, alguien está deshaciendo esa decisión. Darlo vuelta
// requiere una orden nueva del dueño, escrita acá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { identidadCotizacion, leadDeAtribucion, clickIdsDe, clavesCotizacion, resolverTurno } from './identidadCotizacion.js';
import { procesarComandoCliente, mensajeTrasPdf, parseComandoCliente, autorizaComandoCliente } from './comandoCliente.js';
import { fijar, obtener, limpiar, limpiarSiMisma, vigenciaMs, _resetAtribuciones } from './atribucionStore.js';
import { yaNosEscribio, _resetConsentimiento } from './consentimiento.js';
import { aplicarLista, perfilEquipo, telefonoDuenio, DUENIO_DEFAULT, _reiniciarParaTests } from './internosEquipo.js';
const _reset = () => { _resetAtribuciones(); _resetConsentimiento(); };
const VIGENCIA_MS = vigenciaMs();
// [reordenamiento 30-sep] Las 7 funciones sueltas de rol/permiso pasaron a UNA: perfilEquipo.
const puedeFijar = (p) => perfilEquipo(p).puedeFijar;

const ADMIN = '56957296035';
const VENDEDOR = '56911110000';
const OTRO = '56922220000';
const JUAN = '56987654321';
const PEDRO = '56912345678';

test('decisión dueño 30-sep: solo el dueño o un vendedor con oliver_interno (número COMPLETO) usan CLIENTE', () => {
  _reiniciarParaTests();
  const prev = process.env.ADMIN_PHONE; process.env.ADMIN_PHONE = ADMIN;
  try {
    assert.equal(puedeFijar(VENDEDOR), false, 'lista nunca cargada ⇒ fail-closed');
    assert.equal(puedeFijar(ADMIN), true, 'el dueño sigue pudiendo');
    aplicarLista({ internos_ult9: ['911110000', '922220000'], vendedores: [
      { ult9: '911110000', telefono: VENDEDOR, oliver_interno: true },
      { ult9: '922220000', telefono: OTRO, oliver_interno: false },   // del equipo, sin modo interno
    ] });
    assert.equal(puedeFijar(VENDEDOR), true, 'vendedor con oliver_interno puede');
    assert.equal(puedeFijar('+56 9 1111 0000'), true, 'mismo número, otro formato');
    assert.equal(puedeFijar(OTRO), false, 'del equipo sin modo interno NO puede');
    assert.equal(puedeFijar('34911110000'), false, 'misma cola de 9, otro país: NO (Codex)');
    assert.equal(puedeFijar('56933334444'), false, 'un cliente cualquiera NO puede');
  } finally {
    if (prev === undefined) delete process.env.ADMIN_PHONE; else process.env.ADMIN_PHONE = prev;
    _reiniciarParaTests();
  }
});

test('decisión dueño 30-sep: si sales-os no manda el teléfono completo, ningún vendedor usa CLIENTE', () => {
  _reiniciarParaTests();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', oliver_interno: true }] });
  assert.equal(puedeFijar(VENDEDOR), false);
  _reiniciarParaTests();
});

test('decisión dueño 30-sep: index.js y webhook.js usan la MISMA regla de autorización y de dueño', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, '..', 'index.js'), 'utf8');
  // [r4 #5/#1] index.js autoriza con autorizaComandoCliente y corre el comando con el lock del webhook.
  assert.match(src, /autorizaComandoCliente\(normalizeWaId\(_atInc\.waId\), _atInc\.text \|\| ""\)/);
  assert.match(src, /conLockDeTelefono\(normalizeWaId\(_atInc\.waId\), \(\) => procesarComandoCliente\(/);
  assert.match(src, /const ADMIN_PHONE = process\.env\.ADMIN_PHONE \|\| DUENIO_DEFAULT;/);
  const wh = fs.readFileSync(path.join(dir, '..', 'src', 'oliver-gpt', 'webhook.js'), 'utf8');
  // [reordenamiento 30-sep] El rol y la atribución del turno salen de UNA foto (resolverTurno →
  // perfilEquipo), la misma función que usa index.js vía autorizaComandoCliente.
  assert.match(wh, /const turno = resolverTurno\(from, Date\.now\(\), \{ tsMensaje: msDeMensaje\(inbound\.enviadoAt\) \}\);/);
  assert.doesNotMatch(src, /import\("\.\/src\/oliver-gpt\/webhook\.js"\)[\s\S]{0,80}conLockDeTelefono/, 'index.js no toma el lock de webhook.js');
});

test('reordenamiento 30-sep: index.js y webhook.js usan el MISMO lock (misma clave con cualquier formato)', async () => {
  const { acquireLock } = await import('./lockTelefono.js');
  const locks = new Map();
  const r1 = await acquireLock('+56 9 1111 0000', locks);
  let segundo = false;
  const p = acquireLock('56911110000', locks).then((r) => { segundo = true; r(); });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(segundo, false, 'el mismo teléfono en otro formato espera al primero');
  r1(); await p;
  assert.equal(segundo, true);
});

test('telefonoDuenio: ADMIN_PHONE, y si no está, el número por defecto (mismo orden que index.js)', () => {
  const prev = process.env.ADMIN_PHONE;
  delete process.env.ADMIN_PHONE;
  assert.equal(telefonoDuenio(), DUENIO_DEFAULT.replace(/\D/g, ''));
  process.env.ADMIN_PHONE = '+56 9 0000 1111';
  assert.equal(telefonoDuenio(), '56900001111');
  if (prev === undefined) delete process.env.ADMIN_PHONE; else process.env.ADMIN_PHONE = prev;
});

test('decisión dueño 30-sep: con atribución la identidad es del CLIENTE y cotizado_por = últimos 9 de quien cotizó', () => {
  const id = identidadCotizacion(VENDEDOR, { phone: JUAN, name: 'Juan' });
  assert.equal(id.telefonoCliente, JUAN);
  assert.equal(id.claveCot, `${VENDEDOR}:${JUAN}`);
  assert.equal(id.cotizadoPor, '911110000');
  // [Tridente r3 #6] external_id sale de la IDENTIDAD (externalId), no de un spread que pisa otro valor.
  assert.equal(id.externalId, JUAN);
  assert.deepEqual(id.extraLead, { cotizado_por: '911110000', no_pisar: true, source: 'vendedor_equipo' });
  const sin = identidadCotizacion(VENDEDOR, null);
  assert.deepEqual(sin, { telefonoCliente: VENDEDOR, externalId: VENDEDOR, claveCot: VENDEDOR, cotizadoPor: null, atribuida: false, extraLead: {} });
});

test('decisión 30-sep: de quién es cada clave de estado (informes/entregas/deal/reset del CLIENTE; folio del par)', () => {
  const id = identidadCotizacion(VENDEDOR, { phone: JUAN });
  const c = clavesCotizacion({ from: VENDEDOR, telefonoCliente: id.telefonoCliente, claveCot: id.claveCot });
  assert.equal(c.informeTermico('h1'), `informe_termico:${JUAN}:h1`);
  assert.equal(c.informeTermico(''), `informe_termico:${JUAN}`);
  assert.equal(c.informeVientos('h2'), `informe_vientos:${JUAN}:h2`);
  assert.equal(c.letraTermico, `informe_letra:${JUAN}:termico`);
  assert.equal(c.letraVientos, `informe_letra:${JUAN}:vientos`);
  assert.equal(c.reset, `informe_reset:${JUAN}`, 'el reset del dueño destraba los candados del cliente');
  assert.equal(c.deal, `deal:${JUAN}`, 'un Deal por cliente, igual que Zoho');
  assert.equal(c.cliente, JUAN);
  assert.equal(c.quotesig, `quotesig:${VENDEDOR}${JUAN}`, 'el dedup de folio es del par quien-escribe+cliente');
  assert.equal(c.emision('x'), `quote_emision:${VENDEDOR}${JUAN}:x`);
  // Sin atribución: todo es de quien escribe, como siempre.
  const s = clavesCotizacion({ from: '56933334444', telefonoCliente: '56933334444', claveCot: '56933334444' });
  assert.equal(s.deal, 'deal:56933334444');
  assert.equal(s.quotesig, 'quotesig:56933334444');
});

test('decisión dueño 30-sep: con atribución no viajan los click-ids de quien escribe', () => {
  const s = { fbclid: 'f', gclid: 'g', ttclid: 't', ctwa_clid: 'c', ad_id: 'a', landing_lead_id: 'l' };
  assert.deepEqual(clickIdsDe(s, null), { fbclid: 'f', gclid: 'g', ttclid: 't', ctwa_clid: 'c', ad_id: 'a', landing_ref: 'l' });
  assert.deepEqual(clickIdsDe(s, { phone: JUAN }),
    { fbclid: null, gclid: null, ttclid: null, ctwa_clid: null, ad_id: null, landing_ref: null });
});

test('decisión dueño 30-sep: UNA regla de rol (dueño / vendedor / nadie)', () => {
  _reiniciarParaTests();
  const prev = process.env.ADMIN_PHONE; process.env.ADMIN_PHONE = ADMIN;
  try {
    aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] });
    assert.equal(perfilEquipo(ADMIN).rol, 'duenio');
    assert.equal(perfilEquipo(VENDEDOR).rol, 'vendedor');
    assert.equal(perfilEquipo(OTRO).rol, null);
    // [Thermos r4] El ROL usa la última lista conocida (sin antigüedad); la antigüedad solo frena FIJAR.
    aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] },
      Date.now() - 60 * 60 * 1000);
    const p = perfilEquipo(VENDEDOR);
    assert.deepEqual([p.rol, p.puedeFijar, p.puedeTerminar, p.motivoBloqueo], ['vendedor', false, true, 'lista_desactualizada']);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_PHONE; else process.env.ADMIN_PHONE = prev;
    _reiniciarParaTests();
  }
});

test('decisión dueño 30-sep: al fijar cliente se crea su lead con su teléfono, sin pisar uno existente', () => {
  const l = leadDeAtribucion(VENDEDOR, '+56 9 8765 4321', 'Juan Pérez');
  assert.equal(l.phone, JUAN);
  assert.equal(l.external_id, JUAN);
  assert.equal(l.name, 'Juan Pérez');
  assert.equal(l.cotizado_por, '911110000');
  assert.equal(l.no_pisar, true);
  assert.equal(l.source, 'vendedor_equipo');
  assert.ok(!JSON.stringify(l).includes(VENDEDOR), 'no expone el número completo del vendedor');
});

test('E 30-sep: limpiarSiMisma solo borra la MISMA versión (carrera CLIENTE Juan → CLIENTE Pedro)', () => {
  _reset();
  const juan = fijar(VENDEDOR, JUAN, 'Juan');
  const pedro = fijar(VENDEDOR, PEDRO, 'Pedro');
  assert.equal(limpiarSiMisma(VENDEDOR, juan.gen), false, 'la versión vieja no borra la nueva');
  assert.equal(obtener(VENDEDOR).phone, PEDRO);
  assert.equal(limpiarSiMisma(VENDEDOR, pedro.gen), true);
  assert.equal(obtener(VENDEDOR), null);
  _reset();
});

test('«Cliente explícito» 30-sep: CLIENTE fija; CLIENTE OFF termina; el TTL cuenta desde que se fijó (usarla NO la renueva)', async () => {
  _reset();
  const pushes = [];
  const msg = await procesarComandoCliente({ waId: VENDEDOR, texto: `CLIENTE Juan Pérez +${JUAN}`,
    pushLead: async (p) => { pushes.push(p); }, escribio: async () => false, marcar: () => {}, esDelEquipo: () => false });
  assert.match(msg, /Cotizando para \*Juan Pérez\*/);
  assert.equal(pushes[0].phone, JUAN);
  assert.equal(obtener(VENDEDOR).phone, JUAN);
  assert.match(mensajeTrasPdf(obtener(VENDEDOR)), /Propuesta de \*Juan Pérez\* emitida\. Para corregirla manda CLIENTE Juan Pérez \+56987654321/);
  await procesarComandoCliente({ waId: VENDEDOR, texto: 'CLIENTE OFF', pushLead: async () => {} });
  assert.equal(obtener(VENDEDOR), null, 'CLIENTE OFF la termina');

  const realNow = Date.now;
  try {
    let t = realNow();
    Date.now = () => t;
    fijar(VENDEDOR, JUAN, 'Juan');
    t += VIGENCIA_MS - 1000; assert.ok(obtener(VENDEDOR), 'dentro de la vigencia');
    t += 2000;               assert.equal(obtener(VENDEDOR), null, 'usarla no la renovó: vence a las 2 h de fijada');
  } finally { Date.now = realNow; _reset(); }
});

test('Tridente r3 #5 (30-sep): CLIENTE con dos números de 9+ dígitos (RUT + celular) y ninguno con 56 → ambiguo, se rechaza', () => {
  // [Reordenamiento 30-sep, regla H decidida por el dueño] CAMBIO DECIDIDO: regla simple — se saca
  // el RUT y se acepta solo si queda EXACTAMENTE un celular chileno. "123456789" no es celular
  // (no empieza con 9), así que el único celular es 987654321 y se acepta (en r3 se rechazaba).
  for (const t of ['CLIENTE Juan Pérez 123456789 987654321', 'CLIENTE Juan Pérez 123456789, 987654321']) {
    const r = parseComandoCliente(t);
    assert.equal(r.ok, true, t);
    assert.equal(r.phone, '56987654321');
  }
  // Dos celulares: ambiguo, se rechaza con el formato de ejemplo.
  const dos = parseComandoCliente('CLIENTE Juan Pérez 912345678 987654321');
  assert.equal(dos.ok, false);
  assert.match(dos.error, /\+569/, 'pide el formato +569…');
  // [Tridente r4 #7] CAMBIO DECIDIDO: un RUT escrito como RUT (con guion) se reconoce y NO cuenta
  // como número; el celular que queda es inequívoco. (En r3 este caso se rechazaba.)
  const conRut = parseComandoCliente('CLIENTE Juan Pérez 12.345.678-9 9 8765 4321');
  assert.equal(conRut.ok, true, JSON.stringify(conRut));
  assert.equal(conRut.phone, '56987654321');
  // Con +56 / 56 se elige ESE, aunque haya otro número.
  const r = parseComandoCliente('CLIENTE Juan Pérez 12.345.678-9 +56 9 8765 4321');
  assert.equal(r.ok, true);
  assert.equal(r.phone, '56987654321');
  assert.equal(r.name.includes('12.345.678-9'), true, 'el otro número queda en el texto, no se toma como teléfono');
  // [Thermos r6] Bloque pegado que EMPIEZA con 56 pero trae dos números (20 dígitos): no se acepta crudo.
  const pegado = parseComandoCliente('CLIENTE Juan +56912345678 987654321');
  assert.equal(pegado.ok, false, 'no acepta un "teléfono" de 20 dígitos');
  assert.match(pegado.error, /más de un número/);
  // Un solo número: como siempre.
  assert.equal(parseComandoCliente('CLIENTE Juan 987654321').phone, '56987654321');
});

test('Tridente r4 #7 (30-sep): CLIENTE acepta SOLO celular chileno; un "56…" que no es celular no gana', () => {
  const r1 = parseComandoCliente('CLIENTE Juan 123456789');           // 9 dígitos que NO empiezan con 9
  assert.equal(r1.ok, false);
  assert.match(r1.error, /celular chileno/);
  const r2 = parseComandoCliente('CLIENTE Juan 56789012-3 912345678'); // RUT que empieza con 56 + celular
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.phone, '56912345678', 'gana el celular, no el RUT');
  const r3 = parseComandoCliente('CLIENTE Juan +34 912 345 678');     // extranjero
  assert.equal(r3.ok, false);
  assert.match(r3.error, /celular chileno/);
});

test('Tridente r4 #5 (30-sep): CLIENTE OFF funciona aunque la lista tenga >30 min (la antigüedad solo frena FIJAR)', () => {
  _reiniciarParaTests();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] },
    Date.now() - 31 * 60 * 1000);
  assert.equal(autorizaComandoCliente(VENDEDOR, 'CLIENTE OFF'), true, 'OFF se acepta');
  assert.equal(autorizaComandoCliente(VENDEDOR, `CLIENTE Juan +${JUAN}`), false, 'fijar uno nuevo, no');
  assert.equal(autorizaComandoCliente('56933334444', 'CLIENTE OFF'), false, 'un cliente cualquiera no');
  _reiniciarParaTests();
});

test('Tridente r4 #6 (30-sep): un +34 con la misma cola que un vendedor con número completo es CLIENTE, no equipo', () => {
  _reiniciarParaTests();
  aplicarLista({ internos_ult9: ['912345678'], vendedores: [{ ult9: '912345678', telefono: '56912345678', oliver_interno: true }] });
  assert.notEqual(perfilEquipo('34912345678').rol, 'vendedor_ambiguo', 'el vendedor tiene número completo y es otro');
  assert.equal(perfilEquipo('34912345678').esEquipo, false, 'se le puede fijar como cliente');
  assert.equal(perfilEquipo('56912345678').esEquipo, true, 'el vendedor sí es del equipo');
  // Vendedor SIN número completo cargado: por la cola no se puede distinguir → se trata como equipo.
  aplicarLista({ internos_ult9: ['912345678'], vendedores: [{ ult9: '912345678', oliver_interno: true }] });
  assert.equal(perfilEquipo('34912345678').rol, 'vendedor_ambiguo');
  assert.equal(perfilEquipo('34912345678').esEquipo, true);
  assert.equal(perfilEquipo('34912345678').motivoBloqueo, 'no_habilitado');
  _reiniciarParaTests();
});

test('Tridente r4 #1 (30-sep): la FOTO del turno (resolverTurno) no se relee aunque cambie la atribución', () => {
  _reset();
  let actual = { phone: JUAN, name: 'Juan', gen: 1 };
  const turno = resolverTurno(VENDEDOR, Date.now(), {
    perfil: () => ({ rol: 'vendedor', puedeFijar: true, puedeTerminar: true, motivoBloqueo: null }),
    leerAtribucion: () => actual,
  });
  actual = { phone: PEDRO, name: 'Pedro', gen: 2 };     // entró CLIENTE Pedro a mitad del turno de Juan
  assert.equal(turno.cliente, JUAN, 'la foto del turno (Juan) manda');
  const sin = resolverTurno(OTRO, Date.now(), { perfil: () => ({ rol: null }), leerAtribucion: () => actual });
  assert.equal(sin.cliente, OTRO, 'sin permiso no hay atribución: quien escribe');
  _reset();
});

test('Thermos conjunto #6: el texto dice mandar CLIENTE y ESPERAR la confirmación antes de las fotos', async () => {
  const { TEXTO_PEDIR_CLIENTE_INTERNO } = await import('./internosEquipo.js');
  assert.match(TEXTO_PEDIR_CLIENTE_INTERNO, /espera mi confirmación antes de mandar fotos/);
  _reset();
  const msg = await procesarComandoCliente({ waId: VENDEDOR, texto: `CLIENTE Juan +${JUAN}`,
    pushLead: async () => {}, escribio: async () => true, marcar: () => {}, esDelEquipo: () => false });
  assert.match(msg, /fotos o audios del cliente mándalos DESPUÉS de esta confirmación/);
  _reset();
});

test('M2 r10: un mensaje mandado ANTES de «CLIENTE Pedro» (hora WhatsApp) sigue siendo de Juan', () => {
  _reset();
  const T = Date.now();
  fijar(VENDEDOR, JUAN, 'Juan', { desde: Math.floor((T - 60000) / 1000) });
  fijar(VENDEDOR, PEDRO, 'Pedro', { desde: Math.floor(T / 1000) });            // segundos, como Meta
  assert.equal(obtener(VENDEDOR, { tsMensaje: Math.floor((T - 5000) / 1000) })?.phone, JUAN, 'enviado antes: Juan');
  assert.equal(obtener(VENDEDOR, { tsMensaje: Math.floor(T / 1000) })?.phone, PEDRO, 'mismo segundo: cuenta como posterior');
  assert.equal(obtener(VENDEDOR)?.phone, PEDRO, 'sin hora: la actual');
  // Sin atribución previa: el mensaje anterior se procesa SIN atribución.
  _reset();
  fijar(VENDEDOR, PEDRO, 'Pedro', { desde: Math.floor(T / 1000) });
  assert.equal(obtener(VENDEDOR, { tsMensaje: Math.floor((T - 5000) / 1000) }), null);
  // Y lo mismo con CLIENTE OFF: lo mandado antes del OFF sigue siendo de Pedro.
  limpiar(VENDEDOR, { desde: Math.floor((T + 10000) / 1000) });
  assert.equal(obtener(VENDEDOR, { tsMensaje: Math.floor((T + 5000) / 1000) })?.phone, PEDRO);
  assert.equal(obtener(VENDEDOR), null);
  _reset();
});

test('5 · CLIENTE rechaza el propio número de quien escribe y cualquier número del equipo', async () => {
  _reset();
  const r1 = await procesarComandoCliente({ waId: VENDEDOR, texto: `CLIENTE Yo Mismo +${VENDEDOR}`,
    pushLead: async () => {}, escribio: async () => false, marcar: () => {}, esDelEquipo: () => false });
  assert.match(r1, /^⚠️/);
  assert.equal(obtener(VENDEDOR), null);
  const r2 = await procesarComandoCliente({ waId: VENDEDOR, texto: `CLIENTE Colega +${OTRO}`,
    pushLead: async () => {}, escribio: async () => false, marcar: () => {}, esDelEquipo: (p) => p === OTRO });
  assert.match(r2, /^⚠️/);
  assert.equal(obtener(VENDEDOR), null);
  _reset();
});

test('10 · si la lista del equipo no se refrescó con éxito en 30 min, CLIENTE se rechaza (fail-closed por antigüedad)', () => {
  _reiniciarParaTests();
  const hace31 = Date.now() - 31 * 60 * 1000;
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] }, hace31);
  assert.equal(puedeFijar(VENDEDOR), false);
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] });
  assert.equal(puedeFijar(VENDEDOR), true);
  _reiniciarParaTests();
});

test('F1 30-sep: "ya nos escribió" solo si ese número escribió al bot (ser lead no cuenta)', async () => {
  _reset();
  assert.equal(await yaNosEscribio(JUAN, async () => null), false);
  assert.equal(await yaNosEscribio(JUAN, async () => { throw new Error('red'); }), false, 'ante error: se marca');
  assert.equal(await yaNosEscribio(JUAN, async (k) => (k === `escribio:${JUAN}` ? true : null)), true);
  // Y el comando marca "sin consentimiento" salvo que haya escrito.
  const marcados = [];
  await procesarComandoCliente({ waId: VENDEDOR, texto: `CLIENTE Juan +${JUAN}`, pushLead: async () => {},
    escribio: async () => false, marcar: (p) => marcados.push(p), esDelEquipo: () => false });
  await procesarComandoCliente({ waId: VENDEDOR, texto: `CLIENTE Pedro +${PEDRO}`, pushLead: async () => {},
    escribio: async () => true, marcar: (p) => marcados.push(p), esDelEquipo: () => false });
  assert.deepEqual(marcados, [JUAN]);
  _reset();
});
