// [2026-10-12 · #1500-A] EL OLIVER INTERNO LEE CON EL CEREBRO DEL BOT.
//
// HECHO DEL NEGOCIO (dueño, 12-oct 02:58, textual): *«definimos que sea el mismo Oliver porque el
// vendedor y yo no podemos cotizar en este; lo agregamos solo para que quede documentado en el
// mismo chat del cliente»*. Medido ese día: la misma frase, el bot la arma como 1 bow window de
// 3 paños y la pantalla interna (parser propio de sales-os) la cotizó como 500 × proyectante,
// $266.257.355. Dos lectores = dos resultados. Acá queda UN lector: el del bot.
//
// HERMÉTICO: `handleTurn` es el REAL (así se prueba el cableado de estado y contexto); el motor
// LLM (`engine`) y el ejecutor de herramientas (`runTool`) se inyectan. Nada toca la red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerYCotizar, soloCotizar, motorSinPass2, HERRAMIENTAS_DE_PRECIO, TOPE_CANTIDAD_TEXTO_LIBRE,
} from './oliverInternoLector.js';

// La frase exacta del dueño (12-oct 02:53), la que el interno leyó como 500 unidades.
const FRASE_DEL_DUEÑO = 'Hola, necesito cotizar 1 bow window 2500x1500x500 mm, laterales mitad proyectante '
  + 'arriba y mitad fija abajo, unión a 90 grados, vidrio 5+12+5, color nogal, para Angol';

const PEDIDO_BOW = {
  tipo: 'FIJA', medidas_texto: '2500x1500x500 mm', cantidad: 1, color: 'NOGAL', comuna: 'Angol',
  descripcion_producto: 'bow window, laterales mitad proyectante arriba y mitad fija abajo, unión a 90 grados',
};

/** Motor LLM falso: en la 1ª pasada emite las tool_calls que se le dan; después, nada. */
function motorFalso(llamadas, { contenido = '' } = {}) {
  const vistos = [];
  let pasada = 0;
  return {
    vistos,
    async orchestratorPass1({ messages }) {
      // Copia: `handleTurn` sigue empujando mensajes (assistant/tool) sobre el MISMO arreglo
      // después de esta pasada; sin la copia, `vistos[0].at(-1)` sería el último tool result.
      vistos.push([...messages]);
      pasada += 1;
      if (pasada > 1) return { tool_calls: [], content: contenido, raw: {} };
      return {
        content: null,
        raw: {},
        tool_calls: llamadas.map((c, i) => ({
          id: `call_${i}`, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        })),
      };
    },
    async orchestratorPass2() { return contenido; },
  };
}

/** Ejecutor falso: registra qué le pidieron y devuelve un precio inventado. */
function ejecutorFalso() {
  const pedidos = [];
  const runTool = async (name, input, ctx) => {
    pedidos.push({ name, input, ctx });
    return { ok: true, unit_price: 1234567, cantidad: input.cantidad || 1, producto_label: 'Bow window · 3 paños', measures: '3500x1500mm', glass_label: '5+12+5' };
  };
  return { runTool, pedidos };
}

test('[#1500-A] solo corren las herramientas de PRECIO: guardar, enviar y las mcp_ se rechazan sin ejecutarse', async () => {
  const engine = motorFalso([
    { name: 'calcular_cotizacion', input: PEDIDO_BOW },
    { name: 'guardar_cotizacion', input: { quote_id: 'x' } },
    { name: 'mcp_mi_cotizacion', input: {} },
  ]);
  const { runTool, pedidos } = ejecutorFalso();

  const out = await leerYCotizar({ texto: FRASE_DEL_DUEÑO, comuna: 'Angol', color: 'NOGAL', nombre: 'Mary', deps: { engine, runTool } });

  assert.deepEqual(pedidos.map((p) => p.name), ['calcular_cotizacion'], 'al ejecutor real solo llega la de precio');
  assert.equal(out.ok, true);
  assert.equal(out.lineas.length, 1);
  assert.equal(out.lineas[0].n, 1);
  assert.equal(out.lineas[0].herramienta, 'calcular_cotizacion');
  assert.deepEqual(out.lineas[0].pedido, PEDIDO_BOW, 'el pedido tal como lo leyó el LLM viaja entero');
  assert.equal(out.lineas[0].resultado.unit_price, 1234567);
  assert.deepEqual(out.bloqueadas, ['guardar_cotizacion', 'mcp_mi_cotizacion']);
  assert.deepEqual(HERRAMIENTAS_DE_PRECIO, ['calcular_cotizacion', 'calcular_por_area']);
});

test('[#1500-A] el texto del vendedor llega como textoCliente al ejecutor, y comuna/color/nombre al estado del turno', async () => {
  const engine = motorFalso([{ name: 'calcular_cotizacion', input: PEDIDO_BOW }]);
  const { runTool, pedidos } = ejecutorFalso();

  await leerYCotizar({ texto: FRASE_DEL_DUEÑO, comuna: 'Angol', color: 'NOGAL', nombre: 'Mary', deps: { engine, runTool } });

  assert.equal(pedidos[0].ctx.textoCliente, FRASE_DEL_DUEÑO);
  const contenido = String(engine.vistos[0].at(-1).content);
  assert.ok(contenido.includes(FRASE_DEL_DUEÑO), 'la frase va al LLM tal cual');
  assert.match(contenido, /Angol/, 'la comuna de la ficha entra al contexto del turno');
  assert.match(contenido, /NOGAL/i, 'el color elegido en la pantalla entra al contexto del turno');
  assert.match(contenido, /Mary/, 'el nombre del cliente entra al contexto (para que Oliver no lo pregunte)');
});

test('[#1500-A] GUARDIA: una cantidad > 50 leída de texto libre NO se cotiza (fail-closed); 50 sí', async () => {
  const engine = motorFalso([
    { name: 'calcular_cotizacion', input: { ...PEDIDO_BOW, cantidad: 500 } },
    { name: 'calcular_cotizacion', input: { ...PEDIDO_BOW, cantidad: TOPE_CANTIDAD_TEXTO_LIBRE } },
  ]);
  const { runTool, pedidos } = ejecutorFalso();

  const out = await leerYCotizar({ texto: FRASE_DEL_DUEÑO, comuna: 'Angol', color: 'NOGAL', deps: { engine, runTool } });

  assert.equal(TOPE_CANTIDAD_TEXTO_LIBRE, 50);
  assert.equal(pedidos.length, 1, 'la de 500 no llega al motor; la de 50 sí');
  assert.equal(pedidos[0].input.cantidad, 50);
  assert.equal(out.lineas.length, 2, 'las dos líneas se devuelven: una cotizada y una frenada');
  assert.equal(out.lineas[0].resultado.ok, false);
  assert.match(out.lineas[0].resultado.error, /500/);
  assert.equal(out.lineas[0].resultado.cantidad_sospechosa, 500);
  assert.equal(out.lineas[1].resultado.ok, true);
  assert.deepEqual(out.sospechosas, [{ n: 1, cantidad: 500 }]);
});

test('[#1500-A] si Oliver no cotizó nada (preguntó), vuelve ok:false con su respuesta, sin inventar líneas', async () => {
  const engine = motorFalso([], { contenido: '¿Me confirmás el alto de la ventana?' });
  const { runTool, pedidos } = ejecutorFalso();

  const out = await leerYCotizar({ texto: 'una ventana', comuna: 'Temuco', color: 'BLANCO', deps: { engine, runTool } });

  assert.equal(pedidos.length, 0);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'oliver_no_cotizo');
  assert.deepEqual(out.lineas, []);
  assert.equal(out.respuesta, '¿Me confirmás el alto de la ventana?');
});

test('[#1500-A r4 · Thermos DEFECTO 1] la pregunta de Oliver llega aunque la segunda pasada esté anulada: sale del content de la primera', async () => {
  // En producción `orchestratorPass2` se reemplaza (acá nadie lee la charla), pero cuando el LLM PREGUNTA en vez de
  // cotizar, su pregunta viene en `pass1.content`. Antes `respuesta` salía '' y la pantalla decía «Oliver no cotizó»
  // sin decir qué pedía. `motorSinPass2` devuelve el último content del assistant SIN llamar al LLM de nuevo.
  const base = {
    async orchestratorPass1() { return { tool_calls: [], content: '¿Me confirmás el alto de la ventana?', raw: {} }; },
    async orchestratorPass2() { throw new Error('pass2 NO debe llamarse: cuesta una pasada del LLM que nadie lee'); },
  };
  const out = await leerYCotizar({ texto: 'una ventana', comuna: 'Temuco', color: 'BLANCO', deps: { engine: motorSinPass2(base), runTool: async () => ({ ok: true }) } });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'oliver_no_cotizo');
  assert.equal(out.respuesta, '¿Me confirmás el alto de la ventana?');
});

test('[#1500-A r4 · Thermos] el turno corre en MODO INTERNO (vendedor del equipo): el contexto lo dice y no hay preguntas de calificación', async () => {
  const engine = motorFalso([{ name: 'calcular_cotizacion', input: PEDIDO_BOW }]);
  const { runTool } = ejecutorFalso();
  await leerYCotizar({ texto: FRASE_DEL_DUEÑO, comuna: 'Angol', color: 'NOGAL', nombre: 'Mary', deps: { engine, runTool } });
  const contenido = String(engine.vistos[0].at(-1).content);
  assert.match(contenido, /MODO INTERNO: TE ESCRIBE ALGUIEN DEL EQUIPO/, 'el bloque de internosEquipo.js entra al turno');
});

test('[#1500-A r5 · Codex] dos líneas IDÉNTICAS se conservan las dos (pueden ser dos ventanas reales); solo se cuenta la repetición para avisar', async () => {
  // Codex r2 (NO APTO): el dedupe de r4 fusionaba dos llamadas iguales con cantidad 1 — que pueden ser dos unidades
  // reales — y sales-os retenía la mitad del total. No hay información en la clave para distinguir «reintento del
  // LLM» de «segunda unidad»: ante la duda se conservan y el vendedor las ve en el borrador.
  const engine = motorFalso([
    { name: 'calcular_cotizacion', input: PEDIDO_BOW },
    { name: 'generar_pdf_cotizacion', input: {} },
    { name: 'calcular_cotizacion', input: { ...PEDIDO_BOW } },
    { name: 'calcular_cotizacion', input: { ...PEDIDO_BOW, cantidad: 2 } },
  ]);
  const { runTool } = ejecutorFalso();
  const out = await leerYCotizar({ texto: FRASE_DEL_DUEÑO, comuna: 'Angol', color: 'NOGAL', deps: { engine, runTool } });
  assert.equal(out.lineas.length, 3, 'ninguna línea se descarta');
  assert.deepEqual(out.lineas.map((l) => l.n), [1, 2, 3]);
  assert.equal(out.repetidas, 1, 'se avisa que hubo una repetición exacta, sin tocar las líneas');
});

test('[#1500-A r4 · Thermos DEFECTO 2] la bolsa interna del resultado (avisos del motor, color cobrado, fabricación) viaja en `interno`', async () => {
  // El handler del bot cuelga `_interno` NO enumerable (el LLM del WhatsApp no la ve, JSON.stringify la salta).
  // El canal interno la expone como `resultado.interno` para que el vendedor vea lo que el motor avisó.
  const engine = motorFalso([{ name: 'calcular_cotizacion', input: PEDIDO_BOW }]);
  const runTool = async () => {
    const r = { ok: true, unit_price: 1, cantidad: 1, producto_label: 'x' };
    Object.defineProperty(r, '_interno', { value: { avisos: ['el total NO incluye la unión'], color_cobrado: 'NOGAL', aviso_fabricacion: 'hoja > 1200' }, enumerable: false });
    return r;
  };
  const out = await leerYCotizar({ texto: FRASE_DEL_DUEÑO, deps: { engine, runTool } });
  assert.deepEqual(out.lineas[0].resultado.interno, { avisos: ['el total NO incluye la unión'], color_cobrado: 'NOGAL', aviso_fabricacion: 'hoja > 1200' });
  assert.equal(JSON.stringify(out.lineas[0].resultado).includes('_interno'), false);
});

test('[#1500-A] soloCotizar: el envoltorio es puro — rechaza por nombre y por cantidad sin tocar el ejecutor', async () => {
  const llamadas = [];
  const exec = soloCotizar(async (name, input) => { llamadas.push(name); return { ok: true, input }; });

  const r1 = await exec('enviar_pdf', {}, {});
  const r2 = await exec('calcular_cotizacion', { cantidad: 51 }, {});
  const r3 = await exec('calcular_por_area', { cantidad: 2 }, {});

  assert.equal(r1.ok, false);
  assert.match(r1.error, /no disponible/);
  assert.equal(r2.ok, false);
  assert.equal(r2.cantidad_sospechosa, 51);
  assert.equal(r3.ok, true);
  assert.deepEqual(llamadas, ['calcular_por_area']);
  assert.deepEqual(exec.bloqueadas, ['enviar_pdf']);
  assert.deepEqual(exec.sospechosas, [{ n: 1, cantidad: 51 }]);
});
