// FORMA ESQUINA / BOW WINDOW — leer la notacion del dueño sin perder nada.
//
// 🔴 POR QUE EXISTE (2026-09-24, instruccion del dueño, textual):
//   *"cuando te pidan una ventana bow window 200x150x40, la primera medida es fija, la segunda
//    es la altura y la tercera es los laterales"* y despues, con el caso real:
//   *"2000X1500X400 LO QUE QUIERE DECIR 2000MM DE ANCHO CENTRAL 1500 EL ALTO Y LOS LATERALES
//    DE 400X1500 ... Y EL POSTE DE UNION ES 90 GRADOS"*.
//
// 🔴 EL DEFECTO QUE VIENE A CERRAR, MEDIDO ANTES DE ESCRIBIR NADA: hoy `medidas()` lee
// "2000x1500x400" y devuelve {ancho:2000, alto:1500}. **El tercer numero se descarta EN
// SILENCIO**: los laterales desaparecen y se cotiza otra ventana, sin aviso y sin error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leerMedidaTriple, esBowPorForma, esquinaDesdePanos, esquinaDesdeLabel, paresDelTexto,
  numeroEscritoPorElCliente, factorDelTexto, anguloFabricable } from './formaEsquina.js';

test('lee la notacion del dueño: central x alto x lateral', () => {
  assert.deepEqual(leerMedidaTriple('2000x1500x400'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
  // Como lo escribe un humano: con espacios, con la equis de multiplicar, en mayuscula.
  assert.deepEqual(leerMedidaTriple('2000 X 1500 X 400'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
  assert.deepEqual(leerMedidaTriple('2000 × 1500 × 400'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
});

test('🔴 acepta los CENTIMETROS, que es como el dueño la escribio la primera vez', () => {
  // *"bow windows 200x150x40"*. Sin esto saldria una ventana de 200 mm — un vidrio de 20 cm.
  // El criterio es el MISMO que ya usa `medidas()` para dos numeros: bajo cierto umbral no
  // son milimetros. Aca el umbral es 6 metros expresado en cm, o sea 600.
  assert.deepEqual(leerMedidaTriple('200x150x40'),
    { central_mm: 2000, alto_mm: 1500, lateral_mm: 400 });
});

test('🔴 NO inventa una tercera medida donde no la hay', () => {
  // Una ventana normal tiene DOS medidas y tiene que seguir siendo una ventana normal.
  assert.equal(leerMedidaTriple('2000x1500'), null);
  assert.equal(leerMedidaTriple('1420x900'), null);
  assert.equal(leerMedidaTriple(''), null);
  assert.equal(leerMedidaTriple(null), null);
  // Y una medida imposible NO se corrige: se devuelve null y el humano decide.
  assert.equal(leerMedidaTriple('2000x1500x0'), null);
  assert.equal(leerMedidaTriple('0x1500x400'), null);
});

test('reconoce la bow window por su nombre, en el idioma del cliente', () => {
  for (const t of ['bow window', 'BOW WINDOW', 'bowindow', 'ventana en esquina',
    'ventana esquinera', 'ventana en L', 'ventanal en esquina']) {
    assert.equal(esBowPorForma(t), true, t);
  }
});

test('🔴 y NO la confunde con lo que solo menciona una esquina', () => {
  // "va en la esquina del living" es UBICACION, no tipologia. Es el mismo error que la
  // "cocina americana" que ya mordio una vez a este repo: una palabra que en Chile sirve
  // para dos cosas distintas.
  for (const t of ['corredera para la esquina del living', 'la ventana de la esquina de la casa',
    'proyectante esquina nororiente', 'fija 1000x1000']) {
    assert.equal(esBowPorForma(t), false, t);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// #947 (26-sep) — LA ESQUINA PAÑO POR PAÑO: cuando el cliente describe CADA paño.
// ══════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL CASO REAL, del dueño, en el chat de Oliver (26-sep 10:58): *"bow windows 4 lados: fija
// 330x1540, fija 1830x1540, fija 1830x1540, mitad superior proyectante y mitad inferior fija
// 325x1540 ... angulo en las esquinas 90 grados"*. Cuatro paños, anchos distintos, aperturas
// distintas. La notacion de tres medidas (central x alto x lateral) es SOLO para la simetrica,
// y Oliver, sin otro camino, la forzo: cotizo "Compuesto 325 + Fijo 1830 + Compuesto 325" —
// una ventana de 2.480 mm que NO es la del cliente (4.315 mm)— y despues escalo sin cotizar.
const PANOS_DUENO = [
  { tipo: 'FIJA', ancho_mm: 330 },
  { tipo: 'FIJA', ancho_mm: 1830 },
  { tipo: 'FIJA', ancho_mm: 1830 },
  { tipo: 'COMPUESTA', ancho_mm: 325, arriba: 'PROYECTANTE', abajo: 'FIJA' },
];

test('#947 lee los paños del cliente EN ORDEN, cada uno con su ancho y su apertura', () => {
  const e = esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, alto_resuelto: true });
  assert.equal(e.error, undefined);
  assert.deepEqual(e.partes.map((p) => p.ancho_mm), [330, 1830, 1830, 325], 'el orden es el del cliente');
  assert.deepEqual(e.partes.map((p) => p.tipo), ['FIJA', 'FIJA', 'FIJA', 'COMPUESTA']);
  assert.equal(e.uniones, 3);
  assert.equal(e.angulo, 90, 'sin decirlo, el poste de 90 que describio el dueño');
  assert.equal(e.alto_mm, 1540);
  assert.equal(e.ancho_total_mm, 4315, 'la SUMA DIRECTA: regla del dueño, el poste queda por fuera');
  assert.equal(e.ancho_max_mm, 1830, 'el paño mas grande: de el sale el vidrio');
  // El compuesto lleva sus dos mitades, con el tipo que dijo el cliente.
  const c = e.partes[3];
  assert.equal(c.orientacion, 'vertical');
  assert.deepEqual(c.partes.map((x) => x.tipo), ['PROYECTANTE', 'FIJA']);
  assert.equal(c.partes.reduce((s, x) => s + x.alto_mm, 0), 1540, 'las mitades suman el alto');
});

test('#947 un compuesto SIN detalle usa el default del motor: proyectante arriba, fijo abajo', () => {
  const e = esquinaDesdePanos([{ tipo: 'COMPUESTA', ancho_mm: 400 }, { tipo: 'FIJA', ancho_mm: 2000 }],
    { alto_mm: 1541, alto_resuelto: true });
  assert.deepEqual(e.partes[0].partes.map((x) => x.tipo), ['PROYECTANTE', 'FIJA']);
  // Alto impar: ni un milimetro se pierde en el redondeo.
  assert.deepEqual(e.partes[0].partes.map((x) => x.alto_mm), [771, 770]);
});

test('#947 en centimetros tambien: si ALGUN ancho baja de 15 cm, el cliente escribio en cm', () => {
  const e = esquinaDesdePanos([{ tipo: 'FIJA', ancho_mm: 33 }, { tipo: 'FIJA', ancho_mm: 183 },
    { tipo: 'FIJA', ancho_mm: 183 }, { tipo: 'COMPUESTA', ancho_mm: 32 }], { alto_mm: 154 });
  assert.deepEqual(e.partes.map((p) => p.ancho_mm), [330, 1830, 1830, 320]);
  assert.equal(e.alto_mm, 1540);
  // Y un alto que YA viene resuelto en mm NO se vuelve a escalar.
  assert.equal(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, alto_resuelto: true }).alto_mm, 1540);
});

test('🔒 #947 una bow CHICA en milimetros (400/600/400) sigue en milimetros', () => {
  // Con el umbral de la notacion triple (maximo <= 600 -> cm) esta ventana salia de 4/6/4 METROS.
  // Alla el alto entra en el maximo y la salva; aca el alto viene aparte. Cazado antes del tridente.
  const e = esquinaDesdePanos([{ tipo: 'FIJA', ancho_mm: 400 }, { tipo: 'FIJA', ancho_mm: 600 },
    { tipo: 'FIJA', ancho_mm: 400 }], { alto_mm: 1500, alto_resuelto: true });
  assert.deepEqual(e.partes.map((p) => p.ancho_mm), [400, 600, 400]);
  assert.equal(e.ancho_total_mm, 1400);
});

test('🔒 #947 NO adivina: un paño no es una esquina, y siete tampoco', () => {
  assert.match(esquinaDesdePanos([{ tipo: 'FIJA', ancho_mm: 1000 }], { alto_mm: 1500 }).error, /entre 2 y 6/);
  const siete = Array.from({ length: 7 }, () => ({ tipo: 'FIJA', ancho_mm: 500 }));
  assert.match(esquinaDesdePanos(siete, { alto_mm: 1500 }).error, /entre 2 y 6/);
  assert.match(esquinaDesdePanos([], { alto_mm: 1500 }).error, /entre 2 y 6/);
});

test('🔒 #947 un paño que CORRE no entra en una esquina: se rechaza, no se degrada a fijo', () => {
  const e = esquinaDesdePanos([{ tipo: 'CORREDERA', ancho_mm: 1200 }, { tipo: 'FIJA', ancho_mm: 400 }],
    { alto_mm: 1500 });
  assert.match(e.error, /CORREDERA/);
  assert.equal(e.partes, undefined);
});

test('🔒 #947 sin alto no hay ventana: se pide, no se inventa', () => {
  assert.match(esquinaDesdePanos(PANOS_DUENO, {}).error, /alto/i);
  assert.match(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 0 }).error, /alto/i);
  assert.match(esquinaDesdePanos([{ tipo: 'FIJA' }, { tipo: 'FIJA', ancho_mm: 400 }], { alto_mm: 1500 }).error, /ancho/i);
});

test('#947 el angulo del cliente se lleva al esquinero que se FABRICA (45 o 90)', () => {
  assert.equal(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: 45 }).angulo, 45);
  assert.equal(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: '90' }).angulo, 90);
  // "cerca de 40 grados" (el caso del dueño del 11-sep) es el esquinero de 45: la nota al
  // cliente y la etiqueta del motor tienen que decir lo mismo (tridente, Codex r2 MEDIO 6).
  assert.equal(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: 40 }).angulo, 45);
  assert.equal(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: 100 }).angulo, 90);
  // "135 grados" es el angulo INTERIOR del bay: el suplementario del poste de 45 (Gemini r3).
  assert.equal(esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: 135 }).angulo, 45);
  assert.deepEqual([anguloFabricable(40), anguloFabricable(90), anguloFabricable(135), anguloFabricable(150), anguloFabricable(10), anguloFabricable(178)],
    [45, 90, 45, 45, null, null]);
});

test('🔒 #947 si el LLM REDONDEA un ancho en cm (35,5 -> 36), el salvavidas lo devuelve a mm paño por paño', () => {
  // Tridente (Gemini r3, MEDIO 2): 36 no esta escrito en el texto, no se escalaba por literalidad,
  // y quedaba un paño de 36 mm. Ningun paño mide menos de 150 mm: solo puede ser centimetros.
  const texto = 'ventana en esquina: fijos de 35,5 cm y de 183 cm, alto 150 cm';
  const e = esquinaDesdePanos([{ tipo: 'FIJA', ancho_mm: 36 }, { tipo: 'FIJA', ancho_mm: 183 }],
    { alto_mm: 1500, alto_resuelto: true, texto_cliente: texto, factor_texto: 10 });
  assert.deepEqual(e.partes.map((p) => p.ancho_mm), [360, 1830], 'el redondeado x10, el literal por el texto');
});

test('🔴 #947 la UNIDAD de los anchos se lee del texto del cliente, no del tamaño del numero', () => {
  // Tridente (Codex r2, GRAVE 2): un umbral no distingue "180 cm" de "180 mm". Tres paños de
  // 180/200/180 cm quedaban de 180/200/180 mm: 10 veces menos perfil y un vidrio mas barato.
  // La regla: si el cliente ESCRIBIO ese numero, lleva la unidad de SU texto (factor 10 = cm);
  // si no lo escribio, lo convirtio el LLM y ya esta en mm.
  const texto = 'bow window de tres paños, 180x150, 200x150 y 180x150, todo en cm';
  const grandesEnCm = [{ tipo: 'FIJA', ancho_mm: 180 }, { tipo: 'FIJA', ancho_mm: 200 }, { tipo: 'FIJA', ancho_mm: 180 }];
  const e = esquinaDesdePanos(grandesEnCm, { alto_mm: 1500, alto_resuelto: true, texto_cliente: texto, factor_texto: 10 });
  assert.deepEqual(e.partes.map((p) => p.ancho_mm), [1800, 2000, 1800]);
  assert.equal(e.ancho_total_mm, 5600);
  // Los mismos paños ya convertidos por el LLM (1800 no esta escrito en el texto) NO se tocan.
  const convertidos = [{ tipo: 'FIJA', ancho_mm: 1800 }, { tipo: 'FIJA', ancho_mm: 2000 }, { tipo: 'FIJA', ancho_mm: 1800 }];
  assert.deepEqual(esquinaDesdePanos(convertidos, { alto_mm: 1500, alto_resuelto: true, texto_cliente: texto, factor_texto: 10 })
    .partes.map((p) => p.ancho_mm), [1800, 2000, 1800]);
  // Mezcla (el LLM convirtio uno y copio otro): cada numero segun lo que es.
  const mezcla = [{ tipo: 'FIJA', ancho_mm: 180 }, { tipo: 'FIJA', ancho_mm: 2000 }, { tipo: 'FIJA', ancho_mm: 180 }];
  assert.deepEqual(esquinaDesdePanos(mezcla, { alto_mm: 1500, alto_resuelto: true, texto_cliente: texto, factor_texto: 10 })
    .partes.map((p) => p.ancho_mm), [1800, 2000, 1800]);
});

test('#947 el factor del texto: 1 (mm), 10 (cm), 1000 (m), en cualquier orden del par, y 1 si no hay par', () => {
  assert.equal(factorDelTexto('fija 330x1540', { ancho_mm: 330, alto_mm: 1540 }), 1);
  assert.equal(factorDelTexto('180x150 cm', { ancho_mm: 1800, alto_mm: 1500 }), 10);
  assert.equal(factorDelTexto('1,54 x 0,33 m', { ancho_mm: 1540, alto_mm: 330 }), 1000);
  // El resolutor dio vuelta el par ("alto por ancho"): el factor sigue siendo 1.
  assert.equal(factorDelTexto('alto por ancho 1540x330', { ancho_mm: 330, alto_mm: 1540 }), 1);
  assert.equal(factorDelTexto('alto 1540, paños 330 1830 1830 325', { ancho_mm: 1830, alto_mm: 1540 }), 1);
  assert.equal(factorDelTexto('', null), 1);
});

test('#947 ¿este numero lo escribio el cliente? tal cual, sin pegarse a otros digitos', () => {
  assert.equal(numeroEscritoPorElCliente(330, 'fija 330x1540'), true);
  assert.equal(numeroEscritoPorElCliente(33, 'fija 330x1540'), false, '33 NO esta: es parte de 330');
  assert.equal(numeroEscritoPorElCliente(1540, 'alto por ancho 1540x330'), true);
  assert.equal(numeroEscritoPorElCliente(1.5, '1,5 x 1,2 metros'), true);
  assert.equal(numeroEscritoPorElCliente(1800, '180x150 cm'), false);
});

test('#947 reconoce el nombre en plural y con el typo real del dueño', () => {
  // "bow windws 4 lados bow windows": `\bwindow\b` no casaba con "windows" ni con "windws".
  for (const t of ['bow windws 4 lados bow windows fija 330x1540', 'quiero dos bow windows', 'ventana con paños en ángulo']) {
    assert.equal(esBowPorForma(t), true, t);
  }
});

test('🔒 #947 un angulo que WinHouse NO fabrica se rechaza aca, con texto para el cliente', () => {
  // Tridente (Gemini r1, MENOR 3): antes pasaba y era el motor el que cortaba con un error tecnico.
  // 10 es demasiado cerrado; 178/180 son "casi plano" (no hay esquina); 120 se lee como interior
  // (180 - 120 = 60 -> esquinero de 45), asi que ya NO se rechaza.
  for (const a of [10, 178, 180]) {
    const e = esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: a });
    assert.match(String(e.error), /90° y de 45°/, `angulo ${a}`);
    assert.equal(e.partes, undefined);
  }
});

test('#947 la etiqueta del motor trae el angulo de la union, y se lee', () => {
  const l4 = 'Bow window · ventana en esquina (4 paños, union 45°): Fijo 330mm + Fijo 1830mm + Fijo 1830mm + Compuesto 325mm';
  const e = esquinaDesdeLabel({ producto_label: l4 });
  assert.equal(e.partes.length, 4);
  assert.equal(e.angulo, 45);
  // Con dos angulos distintos no se sabe cual va en cada union: NO se adivina, se DECLARA
  // ambiguo para que el que cotiza escale (tridente, Codex r2 GRAVE 4).
  const mixto = 'Ventana en esquina (3 paños, union 90° y 45°): Fijo 450mm + Fijo 1800mm + Fijo 450mm';
  const em = esquinaDesdeLabel({ producto_label: mixto });
  assert.equal(em.angulo, undefined);
  assert.equal(em.angulo_ambiguo, true);
  assert.equal(e.angulo_ambiguo, undefined, 'con un solo angulo no hay ambiguedad');
});

// ── Ronda 3 del tridente (Codex): los pares del texto y la literalidad estricta ──────────────
// Un `normFn` de juguete con la misma regla que `normMeasures` para lo que importa aca:
// numeros bajo 400 son centimetros.
const normJuguete = (s) => {
  const m = String(s).match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.'));
  const f = /\bmm\b/.test(s) ? 1 : (/\bcm\b/.test(s) || Math.max(a, b) < 400) ? 10 : 1;
  return { ancho_mm: a * f, alto_mm: b * f };
};

test('#947 paresDelTexto: cada par con SU factor, aunque el texto mezcle unidades', () => {
  const ps = paresDelTexto('primer paño 180x150 cm; segundo 1800x1500 mm; y 330x1540');
  assert.deepEqual(ps.map((p) => [p.a, p.b, p.factor]), [[180, 150, 10], [1800, 1500, 1], [330, 1540, 1]]);
  assert.deepEqual(paresDelTexto('sin pares aca'), []);
});

test('🔴 #947 literalidad: el alto tiene que ser la medida COMUN a todos los pares del cliente', () => {
  const texto = 'fija 330x1540 fija 1830x1540 fija 1830x1540 mitad proyectante mitad fija 325x1540';
  const pares = paresDelTexto(texto);
  const ok = esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: 90, exigir_literal: true, texto_cliente: texto, pares });
  assert.equal(ok.error, undefined);
  assert.equal(ok.alto_mm, 1540);
  // 1830 esta escrito, pero es un ancho: no es comun a los cuatro pares.
  const mal = esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1830, angulo: 90, exigir_literal: true, texto_cliente: texto, pares });
  assert.match(String(mal.error), /común/);
  // Y un ancho que el cliente no escribio se rechaza aunque "parezca" razonable.
  const panos = PANOS_DUENO.map((p, i) => (i === 2 ? { ...p, ancho_mm: 1800 } : p));
  const mal2 = esquinaDesdePanos(panos, { alto_mm: 1540, angulo: 90, exigir_literal: true, texto_cliente: texto, pares });
  assert.match(String(mal2.error), /NO está escrito/i);
});

test('🔴 #947 literalidad: cada número toma la unidad del par donde aparece (texto con cm y mm)', () => {
  const texto = 'primer paño 180x150 cm; segundo 1800x1500 mm';
  const pares = paresDelTexto(texto);
  const e = esquinaDesdePanos([{ tipo: 'FIJA', ancho_mm: 180 }, { tipo: 'FIJA', ancho_mm: 1800 }],
    { alto_mm: 150, angulo: 90, exigir_literal: true, texto_cliente: texto, pares });
  assert.equal(e.error, undefined);
  assert.deepEqual(e.partes.map((p) => p.ancho_mm), [1800, 1800]);
  assert.equal(e.alto_mm, 1500, '150 cm; comun a los dos pares en mm');
});

test('🔒 #947 literalidad: las mitades del compuesto se declaran (no se inventan) y pueden ser desiguales', () => {
  const texto = 'bow window 330x1540, 1830x1540, 1830x1540 y 325x1540 con proyectante de 400 arriba y 1140 fija abajo';
  const pares = paresDelTexto(texto);
  const sinMitades = PANOS_DUENO.map((p) => (p.tipo === 'COMPUESTA' ? { tipo: 'COMPUESTA', ancho_mm: 325 } : p));
  assert.match(String(esquinaDesdePanos(sinMitades, { alto_mm: 1540, angulo: 90, exigir_literal: true, texto_cliente: texto, pares }).error), /ARRIBA/);
  const desiguales = PANOS_DUENO.map((p) => (p.tipo === 'COMPUESTA' ? { ...p, alto_arriba_mm: 400, alto_abajo_mm: 1140 } : p));
  const e = esquinaDesdePanos(desiguales, { alto_mm: 1540, angulo: 90, exigir_literal: true, texto_cliente: texto, pares });
  assert.deepEqual(e.partes[3].partes.map((x) => x.alto_mm), [400, 1140]);
  // Si no suman el alto, se pregunta.
  const noSuman = PANOS_DUENO.map((p) => (p.tipo === 'COMPUESTA' ? { ...p, alto_arriba_mm: 400, alto_abajo_mm: 400 } : p));
  assert.match(String(esquinaDesdePanos(noSuman, { alto_mm: 1540, angulo: 90, exigir_literal: true, texto_cliente: texto, pares }).error), /no suman/);
  // Sin alturas: mitad y mitad, como el motor.
  const mitad = esquinaDesdePanos(PANOS_DUENO, { alto_mm: 1540, angulo: 90, exigir_literal: true, texto_cliente: texto, pares });
  assert.deepEqual(mitad.partes[3].partes.map((x) => x.alto_mm), [770, 770]);
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// #947 · MEDIDO EN PRODUCCION (propuesta CM-FR-004-2026-0557, 26-sep 17:44): EL LLM REESCRIBE LA
// ETIQUETA AL PEDIR EL PDF, y el dibujo salio como UNA proyectante de 4315x1540.
// ══════════════════════════════════════════════════════════════════════════════════════════
const LABEL_LLM = 'Bow window · 4 paños (Fijo 330mm + Fijo 1830mm + Fijo 1830mm + Compuesto 325mm: Proyectante arriba + Fijo abajo) · unión 90°';
const LABEL_MOTOR = 'Bow window · ventana en esquina (4 paños, union 90°): Fijo 330mm + Fijo 1830mm + Fijo 1830mm + Compuesto 325mm (Proyectante 770mm (arriba) + Fijo 770mm (abajo))';

test('🔴 #947 la etiqueta REESCRITA por el LLM se lee igual que la del motor', () => {
  const a = esquinaDesdeLabel({ producto_label: LABEL_LLM });
  const b = esquinaDesdeLabel({ producto_label: LABEL_MOTOR });
  assert.ok(a, 'la del LLM devolvia null: la ventana se dibujaba como una sola');
  assert.deepEqual(a.partes.map((p) => [p.tipo, p.ancho_mm]), [['FIJA', 330], ['FIJA', 1830], ['FIJA', 1830], ['COMPUESTA', 325]]);
  assert.deepEqual(a.partes[3].compuesta.partes.map((x) => x.tipo), ['PROYECTANTE', 'FIJA']);
  assert.equal(a.angulo, 90);
  assert.equal(a.uniones, 3);
  assert.deepEqual(b.partes.map((p) => [p.tipo, p.ancho_mm]), a.partes.map((p) => [p.tipo, p.ancho_mm]));
  // Las mitades vienen "abajo + arriba" en cualquier orden: arriba queda primero.
  const c = esquinaDesdeLabel({ producto_label: 'Bow window · 2 paños (Fijo 2000mm + Compuesto 400mm: Fijo abajo + Proyectante arriba)' });
  assert.deepEqual(c.partes[1].compuesta.partes.map((x) => x.tipo), ['PROYECTANTE', 'FIJA']);
});

test('🔒 #947 si la etiqueta dice N paños y se leen otros, NO se adivina', () => {
  assert.equal(esquinaDesdeLabel({ producto_label: 'Bow window · 4 paños (Fijo 330mm + Fijo 1830mm)' }), null);
  assert.equal(esquinaDesdeLabel({ producto_label: 'Bow window · 4 paños (Fijo 330mm + Fijo 1830mm + Fijo 1830mm…' }), null,
    'una etiqueta truncada a 3 de 4 paños no se completa');
  // Truncada pero con los 4 paños: se lee, y el compuesto sin detalle usa el default (#887).
  const t4 = esquinaDesdeLabel({ producto_label: 'Bow window · 4 paños (Fijo 330mm + Fijo 1830mm + Fijo 1830mm + Compuesto 325mm…)' });
  assert.equal(t4.partes.length, 4);
  assert.equal(t4.partes[3].derivado_de, 'label_sin_detalle');
});
