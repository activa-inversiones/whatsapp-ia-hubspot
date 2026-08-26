// orientacion-medidas.test.js — [2026-08-26]
//
// 🔴 NACIÓ DE UN ERROR QUE LE COSTÓ PLATA AL DUEÑO.
//
// Paula escribió, textual: *"LAS MEDIDAS ESTÁN ALTO POR ANCHO — 1 DE 220 x 200 CORREDERA,
// 1 DE 220x150 CORREDERA…"*. Se le cotizó al revés: 2200 de ancho × 2000 de alto, cuando
// pedía 2000 de ancho × 2200 de alto. Una corredera con las dos medidas cambiadas no vale
// lo mismo ni se fabrica igual.
//
// LA CAUSA: la orientación se DEDUCÍA por física — "ninguna ventana es más alta que el
// techo, así que si algún alto pasa los 2400 mm la tabla viene al revés". Con el máximo de
// Paula en 2200, la regla nunca se disparó. La deducción es un buen respaldo, pero cuando
// el cliente lo dice con todas las letras, lo que dice manda. Instrucción del dueño:
// *"cliente indica que son alto por ancho, eso está SOBRE la regla"*.

import test from 'node:test';
import assert from 'node:assert/strict';
import { orientacionDeclarada } from './enginePricer.js';

test('🔴 el caso de Paula, con sus palabras exactas', () => {
  const suyo = 'cliente PAULA DE LA COMUNA DE TEMUCO QUIERE 2 COTIZACIONES UNA DE COLOR NEGRO '
    + 'Y LA OTRA DE COLOR BLANCO ALAS MEDIDAS ESTÁN ALTO  POR  ANCHO  1 DE 220 x 200 CORREDERA';
  assert.equal(orientacionDeclarada(suyo), 'alto_ancho');
});

test('🔴 se entiende como lo escribe la gente de verdad', () => {
  for (const t of [
    'las medidas están alto por ancho',
    'LAS MEDIDAS ESTAN ALTO X ANCHO',
    'estan alto x ancho',
    'van alto-ancho',
    'alto, ancho',
    'primero el alto',
    'el alto va primero',
    'empiezan por el alto',
  ]) {
    assert.equal(orientacionDeclarada(t), 'alto_ancho', `debería ser alto×ancho: "${t}"`);
  }
  for (const t of [
    'las medidas van ancho por alto',
    'ancho x alto',
    'primero el ancho',
    'el ancho va primero',
  ]) {
    assert.equal(orientacionDeclarada(t), 'ancho_alto', `debería ser ancho×alto: "${t}"`);
  }
});

test('🔒 sin declaración NO se inventa una: manda la regla física de siempre', () => {
  // Lo que NO puede pasar es interpretar una frase cualquiera como una declaración de orden
  // y dar vuelta una lista que estaba bien.
  for (const t of [
    '1 de 220x200 corredera',
    'quiero una ventana alta y ancha',
    'la más ancha va en el living',
    'el alto del techo es 2.4',
    'necesito un ancho de puerta grande',
    '',
    null,
    undefined,
  ]) {
    assert.equal(orientacionDeclarada(t), null, `NO es una declaración: "${t}"`);
  }
});

test('🔴 lo que dice el cliente GANA sobre la deducción por tamaño', async () => {
  // El corazón del arreglo: con una lista chica (nada supera 2400) la regla física dice
  // "no hay nada que dar vuelta", y la frase del cliente tiene que imponerse igual.
  const { priceAllEngine } = await import('./enginePricer.js');
  const d = {
    texto_cliente: 'ALAS MEDIDAS ESTÁN ALTO POR ANCHO',
    items: [{ product: 'CORREDERA', measures: '220x200', qty: 1 }],
  };
  // No se cotiza de verdad (no hay motor acá): alcanza con que marque el swap.
  await priceAllEngine(d).catch(() => {});
  assert.equal(d.orientacion_declarada, 'alto_ancho', 'quedó registrado que el cliente lo dijo');
  assert.equal(d.items[0].measures_swapped, true, 'y la medida se dio vuelta');
});

test('🔒 si el cliente dice ANCHO por ALTO, no se da vuelta nada', async () => {
  const { priceAllEngine } = await import('./enginePricer.js');
  const d = {
    texto_cliente: 'las medidas van ancho por alto',
    items: [{ product: 'CORREDERA', measures: '220x200', qty: 1 }],
  };
  await priceAllEngine(d).catch(() => {});
  assert.equal(d.orientacion_declarada, 'ancho_alto');
  assert.ok(!d.items[0].measures_swapped, 'se respeta el orden que declaró');
});

// ── Los dos hallazgos de Gemini en la compuerta ───────────────────────────────

test('🔴 [Gemini] "altura/anchura" también cuenta — es igual de común al dictar medidas', () => {
  assert.equal(orientacionDeclarada('las medidas están altura por anchura'), 'alto_ancho');
  assert.equal(orientacionDeclarada('anchura x altura'), 'ancho_alto');
});

test('🔴 [Gemini] BUG CRÍTICO: una declaración VIEJA no puede dar vuelta una lista NUEVA', async () => {
  // El cableado mandaba TODO el historial del cliente al motor. Escenario que abría:
  // el lunes la clienta dice "alto x ancho" y se le cotiza bien; el martes pide otra
  // ventana en orden normal y esa frase del lunes le da vuelta la cotización nueva.
  // Un bug PEOR que el que se estaba arreglando, porque rompe pedidos que estaban bien.
  //
  // El arreglo vive en webhook.js (`.slice(-2)` sobre los mensajes del cliente). Acá se
  // prueba la propiedad que importa: el motor solo da vuelta si la declaración está en el
  // texto que RECIBE — o sea, quien arma ese texto es responsable de acotarlo.
  const { priceAllEngine } = await import('./enginePricer.js');
  const nueva = {
    texto_cliente: 'hola, cotízame también 1 ventana de 180x120',   // sin declaración
    items: [{ product: 'CORREDERA', measures: '180x120', qty: 1 }],
  };
  await priceAllEngine(nueva).catch(() => {});
  assert.equal(nueva.orientacion_declarada, undefined, 'no hay declaración en el pedido actual');
  assert.ok(!nueva.items[0].measures_swapped, 'y la lista NUEVA no se toca');
});

test('🔒 la declaración SÍ vale cuando viene en el mensaje anterior del mismo pedido', async () => {
  // El caso legítimo que hay que preservar: "las medidas van alto por ancho" en un mensaje
  // y la lista en el siguiente. Por eso la ventana son los últimos mensajes, no solo el actual.
  const { priceAllEngine } = await import('./enginePricer.js');
  const d = {
    texto_cliente: 'las medidas van alto por ancho  1 de 220x200 corredera',
    items: [{ product: 'CORREDERA', measures: '220x200', qty: 1 }],
  };
  await priceAllEngine(d).catch(() => {});
  assert.equal(d.orientacion_declarada, 'alto_ancho');
  assert.equal(d.items[0].measures_swapped, true);
});

// ── Lo que salió de la corrida REAL con Paula (26-ago) ───────────────────────
// La propuesta volvió con los dos errores intactos aunque el código estaba desplegado.
// Reproducirlo mostró TRES fallas encadenadas, cada una tapando a la siguiente.

test('🔴 el cliente escribe con faltas y la ventana igual se entiende', async () => {
  // Paula escribió DOS VECES "MITAD PROYECTACTE SUPERIOR MITAD FIJA INFERIR": le falta una
  // N a "proyectante" y la R a "inferior". El detector exigía la ortografía del diccionario,
  // así que no reconocía la ventana vertical y las 3 terminaban escaladas a Marcelo.
  const { esCompuestaVertical } = await import('./enginePricer.js');
  assert.equal(esCompuestaVertical('MITAD PROYECTACTE SUPERIOR MITAD FIJA INFERIR'), true);
  assert.equal(esCompuestaVertical('1 DE 220x100 MITAD PROYECTACTE SUPERIOR MITAD FIJA INFERIR'), true);
});

test('🔒 …pero "proyecto" NO es "proyectante"', async () => {
  // Tolerar faltas no puede volverse tolerar cualquier cosa: "proyecto" es una palabra común
  // en este rubro y no tiene nada que ver con una ventana proyectante.
  const { esCompuestaVertical } = await import('./enginePricer.js');
  for (const t of ['el proyecto de arriba', 'los proyectos de arriba', 'mi proyecto de abajo']) {
    assert.equal(esCompuestaVertical(t), false, `"${t}" no es una ventana vertical`);
  }
});

test('🔴 la medida corregida QUEDA EN EL ÍTEM, no solo en el precio', async () => {
  // El error más caro de los tres: se cotizaba 2000×2200 y el PDF mostraba 2200×2000. Si el
  // cliente aprueba ese PDF, fábrica construye la ventana equivocada y se descubre instalando.
  const { priceAllEngine } = await import('./enginePricer.js');
  const d = {
    texto_cliente: 'LAS MEDIDAS ESTÁN ALTO POR ANCHO',
    items: [{ product: 'CORREDERA', measures: '2200x2000', qty: 1 }],
  };
  await priceAllEngine(d).catch(() => {});
  const it = d.items[0];
  assert.equal(it.measures_swapped, true);
  assert.equal(it.measures, '2000x2200', 'la medida que se muestra es la que se cotizó');
  assert.equal(it.measures_texto_cliente, '2200x2000', 'y la del cliente queda rastreable');
  // Campo propio a propósito: `measures_original` ya tiene otro dueño (la rama "referencial"
  // guarda ahí la medida pedida antes del recorte) y pisaba este dato sin que nadie lo notara.
});

test('🔴 el EJE llega hasta el motor: el payload lo lleva', async () => {
  // Se perdía en el último salto. `engine-client` arma el payload con una lista EXPLÍCITA de
  // campos y `orientacion` no estaba en ella: el pricer la calculaba, la mandaba, y se caía
  // en silencio. Mismo bug que Codex cazó con `partes`, en la misma función.
  const src = await import('node:fs').then((fs) => fs.readFileSync('./src/oliver-gpt/engine-client.js', 'utf8'));
  assert.match(src, /const\s*\{[^}]*orientacion[^}]*\}\s*=\s*params/, 'se lee de los params');
  assert.match(src, /payload\.orientacion\s*=\s*orientacion/, 'y se escribe en el payload');
});
