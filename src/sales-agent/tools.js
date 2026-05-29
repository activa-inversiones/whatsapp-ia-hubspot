// tools.js — Definición de tools (Anthropic tool schema) + executors
// Oliver v2 | mapeo a ACTIVA Engine v1.1
// ESM | Node 18+
//
// Estructura: TOOL_DEFS se envían a Claude; runTool() ejecuta la llamada real.
// Cada executor devuelve un objeto serializable que vuelve como tool_result.

import {
  calcularCotizacion,
  calcularPorArea,
  listarVidrios,
  generarLinkAprobacion,
} from "./engine-client.js";

// ── Definiciones de tools (JSON Schema) ───────────────────────────────────
// Mantener el ORDEN y el contenido ESTABLES: las tools se renderizan en
// posición 0 del prompt y cualquier cambio invalida el caché. No reordenar
// ni reescribir descripciones sin necesidad.

export const TOOL_DEFS = [
  {
    name: "calcular_cotizacion",
    description:
      "Cotiza una ventana con medidas exactas usando el ACTIVA Engine (precisión vs fábrica). " +
      "Úsala cuando el cliente ya dio tipo, medidas (mm), color y comuna. NO la uses si faltan datos: pregunta primero.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Tipo de ventana, ej. TERMOPANEL, MONOLITICO, CORREDERA" },
        ancho_mm: { type: "integer", description: "Ancho en milímetros" },
        alto_mm: { type: "integer", description: "Alto en milímetros" },
        color: { type: "string", description: "Color del perfil, ej. blanco, gris, madera" },
        glass_id: { type: "string", description: "ID del vidrio (de listar_vidrios). Opcional si el cliente no eligió." },
        comuna: { type: "string", description: "Comuna de despacho (afecta flete)" },
      },
      required: ["tipo", "ancho_mm", "alto_mm", "color", "comuna"],
    },
  },
  {
    name: "calcular_por_area",
    description:
      "Cotiza por metros cuadrados cuando el cliente NO sabe las medidas exactas. " +
      "Da un rango orientativo; para precio firme se necesita medición.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Tipo de ventana" },
        m2: { type: "number", description: "Metros cuadrados aproximados" },
        color: { type: "string", description: "Color del perfil" },
        comuna: { type: "string", description: "Comuna de despacho" },
      },
      required: ["tipo", "m2", "comuna"],
    },
  },
  {
    name: "listar_vidrios",
    description:
      "Lista los vidrios disponibles para un tipo (Low-E, control solar, laminado, asimétrico). " +
      "Úsala para recomendar el vidrio que calza con el dolor del cliente (frío/calor/ruido/seguridad).",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Tipo de ventana, ej. TERMOPANEL" },
      },
      required: ["tipo"],
    },
  },
  {
    name: "generar_link_simulador",
    description:
      "Genera un link al simulador 3D para que el cliente vea la ventana en distintos colores/tipos. " +
      "Útil cuando el cliente está indeciso de color o estética.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Tipo de ventana (opcional)" },
        color: { type: "string", description: "Color inicial sugerido (opcional)" },
      },
      required: [],
    },
  },
  {
    name: "generar_link_aprobacion",
    description:
      "Genera el link compartible de una cotización ya calculada (para que el cliente la revise/apruebe).",
    input_schema: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "ID de la cotización generada por calcular_cotizacion" },
      },
      required: ["quote_id"],
    },
  },
  {
    name: "guardar_lead_postgres",
    description:
      "Persiste los datos del lead calificado (nombre, comuna, tipo de cliente B2C/B2B, dolor, etapa). " +
      "Úsala cuando ya tengas datos útiles del cliente, no en cada turno.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        telefono: { type: "string" },
        comuna: { type: "string" },
        segmento: { type: "string", enum: ["B2C", "B2B", "desconocido"] },
        dolor: { type: "string", description: "Necesidad principal: frío, calor, ruido, seguridad, estética, subsidio" },
        etapa: { type: "string", description: "Etapa del embudo, ej. descubrimiento, cotizado, cierre" },
      },
      required: [],
    },
  },
  {
    name: "notificar_marcelo",
    description:
      "Escala a Marcelo (humano). SOLO cuando aplica un gatillo de la Sección 8 de la personalidad: " +
      "cliente molesto, negociación de precio, pide humano, alto valor/obra, pregunta técnica fuera de alcance, " +
      "cierre caliente, o silencio post-cotización en lead caliente.",
    input_schema: {
      type: "object",
      properties: {
        razon: { type: "string", description: "Motivo concreto de la escalación" },
        telefono_cliente: { type: "string", description: "Teléfono del cliente para que Marcelo contacte" },
      },
      required: ["razon"],
    },
  },
];

// ── Executors ──────────────────────────────────────────────────────────────
// Cada función recibe el `input` validado por Claude y el `ctx` de la sesión
// (teléfono del cliente, hooks de persistencia/notificación inyectables).

const SIMULADOR_BASE = process.env.SIMULADOR_URL || "https://activalabs.ai/simulador";

/**
 * Ejecuta una tool por nombre. Devuelve { ok, data } o { ok:false, error }.
 * Nunca lanza: los errores vuelven como tool_result con is_error para que
 * Claude los maneje conversacionalmente.
 * @param {string} name
 * @param {object} input
 * @param {object} ctx  { telefono, saveLead?, notifyMarcelo? }
 */
export async function runTool(name, input, ctx = {}) {
  try {
    switch (name) {
      case "calcular_cotizacion":
        return { ok: true, data: await calcularCotizacion(input) };

      case "calcular_por_area":
        return { ok: true, data: await calcularPorArea(input) };

      case "listar_vidrios":
        return { ok: true, data: await listarVidrios(input.tipo) };

      case "generar_link_simulador": {
        const qs = new URLSearchParams();
        if (input.tipo) qs.set("tipo", input.tipo);
        if (input.color) qs.set("color", input.color);
        const url = `${SIMULADOR_BASE}${qs.toString() ? `?${qs}` : ""}`;
        return { ok: true, data: { url } };
      }

      case "generar_link_aprobacion":
        return { ok: true, data: await generarLinkAprobacion(input.quote_id) };

      case "guardar_lead_postgres": {
        // TODO(persistencia): cablear a la BD real. Hook inyectable vía ctx.saveLead.
        const lead = { ...input, telefono: input.telefono || ctx.telefono };
        if (typeof ctx.saveLead === "function") {
          const saved = await ctx.saveLead(lead);
          return { ok: true, data: saved ?? { saved: true } };
        }
        return { ok: true, data: { saved: false, note: "stub: ctx.saveLead no provisto", lead } };
      }

      case "notificar_marcelo": {
        // TODO(handoff): cablear a la notificación real (WhatsApp a MARCELO_PHONE / inbox).
        const payload = { ...input, telefono_cliente: input.telefono_cliente || ctx.telefono };
        if (typeof ctx.notifyMarcelo === "function") {
          await ctx.notifyMarcelo(payload);
          return { ok: true, data: { escalated: true } };
        }
        return { ok: true, data: { escalated: false, note: "stub: ctx.notifyMarcelo no provisto", payload } };
      }

      default:
        return { ok: false, error: `Tool desconocida: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
