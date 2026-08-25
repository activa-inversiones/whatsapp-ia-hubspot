// hojas-corredera.test.js — [2026-08-25]
//
// 🔴 LA CORREDERA GIGANTE SE COBRABA COMO SI FUERA CHICA, Y NADIE ELEGIA LAS HOJAS.
//
// Caso real CM-FR-004-2026-0341 (Martin, 25-ago): corredera de 5560×2160 roble cotizada en
// ~$930 mil. El precio REAL del motor con esas medidas: $1.343.048 — $413 mil de menos en
// UNA ventana. La causa: `validateDimensionsLocal` devolvia `clampAncho/clampAlto` y el
// pricer ACOTABA las medidas al maximo estandar (2930×2150) antes de cotizar. "Las grandes
// cotizarlas igual, solo avisar" (caso Dalia) se habia convertido en "cobrarlas como si
// fueran chicas, en silencio".
//
// Instruccion del dueño, textual: *"no se esta cobrando el real de la corredera desde
// cierto tamaño hacia arriba… por el tamaño debimos preguntarle al cliente si la quiere en
// 3 hojas o 4 hojas; si no dice nada cotizar en 2 hojas como se hizo pero a un precio real"*.

import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteDataComplete, datoQuePregunta } from './pdf-intent.js';
import { validateDimensionsLocal, detectHojas } from '../../services/enginePricer.js';

const itemGigante = (extra = {}) => ({
  producto_label: 'Corredera SLIDING H98', product: 'CORREDERA', measures: '5560x2160mm',
  unit_price: 930232, qty: 1, color: 'Roble', ...extra,
});
const base = { name: 'Martin', items: [itemGigante()] };

/* =========================================================================
 * EL CLAMP DEL PRECIO NO EXISTE MAS
 * ========================================================================= */

test('🔴 una corredera sobre el maximo AVISA pero NO acota las medidas del precio', () => {
  const dim = validateDimensionsLocal('CORREDERA', 5560, 2160);
  assert.ok(dim, 'sobre el maximo tiene que avisar');
  assert.equal(dim.referencial, true, 'el aviso referencial (visita tecnica) se mantiene');
  assert.ok(!dim.clampAncho && !dim.clampAlto,
    'clampAncho/clampAlto eran lo que cobraba una 5560 como si midiera 2930 — no pueden volver');
  assert.match(dim.message, /supera el máximo/, 'y el mensaje dice por que es referencial');
});

test('🔴 una puerta sobre el maximo tampoco acota — mismo defecto, mismo arreglo', () => {
  const dim = validateDimensionsLocal('PUERTA', 2500, 2600);
  assert.ok(dim && dim.referencial);
  assert.ok(!dim.clampAncho && !dim.clampAlto);
});

test('🔒 bajo el MINIMO se sigue acotando HACIA ARRIBA (fabricar chico cuesta lo del minimo)', () => {
  const dim = validateDimensionsLocal('CORREDERA', 300, 400);
  assert.ok(dim && dim.referencial);
  assert.ok(dim.clampMinAncho > 0 || dim.clampMinAlto > 0,
    'el clamp-UP de minimos es correcto y tiene que quedarse');
});

/* =========================================================================
 * LA PREGUNTA: 3 O 4 HOJAS — Y EL DEFAULT HONESTO DE 2
 * ========================================================================= */

test('🔴 corredera mas ancha que el estandar sin eleccion de hojas: se PREGUNTA', () => {
  const r = quoteDataComplete(base, {}, { textoCliente: 'quiero una corredera para el living' });
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('hojas'));
  assert.ok(!r.hojasAsumido, 'recien se pregunta, no se asume');
});

test('🔒 si el cliente YA dijo las hojas (en el chat o en el item), no se pregunta', () => {
  const r1 = quoteDataComplete(base, {}, { textoCliente: 'quiero una corredera grande, de 3 hojas' });
  assert.equal(r1.ok, true, 'lo dijo en el chat');
  const r2 = quoteDataComplete(
    { name: 'M', items: [itemGigante({ producto_label: 'Corredera 4 hojas SLIDING' })] },
    {}, { textoCliente: 'una corredera grande' });
  assert.equal(r2.ok, true, 'lo trae el item');
});

test('🔒 una corredera NORMAL (2000 mm) no pregunta hojas', () => {
  const r = quoteDataComplete(
    { name: 'M', items: [itemGigante({ measures: '2000x1450mm' })] },
    {}, { textoCliente: 'una corredera' });
  assert.equal(r.ok, true);
  assert.ok(!r.missing.includes('hojas'));
});

test('🔴 si no contesta al minuto: sale de 2 hojas, MARCADO para avisar', () => {
  const r = quoteDataComplete(base, { hojas_preguntado_at: Date.now() - 61_000 },
    { textoCliente: 'corredera grande' });
  assert.equal(r.ok, true, 'no se pierde la venta esperando');
  assert.equal(r.hojasAsumido, true, 'pero queda marcado: el aviso es obligatorio');
});

test('🔒 el orden de la cascada: nombre > color > tipo > hojas', () => {
  assert.equal(datoQuePregunta(['hojas']), 'hojas');
  assert.equal(datoQuePregunta(['color', 'hojas']), 'color');
  assert.equal(datoQuePregunta(['tipo', 'hojas']), 'tipo');
});

test('🔒 detectHojas entiende chileno: "3 hojas", "triple", y no inventa', () => {
  assert.equal(detectHojas('corredera de 3 hojas'), 3);
  assert.equal(detectHojas('triple riel corredera'), 3);
  assert.equal(detectHojas('4 hojas por favor'), 4);
  assert.equal(detectHojas('una corredera grande'), undefined);
});

/* =========================================================================
 * LA PREGUNTA Y EL AVISO EXISTEN EN EL WEBHOOK — Y SE MANDAN
 * ========================================================================= */

test('🔴 el gate pregunta 3 o 4 hojas, arranca su reloj, y el aviso se CONCATENA', async () => {
  const { readFile } = await import('node:fs/promises');
  const wh = await readFile(new URL('./webhook.js', import.meta.url), 'utf8');
  const i = wh.indexOf('const _gate = quoteDataComplete(input, state');
  const bloque = wh.slice(i, wh.indexOf("reason: 'datos_incompletos'", i));
  assert.ok(bloque.includes("'hojas'"), 'las hojas tienen su rama en la cascada');
  assert.match(bloque, /3 o de 4 hojas/, 'la pregunta ofrece 3 o 4');
  assert.match(wh, /hojas_preguntado_at/, 'el reloj del plazo existe');
  assert.ok(wh.indexOf('_gate.hojasAsumido') > 0, 'el webhook reacciona al default');
  assert.match(wh, /\+ _avisoHojas,/, 'un aviso que no se manda no existe (leccion del color)');
});
