// propuestas-color.test.js — [2026-08-31]
//
// LAS TRES PROPUESTAS A / B / C POR COLOR. Decision del dueño, textual:
//   *"cuando cliente no entrega color entreguemosle blanco, nogal y negro"*
//   *"entregar 3 propuestas tecnica economicas una blanco, nogal y new black"*
//   *"identificando claramente cada una, ademas diferenciadas como a b c segun el acuerdo de
//     cada cotizacion pero le decimos a cliente cuel es cada una"*
//
// Lo que se prueba aca es la REGLA (colores, orden, folios, texto). Que las tres SALGAN de
// verdad, que solo una dispare conversion y que una fallada no se lleve a las otras se prueba
// en webhook.propuestas-abc.test.js, contra el webhook entero.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORES_PROPUESTA, LETRAS_ALTERNATIVA,
  foliosDeOpciones, letrasReservadas, textoDeOpciones, avisoPrevioOpciones,
} from './propuestas-color.js';
import { alternativasEntregadas, numeroDeDocumento } from './webhook.js';

/* =========================================================================
 * LOS COLORES — SALEN DEL CATALOGO REAL, NO DE LA IMAGINACION
 * ========================================================================= */

test('🔴 los tres son los que pidio el dueño, en el orden A / B / C', () => {
  // [2026-08-31] DEL MAS CARO AL MAS ECONOMICO. Decision explicita del dueno ese dia, y de
  // ANCLAJE, no estetica: mostrar primero el caro deja al blanco leyendose como "la opcion
  // economica" en vez de como el precio de referencia. La primera version salio al reves
  // (barato primero) y este test la consagraba; el tablero registra la decision correcta.
  //   A = New Black ($54.356 el marco S70)  ·  B = Nogal ($49.974)  ·  C = Blanco ($30.385)
  assert.deepEqual(COLORES_PROPUESTA, ['New Black', 'Nogal', 'Blanco']);
});

test('🔴 los tres existen en el catalogo REAL y el motor los distingue', async () => {
  // ⛔ ANTI-ALUCINACION: un color que el motor no reconoce cae a BLANCO en silencio
  // (`normColorLocal`, enginePricer.js) — o sea tres propuestas identicas con tres etiquetas
  // distintas, que en un documento formal es peor que no mandarlas. Se comprueba contra el
  // codigo real, no contra una lista escrita a mano.
  const { readFile } = await import('node:fs/promises');
  const pricer = await readFile(new URL('../../services/enginePricer.js', import.meta.url), 'utf8');
  const i = pricer.indexOf('function normColorLocal');
  assert.ok(i > 0, 'no se encontro normColorLocal');
  const bloque = pricer.slice(i, i + 700);
  // Cada color de la terna tiene que caer en una familia DISTINTA del motor.
  const familias = new Set();
  for (const color of COLORES_PROPUESTA) {
    const t = color.toLowerCase();
    const fam = /blanco/.test(t) ? 'BLANCO'
      : /nogal|roble|madera|dorado/.test(t) ? 'NOGAL'
        : /grafito|antracita|gris|plomo/.test(t) ? 'GRAFITO'
          : /negro|black/.test(t) ? 'NEWBLACK' : null;
    assert.ok(fam, `"${color}" no lo reconoce ninguna rama del motor: cotizaria BLANCO en silencio`);
    assert.ok(bloque.includes(fam), `la familia ${fam} ya no existe en normColorLocal`);
    familias.add(fam);
  }
  assert.equal(familias.size, COLORES_PROPUESTA.length,
    'dos colores de la terna caen en la MISMA familia: saldrian dos propuestas con el mismo precio');
});

test('🔴 y el dibujo del PDF tambien los distingue (no salen las tres del mismo color)', async () => {
  const { readFile } = await import('node:fs/promises');
  const dib = await readFile(new URL('../../services/dibujoVentana.js', import.meta.url), 'utf8');
  const i = dib.indexOf('function claveColor');
  const bloque = dib.slice(i, i + 500);
  for (const [color, clave] of [['Blanco', 'blanco'], ['Nogal', 'nogal'], ['New Black', 'newblack']]) {
    assert.ok(bloque.includes(`"${clave}"`) || bloque.includes(`'${clave}'`),
      `claveColor ya no devuelve ${clave}, el PDF dibujaria ${color} de otro color`);
  }
  // "New Black" tiene que entrar por "black": el catalogo de texto lo llama "Negro".
  assert.match(bloque, /black/i, 'claveColor tiene que reconocer "black" o New Black sale blanco');
});

/* =========================================================================
 * LOS FOLIOS — UN SOLO CORRELATIVO ISO, LAS VARIANTES SON LETRAS
 * ========================================================================= */

test('🔴 tres opciones = UN correlativo + dos letras (la letra NO quema correlativo)', () => {
  const f = foliosDeOpciones('CM-FR-004-2026-0392', 3, 0);
  assert.deepEqual(f, [
    { numero: 'CM-FR-004-2026-0392', letra: 'A' },
    { numero: 'CM-FR-004-2026-0392-B', letra: 'B' },
    { numero: 'CM-FR-004-2026-0392-C', letra: 'C' },
  ]);
});

test('🔒 el rotulo SIEMPRE calza con el sufijo del archivo que recibe el cliente', () => {
  // Es la razon de que la letra se derive del folio y no de la posicion: el cliente distingue
  // los archivos por su nombre (…-B.pdf), y el mensaje le habla de "opcion B".
  for (const { numero, letra } of foliosDeOpciones('CM-FR-004-2026-0392', 3, 0)) {
    const sufijo = (numero.match(/-([A-Z])$/) || [])[1] || 'A';
    assert.equal(letra, sufijo);
  }
});

test('🔴 si el cliente YA se llevo alternativas, no se reusa una letra entregada', () => {
  // El pisado del caso Paula al reves: dos documentos DISTINTOS bajo el mismo numero. La fila
  // de `quotes` se busca por (tenant_id, quote_number) y el segundo borra al primero.
  const f = foliosDeOpciones('CM-FR-004-2026-0392', 3, 2);   // B y C ya usadas
  assert.deepEqual(f.map((o) => o.letra), ['A', 'D', 'E']);
  assert.deepEqual(f.map((o) => o.numero), [
    'CM-FR-004-2026-0392', 'CM-FR-004-2026-0392-D', 'CM-FR-004-2026-0392-E',
  ]);
});

test('🔒 un folio que YA viene con letra no genera "-B-B"', () => {
  const f = foliosDeOpciones('CM-FR-004-2026-0392-B', 3, 0);
  assert.deepEqual(f.map((o) => o.numero), [
    'CM-FR-004-2026-0392-B', 'CM-FR-004-2026-0392-C', 'CM-FR-004-2026-0392-D',
  ]);
  assert.ok(f.every((o) => !/-[A-Z]-[A-Z]$/.test(o.numero)), 'ningun folio con dos letras');
});

test('🔒 con el alfabeto agotado se entrega lo que alcanza, sin inventar numeracion', () => {
  const f = foliosDeOpciones('CM-FR-004-2026-0392', 3, LETRAS_ALTERNATIVA.length);
  assert.equal(f.length, 1, 'solo la base: ninguna letra libre');
  assert.equal(f[0].numero, 'CM-FR-004-2026-0392');
});

test('🔒 sin folio no se inventa nada', () => {
  assert.deepEqual(foliosDeOpciones('', 3, 0), []);
  assert.deepEqual(foliosDeOpciones(null, 3, 0), []);
});

test('🔴 las letras quedan RESERVADAS aunque una propuesta falle', () => {
  // Si la B no se pudo emitir, la B NO se recicla: se acepta el hueco (explicable en el log)
  // antes que una colision (inexplicable en cualquier auditoria).
  const f = foliosDeOpciones('CM-FR-004-2026-0392', 3, 0);
  assert.equal(letrasReservadas(f), 2, 'B y C consumidas');
  assert.equal(letrasReservadas([]), 0);
  assert.equal(letrasReservadas([{ numero: 'CM-FR-004-2026-0392' }]), 0, 'la base no consume letra');
});

test('🔒 las letras de la terna y las de `numeroDeDocumento` son LAS MISMAS', () => {
  // Fuente unica. Si se desincronizaran, una alternativa posterior reusaria una letra de la
  // terna y volveria el pisado por numero.
  assert.equal(alternativasEntregadas('CM-FR-004-2026-0392-C'), 2, 'la -C es la 2a alternativa');
  const f = foliosDeOpciones('CM-FR-004-2026-0392', 3, 0);
  const dec = numeroDeDocumento({
    lastQuote: { quote_number: f[0].numero, quote_base: f[0].numero, at: Date.now(),
      pdf_sent: true, sig: 'vieja', alternativas: letrasReservadas(f) },
    sig: 'nueva', ventanaMs: 48 * 3600 * 1000,
  });
  assert.equal(dec.numero, 'CM-FR-004-2026-0392-D',
    'la siguiente alternativa arranca DESPUES de las que reservo la terna');
});

/* =========================================================================
 * EL MENSAJE AL CLIENTE — PEDIDO EXPLICITO DEL DUEÑO
 * ========================================================================= */

const ENTREGADAS = [
  { letra: 'A', color: 'Blanco', numero: 'CM-FR-004-2026-0392' },
  { letra: 'B', color: 'Nogal', numero: 'CM-FR-004-2026-0392-B' },
  { letra: 'C', color: 'New Black', numero: 'CM-FR-004-2026-0392-C' },
];

test('🔴 el mensaje dice CUAL ES CUAL: letra + color + folio de cada una', () => {
  // *"le decimos a cliente cuel es cada una"*. El cliente no puede tener que adivinar.
  const t = textoDeOpciones(ENTREGADAS);
  for (const o of ENTREGADAS) {
    assert.ok(t.includes(o.letra), `falta la letra ${o.letra}`);
    assert.ok(t.includes(o.color), `falta el color ${o.color}`);
    assert.ok(t.includes(o.numero), `falta el folio ${o.numero}: es como distingue los archivos`);
  }
});

test('🔴 y dice que el COLOR CAMBIA EL PRECIO', () => {
  assert.match(textoDeOpciones(ENTREGADAS), /color cambia el precio/i);
});

test('🔴 ⛔ SIN MONTOS — REGLA #13: el precio va SOLO en el PDF', () => {
  const t = `${textoDeOpciones(ENTREGADAS)} ${avisoPrevioOpciones(COLORES_PROPUESTA)}`;
  assert.doesNotMatch(t, /\$\s?\d/, 'un monto suelto en el chat viola la regla #13');
  assert.doesNotMatch(t, /\d{1,3}(?:[.,]\d{3})+/, 'ni un numero con separador de miles');
  // Y tampoco se afirma cual es el mas barato: es un dato de la lista de precios que puede
  // cambiar, y una afirmacion de precio que envejece mal en un chat es alucinacion.
  assert.doesNotMatch(t, /m[aá]s barat|m[aá]s econ[oó]mic/i);
});

test('🔒 sigue pidiendo el color: una propuesta correcta es mejor que tres', () => {
  const t = textoDeOpciones(ENTREGADAS);
  assert.match(t, /cu[aá]l le acomoda|d[ií]game cu[aá]l/i, 'el mensaje tiene que cerrar preguntando');
});

test('🔒 NO se ofrecen Roble Dorado ni Grafito: el dueño los sacó a propósito', () => {
  // [2026-08-31] Este test decia lo CONTRARIO (exigia que se ofrecieran) y contradecia una
  // decision explicita del dueno: "saca la linea de roble y grafito". Su razon: desenfocan
  // del cierre. Si el cliente los pide, ahi se ofrecen; de entrada, no.
  const t = textoDeOpciones(ENTREGADAS);
  assert.doesNotMatch(t, /Roble/i, 'el dueño lo saco del mensaje');
  assert.doesNotMatch(t, /Grafito/i, 'el dueño lo saco del mensaje');
  // Y no se inventa ningun color: solo salen los tres que se cotizaron.
  const nombrados = new Set(t.match(/Blanco|Nogal|Roble Dorado|Grafito Antracita|New Black|Negro/g) || []);
  assert.deepEqual([...nombrados].sort(), ['Blanco', 'New Black', 'Nogal']);
});

test('🔴 SOLO se nombra lo que de verdad se entrego (si la B fallo, no se promete)', () => {
  // Un mensaje que promete un archivo que no llego es peor que no mandar el mensaje.
  const t = textoDeOpciones([ENTREGADAS[0], ENTREGADAS[2]]);
  assert.ok(t.includes('New Black') && t.includes('Blanco'));
  assert.ok(!t.includes('CM-FR-004-2026-0392-B'), 'el folio de la que no salio NO se nombra');
  assert.doesNotMatch(t, /Opción B/, 'ni se la lista como entregada');
  assert.match(t, /los dos/, 'y el texto se ajusta a cuantas salieron');
  // 🔴 …pero SI se le ofrece: el aviso previo se lo habia anunciado (no puede adivinar cual
  // va a fallar), asi que callarse el Nogal seria una promesa rota. Cazado por
  // webhook.propuestas-abc.test.js con el envio de la -B fallando.
  assert.match(t, /prefiere[^.]*Nogal/i, 'el color que no salio se ofrece para recotizar');
});

test('🔒 con una sola no hay terna que explicar: el texto queda vacio', () => {
  // El webhook cae ahi al aviso de "va en Blanco": el cliente nunca se queda sin enterarse.
  assert.equal(textoDeOpciones([ENTREGADAS[0]]), '');
  assert.equal(textoDeOpciones([]), '');
  assert.equal(textoDeOpciones(null), '');
});

test('🔒 el aviso PREVIO anuncia los colores antes de que lleguen los archivos', () => {
  const a = avisoPrevioOpciones(COLORES_PROPUESTA);
  for (const c of COLORES_PROPUESTA) assert.ok(a.includes(c), `falta ${c} en el aviso previo`);
  assert.equal(avisoPrevioOpciones(['Blanco']), '', 'con uno solo no hay nada que anunciar');
  assert.equal(avisoPrevioOpciones([]), '');
});

test('🔒 todo en USTED: mezclar tu y usted es la falta que el prompt prohibe', () => {
  const t = `${textoDeOpciones(ENTREGADAS)} ${avisoPrevioOpciones(COLORES_PROPUESTA)}`;
  assert.doesNotMatch(t, /\bte\s|\btu\b|\bt[uú]s\b|av[ií]same|dec[ií]me|prefer[ií]s|confirm[aá]s/i);
});
