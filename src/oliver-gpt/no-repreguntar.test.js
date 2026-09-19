import test from 'node:test';
import assert from 'node:assert/strict';
import { extractComuna, extraerColor } from './normalizers.js';

/* =========================================================================
 * 🔴 OLIVER PREGUNTABA DOS VECES LO QUE EL CLIENTE YA HABIA DICHO (2026-09-18)
 *
 * Reclamo del dueño, textual: *"contesta horrible porque pide 2 veces las mismas cosas; le digo
 * color blanco y me pide color, me pide comuna y ya se la habían enviado"*.
 *
 * El mensaje REAL del cliente, primera linea de la conversacion:
 *     "soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente"
 *
 * Y lo que se midio:
 *   · `extractComuna(...)` -> null. Escribio "vilcuL" con L. La comuna no se guardaba, Oliver
 *     la preguntaba, el cliente contestaba "ya te dije", Oliver se disculpaba ("no le voy a
 *     volver a preguntar")... y la VOLVIA A PREGUNTAR en el mismo mensaje, porque seguia sin
 *     tenerla. No era el LLM portandose mal: era que el dato no existia.
 *   · el COLOR no se extraia NUNCA: agent.js solo llamaba a extractComuna. `colorFueExplicito`
 *     y `normColor` existian hace meses, sin conectar.
 * ========================================================================= */

test('🔴 el mensaje REAL del cliente deja comuna Y color, de una', () => {
  const t = 'soy a nombre de MARIO GREY comuna de vilcul y color blanco necesito lo siguiente';
  assert.equal(extractComuna(t), 'Vilcún', 'la comuna, aunque escriba "vilcuL"');
  assert.equal(extraerColor(t), 'BLANCO', 'y el color, que antes no se miraba nunca');
});

test('🔒 la tolerancia es de UNA letra y no inventa comunas', () => {
  // Bien escritas, como siempre.
  for (const [t, e] of [
    ['comuna de vilcun', 'Vilcún'], ['temuco', 'Temuco'], ['padre las casas', 'Padre Las Casas'],
    ['villarrica', 'Villarrica'], ['pucon', 'Pucón'], ['freire', 'Freire'], ['cunco', 'Cunco'],
  ]) assert.equal(extractComuna(t), e, t);
  // Lo que NO es una comuna nuestra sigue sin serlo. Si no esta, Oliver pregunta — que es lo
  // correcto: se tolera un typo, no se adivina un destino de despacho.
  for (const t of ['no dice comuna', 'santiago', 'valparaiso', 'buenos aires']) {
    assert.equal(extractComuna(t), null, t);
  }
});

test('🔒 el color solo cuenta si el cliente lo dijo como color', () => {
  assert.equal(extraerColor('color blanco'), 'BLANCO');
  assert.equal(extraerColor('ventanas blancas'), 'BLANCO');
  assert.equal(extraerColor('no digo color'), null);
  assert.equal(extraerColor(''), null);
  assert.equal(extraerColor(null), null);
});

/* =========================================================================
 * 🔱 LO QUE CAZO LA COMPUERTA (Codex) SOBRE LA PASADA APROXIMADA
 * Textual: *"`freirse` está a una inserción de `freire`. Una frase como `para no freírse con el
 * sol` podría inferir Freire"*. MEDIDO: era cierto. Un despacho a la comuna equivocada cuesta
 * plata, asi que la pasada aproximada ahora exige CONTEXTO DE LUGAR.
 * Un nombre EXACTO sigue valiendo por si solo; uno aproximado necesita que el cliente este
 * hablando de un lugar ("comuna DE vilcul", "vivo EN lautarl", "despacho A victorias").
 * ========================================================================= */

test('🔴 una palabra cualquiera parecida a una comuna NO es una comuna', () => {
  for (const t of [
    'para no freirse con el sol',
    'freirse',
    'quiero cortinas',
    'la ventana del living',
    'necesito termopanel',
  ]) assert.equal(extractComuna(t), null, t);
});

test('🔒 con contexto de lugar, el typo si se resuelve', () => {
  assert.equal(extractComuna('comuna de vilcul'), 'Vilcún');
  assert.equal(extractComuna('vivo en lautarl'), 'Lautaro');
  assert.equal(extractComuna('despacho a victorias'), 'Victoria');
});

test('🔒 no hay DOS comunas nuestras a una letra de distancia (medido sobre la lista real)', async () => {
  // Si mañana se agrega una comuna que colisione con otra, esto se pone rojo: ahi la tolerancia
  // deja de ser segura para ese par y hay que confirmarla con el cliente.
  const { ZONA_COMUNAS } = await import('./normalizers.js');
  const claves = Object.keys(ZONA_COMUNAS).filter((k) => k.length >= 6 && !k.includes(' '));
  const aUnaLetra = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let d = 0; let x = 0; let y = 0;
    while (x < a.length && y < b.length) {
      if (a[x] === b[y]) { x += 1; y += 1; continue; }
      d += 1;
      if (d > 1) return false;
      if (a.length === b.length) { x += 1; y += 1; } else if (a.length < b.length) { y += 1; } else { x += 1; }
    }
    return d + (a.length - x) + (b.length - y) <= 1;
  };
  const choques = [];
  for (let i = 0; i < claves.length; i += 1) {
    for (let j = i + 1; j < claves.length; j += 1) {
      if (aUnaLetra(claves[i], claves[j])) choques.push(`${claves[i]}/${claves[j]}`);
    }
  }
  assert.deepEqual(choques, [], `comunas a una letra de distancia: ${choques.join(', ')}`);
});

/* =========================================================================
 * 🔱 LO QUE CAZO GEMINI: UNA DIRECCION NO ES UN COLOR
 * Textual: *"En Chile 'Blanco' es un nombre extremadamente común en calles y comunas (calle
 * Blanco Encalada, Río Blanco, Valle Blanco)... el sistema le bloqueó el color Blanco usando un
 * dato de la dirección"*. MEDIDO: era cierto, y el cliente que queria grafito ya no podia
 * cambiarlo porque `lockedData` es DEFINITIVO por diseño.
 * ========================================================================= */

test('🔴 el color NO se saca de la direccion del cliente', () => {
  for (const t of [
    'soy de Temuco, calle Blanco Encalada 623',
    'despacho en Rio Blanco',
    'vivo en Valle Blanco 120',
  ]) assert.equal(extraerColor(t), null, t);
});

test('🔒 pero si la direccion trae "Blanco" Y el cliente pide otro color, gana el color pedido', () => {
  assert.equal(extraerColor('calle Blanco Encalada 623, color grafito'), 'GRAFITO');
});

test('🔒 el cliente usa el nombre CORTO del color, no el del catalogo', () => {
  // Nadie dice "grafito antracita" ni "roble dorado" completo.
  assert.equal(extraerColor('color grafito'), 'GRAFITO');
  assert.equal(extraerColor('lo quiero en roble'), 'NOGAL');
  assert.equal(extraerColor('nogal'), 'NOGAL');
  assert.equal(extraerColor('grafito antracita'), 'GRAFITO');
});
