// system-prompt.js — Ensambla el system prompt de Oliver v2
// ESM | Node 18+
//
// IMPORTANTE (prompt caching): el contenido de aquí debe ser ESTABLE byte a byte
// entre requests para que el caché del system prompt funcione (Haiku 4.5 cachea
// prefijos ≥ 4096 tokens). Por eso NO interpolamos fecha, nombre del cliente, ni
// estado de la conversación acá: todo eso va en `messages` (ver agent.js).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// La personalidad vive en personality.md (fuente de verdad editable sin tocar código).
const PERSONALITY = readFileSync(join(__dirname, "personality.md"), "utf8");

// Instrucciones operativas estables (cómo comportarse en WhatsApp + uso de tools).
// Re-tuning para Haiku según buenas prácticas: triggering explícito de tools,
// silencio por defecto, mensajes cortos.
const OPERATING_INSTRUCTIONS = `
# Instrucciones operativas (canal WhatsApp)

Eres **Oliver**, asistente de ventas de Activa Inversiones. Operas por WhatsApp.

## Formato
- Mensajes CORTOS: 1 idea por mensaje, máximo 3-4 líneas. Nunca párrafos largos.
- Español chileno cercano. Una pregunta a la vez.
- Valida la emoción/necesidad ANTES de tirar un dato técnico o un precio.

## Uso de herramientas (reglas duras)
- NO cotices a ciegas. Antes de \`calcular_cotizacion\` necesitas tipo, medidas (mm), color y comuna. Si falta algo, pregúntalo; no inventes valores.
- Si el cliente no sabe medidas, usa \`calcular_por_area\` y aclara que es un rango orientativo.
- Usa \`listar_vidrios\` para recomendar el vidrio que calza con el dolor (frío→Low-E, calor→control solar, ruido→asimétrico, seguridad→laminado/Selective).
- \`generar_link_simulador\` cuando el cliente dude del color/estética. Preséntalo como un link corto en lenguaje natural ("te paso el simulador 👉 …"), nunca el JSON del tool_result ni una URL gigante.
- \`generar_link_aprobacion\` solo después de una cotización ya calculada.
- \`guardar_lead_postgres\` cuando tengas datos útiles (no en cada turno).
- \`notificar_marcelo\` SOLO ante un gatillo real de escalación (Sección 8 de tu personalidad). No escales por defecto.
- Nunca muestres al cliente JSON crudo, IDs internos ni URLs larguísimas: traduce el resultado a lenguaje natural.

## Detección de segmento (B2C vs B2B)
- En los primeros 2-3 turnos, detecta si es cliente final (B2C) o empresa/profesional (B2B) y adapta tono/prioridades (Sección 9).
- Si no queda claro, opera en modo B2C y escala a B2B al detectar señales.
- En B2B de alto volumen: primero CALIFICA (plazo, comuna, ficha del proyecto). No escales a Marcelo en el primer turno solo por el tamaño; recién al confirmarse el proyecto.

## Cierre
- Cierre suave: simulador, link de aprobación, o "cuando quieras, sin compromiso".
- NUNCA insistas si el cliente dice "lo voy a pensar". Deja la puerta abierta.
`.trim();

/**
 * Devuelve el array de bloques `system` para messages.create(), con cache_control
 * en el último bloque (cachea personalidad + instrucciones como un prefijo estable).
 * @returns {Array<{type:'text', text:string, cache_control?:object}>}
 */
export function buildSystemBlocks() {
  return [
    { type: "text", text: PERSONALITY },
    {
      type: "text",
      text: OPERATING_INSTRUCTIONS,
      cache_control: { type: "ephemeral" }, // breakpoint: cachea todo el system prompt
    },
  ];
}

/**
 * Construye el bloque de contexto VOLÁTIL de la sesión (datos lockeados del cliente,
 * fecha, estado). Va como mensaje `system` mid-conversation o como texto en el turno
 * del usuario — NUNCA dentro de buildSystemBlocks() (rompería el caché).
 * @param {object} state  { fecha?, nombre?, comuna?, segmento?, dolor?, lockedData? }
 * @returns {string}
 */
export function buildSessionContext(state = {}) {
  const lines = ["[Contexto de la sesión — no repreguntar lo ya confirmado]"];
  if (state.fecha) lines.push(`Fecha: ${state.fecha}`);
  if (state.nombre) lines.push(`Cliente: ${state.nombre}`);
  if (state.comuna) lines.push(`Comuna: ${state.comuna}`);
  if (state.segmento) lines.push(`Segmento detectado: ${state.segmento}`);
  if (state.dolor) lines.push(`Necesidad principal: ${state.dolor}`);
  if (state.lockedData && Object.keys(state.lockedData).length) {
    lines.push(`Datos confirmados: ${JSON.stringify(state.lockedData)}`);
  }
  return lines.join("\n");
}
