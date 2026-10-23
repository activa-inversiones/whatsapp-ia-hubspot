// services/uwLineaPiloto.test.js
// Guardia de la decisión del dueño (21-oct): piloto del informe Uw de la línea cotizada,
// SOLO a su número por defecto y SOLO con calce exacto de la línea.
// Correr: node --test services/uwLineaPiloto.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_UW_LINEA, elegirInformesUwLinea, listaPiloto, enPilotoUwLinea, descargarInformeUw,
  nombreParaCliente, nombreParaArchivo, captionUwLinea, tipoEntregaUw, MAX_INFORMES_UW, politicaUwLinea, techoSinLimite, uwApagado,
} from './uwLineaPiloto.js';

test('calce EXACTO: los rótulos reales del motor encuentran su ventana tipo', () => {
  const r = elegirInformesUwLinea([
    { producto_label: 'Corredera SLIDING H98 Doble Riel S75' },
    { producto_label: 'Corredera ANDES 66 Monorriel' },
  ]);
  assert.deepEqual(r.map((e) => e.ventana), ['V2N', 'V4N']);
  assert.equal(elegirInformesUwLinea([{ product: 'corredera  sliding h98 TRIPLE riel s75' }])[0].ventana, 'V1');
});

test('decisión del dueño: sin calce exacto NO hay informe (H80, S60, variantes, abatible, puerta)', () => {
  for (const p of ['Corredera SLIDING H80 Doble Riel S75', 'Proyectante S60', 'Fijo S60',
    'Abatible S60', 'Puerta abatible exterior con zapata S60',          // «No, son distintas» (V8H / V9)
    'Corredera SLIDING H98 Doble Riel S75 — Blanco', 'Corredera SLIDING H98 Doble Riel S75 3 hojas',
    'Corredera SLIDING H98 Doble Riel S75 ⚠️ Referencial', 'Corredera ANDES 54 Monorriel', '', undefined]) {
    assert.deepEqual(elegirInformesUwLinea([{ producto_label: p }]), [], String(p));
  }
  assert.ok(!Object.values(CATALOGO_UW_LINEA).some((e) => ['V8H', 'V9'].includes(e.ventana)),
    'V8H y V9 no se entregan: el dueño dijo que no son las mismas líneas');
});

test('una ventana tipo se manda una sola vez por proyecto, con tope de documentos', () => {
  const items = ['Corredera SLIDING H98 Doble Riel S75', 'Corredera SLIDING H98 Doble Riel S75',
    'Corredera SLIDING H98 Triple Riel S75', 'Corredera ANDES 66 Monorriel'].map((p) => ({ producto_label: p }));
  const r = elegirInformesUwLinea(items);
  assert.equal(r.length, MAX_INFORMES_UW);
  assert.deepEqual(r.map((e) => e.ventana), ['V2N', 'V1']);
});

test('piloto: por defecto SOLO el número del dueño; la variable lo cambia o lo apaga', () => {
  assert.deepEqual(listaPiloto({}), ['56957296035']);
  assert.equal(enPilotoUwLinea('56957296035', { lista: listaPiloto({}) }), true);
  assert.equal(enPilotoUwLinea('+56 9 1234 5678', { lista: listaPiloto({}) }), false, 'un cliente NO entra por defecto');
  assert.deepEqual(listaPiloto({ UW_LINEA_PILOTO_LISTA: '-' }), []);
  assert.equal(enPilotoUwLinea('56957296035', { lista: listaPiloto({ UW_LINEA_PILOTO_LISTA: '-' }) }), false);
  const l = listaPiloto({ UW_LINEA_PILOTO_LISTA: '+56 9 1111 2222, 56933334444' });
  assert.equal(enPilotoUwLinea('56911112222', { lista: l }), true);
  assert.equal(enPilotoUwLinea('56957296035', { lista: l }), false);
  assert.equal(enPilotoUwLinea('56900000000', { lista: listaPiloto({ UW_LINEA_PILOTO_LISTA: '*' }) }), true);
});

test('descarga: pide la verificación PÚBLICA y exige un PDF de verdad', async () => {
  const pedidos = [];
  const pdf = Buffer.from('%PDF-1.7 contenido');
  const ok = async (url) => { pedidos.push(url); return new Response(pdf, { status: 200 }); };
  const b = await descargarInformeUw('AT-NCH3137-1-2026-000027-7492c9', { fetchImpl: ok, baseUrl: 'https://t.example/' });
  assert.ok(b.equals(pdf));
  assert.deepEqual(pedidos, ['https://t.example/verificar/AT-NCH3137-1-2026-000027-7492c9/pdf']);
  await assert.rejects(descargarInformeUw('AT-NCH3137-1-2026-000027-7492c9',
    { fetchImpl: async () => new Response('<html>', { status: 200 }) }), /no es un PDF/);
  await assert.rejects(descargarInformeUw('AT-NCH3137-1-2026-000027-7492c9',
    { fetchImpl: async () => new Response('', { status: 404 }) }), /HTTP 404/);
  await assert.rejects(descargarInformeUw('../../admin', { fetchImpl: ok }), /inválido/);
});

test('cada entrada del catálogo tiene un código que la descarga acepta', () => {
  for (const e of Object.values(CATALOGO_UW_LINEA)) {
    assert.ok(e.codigo.startsWith(`${e.folio}-`), e.ventana);
    assert.match(e.codigo, /^AT-NCH3137-1-\d{4}-\d{6}-[0-9a-f]{6}$/);
  }
});

test('nombres: el del cliente lleva el folio (se archiva en CM-FR-008); el de archivo es único por entrega', () => {
  const e = CATALOGO_UW_LINEA['corredera sliding h98 doble riel s75'];
  assert.equal(nombreParaCliente(e), 'Informe-Uw-Corredera-S75-H98-Doble-Riel-AT-NCH3137-1-2026-000027.pdf');
  const t = new Date('2026-10-21T10:05:07.123Z');
  const a = nombreParaArchivo(e, '56957296035', t, 'wamid.HBgLNTY5NTcyOTYwMzUVAgARGBI4');
  assert.equal(a, 'Informe-Uw-Corredera-S75-H98-Doble-Riel-AT-NCH3137-1-2026-000027-entrega-20261021100507123-6035-MzUVAgARGBI4.pdf');
  // [Codex r1] dos entregas al MISMO teléfono en el mismo instante: el id del mensaje las separa
  assert.notEqual(nombreParaArchivo(e, '56957296035', t, 'wamid.A1'), nombreParaArchivo(e, '56957296035', t, 'wamid.B2'));
  assert.notEqual(a, nombreParaArchivo(e, '56911112222', t, 'wamid.HBgLNTY5NTcyOTYwMzUVAgARGBI4'));
  assert.doesNotMatch(a, /CM-FR-004/, 'sin folio de propuesta: el archivo ISO lo mandaría a CM-FR-004');
});

test('el texto dice qué es y qué NO es, sin claims sin respaldo', () => {
  const c = captionUwLinea(CATALOGO_UW_LINEA['corredera andes 66 monorriel']);
  assert.match(c, /no a las medidas exactas de sus ventanas/);
  assert.match(c, /NCh 3137/);
  assert.match(c, /código QR/);
  assert.doesNotMatch(c, /certificad|laboratorio|garantiza/i);
  assert.equal(tipoEntregaUw(CATALOGO_UW_LINEA['corredera andes 66 monorriel']), 'uw_linea:V4N');
});

test('si el catálogo trae el sha256, un PDF distinto NO se entrega', async () => {
  const ok = async () => new Response(Buffer.from('%PDF-1.7 otro'), { status: 200 });
  await assert.rejects(descargarInformeUw('AT-NCH3137-1-2026-000027-7492c9',
    { fetchImpl: ok, sha256: CATALOGO_UW_LINEA['corredera sliding h98 doble riel s75'].sha256 }), /sha256/);
  for (const e of Object.values(CATALOGO_UW_LINEA)) assert.match(e.sha256, /^[0-9a-f]{64}$/, e.ventana);
});

test('[2026-10-22] politicaUwLinea — tabla de verdad: la casilla manda siempre; sin casilla, solo el piloto y nunca con selección manual', () => {
  const p = (elegido, enPiloto, seleccionManual) => politicaUwLinea({ elegido, enPiloto, seleccionManual });
  assert.deepEqual(p(true, false, true), { enviar: true, motivo: 'casilla', ignorarCandado: true }, 'casilla: cualquier cliente, aunque haya marca manual');
  assert.deepEqual(p(true, true, false), { enviar: true, motivo: 'casilla', ignorarCandado: true });
  assert.deepEqual(p(false, false, false), { enviar: false, motivo: 'fuera_piloto', ignorarCandado: false });
  assert.deepEqual(p(false, false, true), { enviar: false, motivo: 'fuera_piloto', ignorarCandado: false });
  assert.deepEqual(p(false, true, true), { enviar: false, motivo: 'seleccion_manual', ignorarCandado: false }, 'nadie lo eligió');
  assert.deepEqual(p(false, true, false), { enviar: true, motivo: 'piloto', ignorarCandado: false });
  for (const v of ['true', 1, 'false', null, undefined]) assert.equal(politicaUwLinea({ elegido: v }).motivo, 'fuera_piloto', JSON.stringify(v));
});

test('[2026-10-22] techoSinLimite: ningún campo undefined (la reserva y el seguro no se disparan solos)', () => {
  const t = techoSinLimite();
  assert.equal(t.vencido, false);
  assert.equal(Date.now() + t.reservaMs > t.vence, false);
  assert.notEqual(techoSinLimite(), techoSinLimite(), 'un objeto nuevo por envío');
});

test('[2026-10-22 · Thermos M2] UW_LINEA_PILOTO_LISTA=- apaga TAMBIÉN la casilla del cockpit', () => {
  assert.deepEqual(politicaUwLinea({ elegido: true, enPiloto: true, apagado: true }), { enviar: false, motivo: 'apagado', ignorarCandado: false });
  assert.equal(uwApagado({ UW_LINEA_PILOTO_LISTA: '-' }), true);
  assert.equal(uwApagado({ UW_LINEA_PILOTO_LISTA: ' - ' }), true);
  assert.equal(uwApagado({}), false);
  assert.equal(uwApagado({ UW_LINEA_PILOTO_LISTA: '569' }), false);
});
