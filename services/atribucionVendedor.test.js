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

import {
  puedeUsarComandoCliente, identidadCotizacion, leadDeAtribucion, clickIdsDe, rolCotizador,
  clavesCotizacion, procesarComandoCliente, mensajeTrasPdf, telefonoDuenio, DUENIO_DEFAULT,
  fijar, obtener, limpiarSiMisma, yaNosEscribio, VIGENCIA_MS, _reset,
} from './atribucionCotizacion.js';
import { aplicarLista, puedeComandoCliente, _reiniciarParaTests } from './internosEquipo.js';

const ADMIN = '56957296035';
const VENDEDOR = '56911110000';
const OTRO = '56922220000';
const JUAN = '56987654321';
const PEDRO = '56912345678';

test('decisión dueño 30-sep: solo el dueño o un vendedor con oliver_interno (número COMPLETO) usan CLIENTE', () => {
  _reiniciarParaTests();
  const o = { adminPhone: ADMIN, esInterno: puedeComandoCliente };
  assert.equal(puedeUsarComandoCliente(VENDEDOR, o), false, 'lista nunca cargada ⇒ fail-closed');
  assert.equal(puedeUsarComandoCliente(ADMIN, o), true, 'el dueño sigue pudiendo');
  aplicarLista({ internos_ult9: ['911110000', '922220000'], vendedores: [
    { ult9: '911110000', telefono: VENDEDOR, oliver_interno: true },
    { ult9: '922220000', telefono: OTRO, oliver_interno: false },   // del equipo, sin modo interno
  ] });
  assert.equal(puedeUsarComandoCliente(VENDEDOR, o), true, 'vendedor con oliver_interno puede');
  assert.equal(puedeUsarComandoCliente('+56 9 1111 0000', o), true, 'mismo número, otro formato');
  assert.equal(puedeUsarComandoCliente(OTRO, o), false, 'del equipo sin modo interno NO puede');
  assert.equal(puedeUsarComandoCliente('34911110000', o), false, 'misma cola de 9, otro país: NO (Codex)');
  assert.equal(puedeUsarComandoCliente('56933334444', o), false, 'un cliente cualquiera NO puede');
  _reiniciarParaTests();
});

test('decisión dueño 30-sep: si sales-os no manda el teléfono completo, ningún vendedor usa CLIENTE', () => {
  _reiniciarParaTests();
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', oliver_interno: true }] });
  assert.equal(puedeComandoCliente(VENDEDOR), false);
  _reiniciarParaTests();
});

test('decisión dueño 30-sep: index.js y webhook.js usan la MISMA regla de autorización y de dueño', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, '..', 'index.js'), 'utf8');
  assert.match(src, /puedeUsarComandoCliente\(normalizeWaId\(_atInc\.waId\), \{ esInterno: puedeComandoCliente \}\)/);
  assert.match(src, /const ADMIN_PHONE = process\.env\.ADMIN_PHONE \|\| DUENIO_DEFAULT;/);
  const wh = fs.readFileSync(path.join(dir, '..', 'src', 'oliver-gpt', 'webhook.js'), 'utf8');
  assert.match(wh, /rolCotizador\(from, \{ esInterno: puedeComandoCliente \}\)/);
  // Las guardias de vendedor usan el rol por número COMPLETO, no el modo interno por ult9.
  assert.match(wh, /const esVendedorInterno = _rol === 'vendedor';/);
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
  assert.deepEqual(id.extraLead, { external_id: JUAN, cotizado_por: '911110000', no_pisar: true, source: 'vendedor_equipo' });
  const sin = identidadCotizacion(VENDEDOR, null);
  assert.deepEqual(sin, { telefonoCliente: VENDEDOR, claveCot: VENDEDOR, cotizadoPor: null, atribuida: false, extraLead: {} });
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
  assert.equal(c.entrega, JUAN, 'alias de compatibilidad');
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
  const esInterno = (p) => p === VENDEDOR;
  assert.equal(rolCotizador(ADMIN, { adminPhone: ADMIN, esInterno }), 'duenio');
  assert.equal(rolCotizador(VENDEDOR, { adminPhone: ADMIN, esInterno }), 'vendedor');
  assert.equal(rolCotizador(OTRO, { adminPhone: ADMIN, esInterno }), null);
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
  assert.equal(puedeComandoCliente(VENDEDOR), false);
  aplicarLista({ internos_ult9: ['911110000'], vendedores: [{ ult9: '911110000', telefono: VENDEDOR, oliver_interno: true }] });
  assert.equal(puedeComandoCliente(VENDEDOR), true);
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
