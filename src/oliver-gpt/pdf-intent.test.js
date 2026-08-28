// node --test src/oliver-gpt/pdf-intent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPdfAffirmative, lastAssistantOfferedPdf, itemsFromQuoteCalls, stripMontos, stripAccionesFalsas } from './pdf-intent.js';

test('isPdfAffirmative: afirmaciones cortas y explícitas', () => {
  for (const t of ['sí', 'Si', 'dale', 'ok', 'perfecto', 'listo', 'envíamela', 'quiero el pdf', 'mándamela', 'la propuesta formal'])
    assert.equal(isPdfAffirmative(t), true, `debió ser afirmativo: ${t}`);
});

test('isPdfAffirmative: NO afirmativo para preguntas o ruido', () => {
  for (const t of ['cuánto cuesta?', 'tengo otra ventana', 'no', 'y el color?', ''])
    assert.equal(isPdfAffirmative(t), false, `NO debió ser afirmativo: ${t}`);
});

test('lastAssistantOfferedPdf: detecta oferta de PDF en el último turno del asistente', () => {
  assert.equal(lastAssistantOfferedPdf([{ role: 'assistant', content: '¿Te envío la propuesta formal en PDF?' }]), true);
  assert.equal(lastAssistantOfferedPdf([{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }]), false);
  assert.equal(lastAssistantOfferedPdf([]), false);
  // [multi-ventana] oferta tipo "¿se la preparo?" también cuenta como oferta de PDF
  assert.equal(lastAssistantOfferedPdf([{ role: 'assistant', content: 'Anotada ✅. ¿Tiene más ventanas o se la preparo con estas?' }]), true);
  // toma el ÚLTIMO assistant, ignora user posterior
  assert.equal(lastAssistantOfferedPdf([
    { role: 'assistant', content: 'te mando la propuesta formal' }, { role: 'user', content: 'sí' },
  ]), true);
});

test('itemsFromQuoteCalls: extrae items válidos de calcular_cotizacion, ignora fallidos', () => {
  const calls = [
    { name: 'calcular_cotizacion', input: { tipo: 'CORREDERA', medidas_texto: '1.5x1.2', color: 'BLANCO', cantidad: 2 },
      result: { ok: true, unit_price: 300000, cantidad: 2, producto_label: 'Corredera SLIDING', glass_label: '5+12+5' } },
    { name: 'calcular_cotizacion', input: { tipo: 'FIJA' }, result: { ok: false } }, // falla → se ignora
    { name: 'listar_vidrios', input: {}, result: { ok: true } },                      // no es cotización
  ];
  const items = itemsFromQuoteCalls(calls, 'BLANCO');
  assert.equal(items.length, 1);
  assert.equal(items[0].unit_price, 300000);
  assert.equal(items[0].qty, 2);
  assert.equal(items[0].producto_label, 'Corredera SLIDING');
});

test('stripMontos: borra montos CLP del texto (positivos)', () => {
  for (const c of [
    'te sale $289.000 con termopanel',
    'son $1.234.567 en total',
    'quedan en 1.200.000 pesos',
    'el valor es 890.000 CLP',
    'total 1.234.567 listo',
  ]) {
    const out = stripMontos(c);
    assert.ok(/valor en la propuesta formal/.test(out), `debió redirigir: ${c} → ${out}`);
    assert.ok(!/\d\.\d{3}/.test(out), `no debió quedar monto: ${c} → ${out}`);
  }
});

test('stripMontos: NO toca RUT chilenos (caso real Alfredo 28-08: "falta el rut" ×4)', () => {
  for (const t of [
    'quedó a nombre de Alfredo, RUT 10.047.794-7, celular 974266456',
    'RUT: 10.047.794',
    'su rut 9.123.456-K quedó en la propuesta',
    'con el RUT 100.477.947 anotado',
  ]) {
    const out = stripMontos(t);
    assert.equal(out, t, `no debió tocar el RUT: ${t} → ${out}`);
  }
  // pero un monto de verdad en la MISMA frase que un RUT sí se redirige
  const mix = stripMontos('RUT 10.047.794-7 y el total es $1.234.567');
  assert.ok(/10\.047\.794-7/.test(mix), `el RUT debió sobrevivir: ${mix}`);
  assert.ok(/valor en la propuesta formal/.test(mix), `el monto debió redirigirse: ${mix}`);
  // [Codex 28-08] montos con $/unidad NUNCA se exceptúan, aunque parezcan RUT por contexto
  for (const t of [
    'Total: $289.000 CLP - 2 cuotas',
    'Precio final: $1.234.567 - 10% de descuento',
    'Abono asociado al RUT: $450.000 CLP',
    'Monto para RUT: 1.200.000 pesos',
    // [Gemini 28-08] guion de cuotas/descuento NO es dígito verificador
    'El total de la cotización es 1.200.000 - 3 cuotas sin interés.',
    'Quedaría en un precio final de 1.500.000 - 10% de descuento.',
    'Abono inicial de 1.100.000 - 2 cheques.',
  ]) {
    const out = stripMontos(t);
    assert.ok(/valor en la propuesta formal/.test(out), `el monto debió redirigirse: ${t} → ${out}`);
    assert.ok(!/\d{3}[.,]\d{3}/.test(out), `no debió quedar monto: ${t} → ${out}`);
  }
});

test('stripMontos: NO toca medidas/cantidades/folios/teléfonos (sin falsos positivos)', () => {
  for (const t of [
    'una corredera de 1.20 m por 1.50 m',
    'medidas 120x150 cm',
    'una ventana de 2.400 mm de ancho',
    'tengo 2 ventanas y 3 puertas',
    'tu Propuesta Técnica Económica N° 0021',
    'llámame al +56 9 5729 6035',
    'con un abono del 50%',
    '',
  ]) assert.equal(stripMontos(t), t, `NO debió cambiar: "${t}"`);
});

// ── [2026-07-06 LOTE2] medidas_resueltas → campos numéricos + string limpio en pending_quote ──
test('itemsFromQuoteCalls: medidas_resueltas "AxBmm" → ancho_mm/alto_mm numéricos + measures limpio', () => {
  const calls = [{
    name: 'calcular_cotizacion',
    input: { tipo: 'PROYECTANTE', medidas_texto: '350x600', ambiente: 'baño' },
    result: { ok: true, unit_price: 120000, cantidad: 1, producto_label: 'Proyectante S60', glass_label: '4+12+4 satén (baño)', medidas_resueltas: '350x600mm', referencial: true },
  }];
  const items = itemsFromQuoteCalls(calls, 'BLANCO');
  assert.equal(items.length, 1);
  assert.equal(items[0].measures, '350x600', 'display SIN sufijo (Zoho/PDF/alertas)');
  assert.equal(items[0].ancho_mm, 350, 'campo numérico para re-cotizaciones exactas');
  assert.equal(items[0].alto_mm, 600);
});

test('itemsFromQuoteCalls: sin medidas_resueltas cae al texto crudo (comportamiento histórico)', () => {
  const calls = [{
    name: 'calcular_cotizacion',
    input: { tipo: 'CORREDERA', medidas_texto: '150x150 cm' },
    result: { ok: true, unit_price: 350000, cantidad: 1, producto_label: 'Corredera SLIDING' },
  }];
  const items = itemsFromQuoteCalls(calls, '');
  assert.equal(items[0].measures, '150x150 cm');
  assert.equal(items[0].ancho_mm, undefined);
});

// ── [2026-07-07] referencial se preserva → dispara escalación de revisión de ingeniería ──
test('itemsFromQuoteCalls: preserva referencial:true de la ventana fuera de estándar', () => {
  const calls = [{
    name: 'calcular_cotizacion',
    input: { tipo: 'PROYECTANTE', medidas_texto: '350x600' },
    result: { ok: true, unit_price: 120000, cantidad: 1, producto_label: 'Proyectante S60', referencial: true, medidas_resueltas: '400x600mm' },
  }, {
    name: 'calcular_cotizacion',
    input: { tipo: 'CORREDERA', medidas_texto: '1200x1000' },
    result: { ok: true, unit_price: 300000, cantidad: 1, producto_label: 'Corredera SLIDING', referencial: false, medidas_resueltas: '1200x1000mm' },
  }];
  const items = itemsFromQuoteCalls(calls, 'BLANCO');
  assert.equal(items[0].referencial, true, 'la fuera de estándar marca referencial');
  assert.equal(items[1].referencial, false, 'la normal NO');
});

// ── [Ronda 4 2026-07-20] Casos REALES del 16-19 jul (conversation_messages, BD viva) ──

test('stripMontos Ronda 4: coma gringa — el "$291,158 c/u" real del 07-19 se borra', () => {
  const out = stripMontos('- 3 Ventanas de 120x120 cm: $291,158 c/u');
  assert.ok(!out.includes('291,158'), `el monto con coma debe borrarse, fue: "${out}"`);
  assert.ok(out.includes('(valor en la propuesta formal)'));
  // formato chileno sigue cubierto y los NO-montos siguen intactos
  assert.ok(!stripMontos('total $1.234.567').includes('1.234.567'));
  for (const t of ['mide 1,5 metros', 'ventana de 120x150', 'son 2,400 mm de alto', 'N° 0021']) {
    assert.equal(stripMontos(t), t, `NO debió cambiar: "${t}"`);
  }
});

test('stripAccionesFalsas: los corchetes falsos reales del 16-19 jul se borran', () => {
  assert.equal(stripAccionesFalsas('Aquí tienes el documento:\n\n[Enlace a la cotización]'), 'Aquí tienes el documento:');
  assert.ok(!stripAccionesFalsas('Un momento.\n\n[Calculando propuesta...]\n\nListo').includes('Calculando'));
  assert.ok(!stripAccionesFalsas('[PDF adjunto]').includes('PDF adjunto'));
  // corchetes LEGÍTIMOS no se tocan (folios, referencias, aclaraciones)
  for (const t of ['su folio es [CM-FR-004-2026-0169]', 'medida [ancho x alto]', 'sin corchetes']) {
    assert.equal(stripAccionesFalsas(t), t, `NO debió cambiar: "${t}"`);
  }
});
