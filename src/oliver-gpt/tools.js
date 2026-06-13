// tools.js — Definiciones de tools (formato OpenAI) y dispatcher para Oliver GPT.
//
// FIX TERMOPANEL (plan 2.4): el parametro 'tipo' de calcular_cotizacion y
// calcular_por_area es la APERTURA de la ventana, un enum cerrado SIN TERMOPANEL.
// El termopanel es una familia de vidrio que se selecciona con glass_id; para
// listarlo se usa listar_vidrios (donde 'tipo' SI es familia de vidrio).

import {
  calcularCotizacion,
  calcularPorArea,
  listarVidrios,
  generarLinkAprobacion,
  APERTURAS,
  FAMILIAS_VIDRIO,
} from './engine-client.js';
import { normMeasures } from './normalizers.js';
import {
  sendWhatsAppImageUrl,
  sendWhatsAppVideoUrl,
  sendWhatsAppDocumentUrl,
} from '../sales-agent/whatsapp-adapter.js';

// Rango plausible de una ventana/puerta en mm. Fuera de esto = dato dudoso (no cotizar a ciegas).
const MEDIDA_MIN_MM = 150;
const MEDIDA_MAX_MM = 6000;

/**
 * Resuelve las medidas finales en mm para cotizar, de forma DETERMINISTA.
 * - Si hay medidas_texto (lo que escribió el cliente), normMeasures (heurística mm/cm/m)
 *   MANDA sobre la conversión del LLM, que tiende a manglear (auditoría real).
 * - Aplica guard de rango: fuera de [150, 6000] mm → no cotizar, pedir confirmación.
 * @returns {{ ok: true, ancho_mm, alto_mm, corregido: boolean } | { ok: false, error, message, ancho_mm, alto_mm }}
 */
export function resolverMedidasMm({ ancho_mm, alto_mm, medidas_texto } = {}) {
  let a = Number(ancho_mm);
  let b = Number(alto_mm);
  let corregido = false;
  if (medidas_texto) {
    const norm = normMeasures(medidas_texto);
    if (norm && norm.ancho_mm && norm.alto_mm) {
      if (norm.ancho_mm !== a || norm.alto_mm !== b) corregido = true;
      a = norm.ancho_mm;
      b = norm.alto_mm;
    }
  }
  const enRango = (v) => Number.isFinite(v) && v >= MEDIDA_MIN_MM && v <= MEDIDA_MAX_MM;
  if (!enRango(a) || !enRango(b)) {
    return {
      ok: false,
      error: 'medidas_fuera_de_rango',
      ancho_mm: a,
      alto_mm: b,
      message:
        `Las medidas ${a}×${b} mm están fuera del rango plausible (${MEDIDA_MIN_MM}–${MEDIDA_MAX_MM} mm). ` +
        `NO cotices: pídele al cliente que confirme las medidas y la unidad (¿centímetros o milímetros?).`,
    };
  }
  return { ok: true, ancho_mm: a, alto_mm: b, corregido };
}

// URL base del simulador (frontend hardcodeado a proposito, sin llamada al Engine).
const SIMULADOR_BASE =
  process.env.ACTIVA_SIMULADOR_URL || 'https://activaspa.cl/simulador';

/**
 * Resuelve la URL del catálogo/media a partir de una catalog_key.
 * Espeja resolveCatalogUrl de index.js ~L3497.
 * Retorna null si la env var no está configurada (no lanza).
 */
function resolveCatalogUrl(key) {
  const map = {
    catalogo_pvc: process.env.CATALOGO_PVC_URL,
    catalogo_colores: process.env.CATALOGO_COLORES_URL,
    ficha_tecnica_s60: process.env.FICHA_S60_URL,
    ficha_tecnica_sliding: process.env.FICHA_SLIDING_URL,
    video_planta: process.env.VIDEO_PLANTA,
    video_oficina: process.env.VIDEO_OFICINA,
    video_instalaciones: process.env.VIDEO_INSTALACIONES,
    foto_proyecto_1: process.env.FOTO_PROYECTO_1_URL,
    foto_proyecto_2: process.env.FOTO_PROYECTO_2_URL,
    certificacion_tse: process.env.CERTIFICACION_TSE_URL,
  };
  return map[key] || null;
}

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'listar_vidrios',
      description:
        'Lista los vidrios disponibles por familia. Devuelve cada vidrio con su id ' +
        '(que es el glass_id que se usa al cotizar), code, price_m2_clp e is_termopanel. ' +
        "Aqui 'tipo' SI es la familia de vidrio (TERMOPANEL o MONOLITICO). " +
        'Use esta tool ANTES de cotizar para obtener el glass_id del vidrio que el cliente quiere.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: [...FAMILIAS_VIDRIO],
            description:
              'Familia de vidrio a listar. TERMOPANEL = doble vidriado hermetico; ' +
              'MONOLITICO = vidrio simple. Opcional: si se omite, lista todos.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular_cotizacion',
      description:
        'Calcula el precio de una ventana puntual. IMPORTANTE: el campo "tipo" es la ' +
        'APERTURA de la ventana (corredera, proyectante, fija, batiente, oscilobatiente), ' +
        'NO el tipo de vidrio. El termopanel es un vidrio: para usarlo, primero llama ' +
        'listar_vidrios y pasa su glass_id. Nunca pongas tipo:"TERMOPANEL".',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: [...APERTURAS], // enum cerrado SIN TERMOPANEL
            description:
              'Apertura de la ventana. Uno de: CORREDERA, PROYECTANTE, FIJA, BATIENTE, ' +
              'OSCILOBATIENTE. NUNCA TERMOPANEL (eso es un vidrio, va por glass_id).',
          },
          ancho_mm: { type: 'number', description: 'Ancho en milimetros (tu mejor estimación). El sistema RE-CONVIERTE desde medidas_texto si lo incluyes, así que prioriza enviar medidas_texto.' },
          alto_mm: { type: 'number', description: 'Alto en milimetros (tu mejor estimación). El sistema RE-CONVIERTE desde medidas_texto si lo incluyes.' },
          medidas_texto: {
            type: 'string',
            description:
              'EL TEXTO LITERAL que el cliente escribió sobre las medidas, con su unidad si la dio. ' +
              'Ej: "140x220 cm", "1,5 x 1,2 metros", "70 x 30", "1500x1200 mm". ' +
              'INCLÚYELO SIEMPRE: el sistema lo convierte a milímetros de forma determinista (NO confíes en tu propia conversión). ' +
              'No inventes números: copia lo que dijo el cliente.',
          },
          glass_id: {
            type: 'integer',
            description:
              'Id del vidrio (obtenido de listar_vidrios). Obligatorio. ' +
              'Para termopanel, use el glass_id de un vidrio con is_termopanel=true.',
          },
          serie: {
            type: 'string',
            description: 'Serie del perfil, p. ej. S60 o SLIDING. Opcional.',
          },
          color: { type: 'string', description: 'Color del perfil. Opcional.' },
          comuna: { type: 'string', description: 'Comuna de despacho/instalacion. Opcional.' },
          cantidad: { type: 'integer', description: 'Cantidad de ventanas. Opcional.' },
        },
        required: ['tipo', 'ancho_mm', 'alto_mm', 'glass_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calcular_por_area',
      description:
        'Calcula el precio a partir del area total en metros cuadrados. El campo "tipo" ' +
        'es la APERTURA (no el vidrio) y glass_id es obligatorio. El area va en "area_m2".',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: [...APERTURAS], // mismo enum de apertura, SIN TERMOPANEL
            description:
              'Apertura de la ventana. Uno de: CORREDERA, PROYECTANTE, FIJA, BATIENTE, ' +
              'OSCILOBATIENTE. NUNCA TERMOPANEL.',
          },
          area_m2: {
            type: 'number',
            description: 'Area total en metros cuadrados. Obligatorio.',
          },
          glass_id: {
            type: 'integer',
            description: 'Id del vidrio (de listar_vidrios). Obligatorio.',
          },
          proporcion: {
            type: 'string',
            description: 'Proporcion ancho:alto deseada, p. ej. "1.5:1". Opcional.',
          },
          color: { type: 'string', description: 'Color del perfil. Opcional.' },
          comuna: { type: 'string', description: 'Comuna de despacho/instalacion. Opcional.' },
        },
        required: ['tipo', 'area_m2', 'glass_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generar_link_simulador',
      description:
        'Genera un link al simulador web para que el cliente visualice su ventana. ' +
        'No llama al Engine; arma una URL con los parametros dados.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: [...APERTURAS],
            description: 'Apertura de la ventana (no el vidrio).',
          },
          color: { type: 'string', description: 'Color del perfil.' },
          ancho_mm: { type: 'number', description: 'Ancho en milimetros.' },
          alto_mm: { type: 'number', description: 'Alto en milimetros.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generar_link_aprobacion',
      description:
        'Genera el link de aprobacion del cliente para una cotizacion ya calculada. ' +
        'Requiere el quote_id y el quote_payload completo devuelto por calcular_cotizacion.',
      parameters: {
        type: 'object',
        properties: {
          quote_id: {
            type: 'string',
            description: 'Id de la cotizacion a compartir. Obligatorio.',
          },
          quote_payload: {
            type: 'object',
            description:
              'Output completo de calcular_cotizacion (se envia en el body). Obligatorio.',
          },
        },
        required: ['quote_id', 'quote_payload'],
        additionalProperties: true,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notificar_marcelo',
      description:
        'Escala la conversación actual al dueño (Marcelo). ' +
        'Úsala cuando el cliente muestre señales de alto valor, urgencia real, ' +
        'o pida hablar con una persona. ' +
        'Solo invocarla cuando tengas evidencia clara; no spamear. ' +
        'La plataforma aplica un cooldown de 2 horas por cliente para evitar duplicados.',
      parameters: {
        type: 'object',
        properties: {
          motivo: {
            type: 'string',
            description:
              'Razón breve de la escalación (ej: "cliente pide hablar con humano", ' +
              '"proyecto grande: 20 ventanas"). Obligatorio.',
          },
          resumen_lead: {
            type: 'string',
            description:
              'Resumen corto del lead: nombre, comuna, lo que necesita, ' +
              'monto aproximado si se sabe. Opcional pero recomendado.',
          },
          telefono_cliente: {
            type: 'string',
            description:
              'Teléfono del cliente (con código de país, ej: 56912345678). ' +
              'Si no lo sabes, déjalo vacío; el sistema usa el número de la conversación.',
          },
          nombre: {
            type: 'string',
            description: 'Nombre del cliente si ya se lo preguntaste. Opcional.',
          },
        },
        required: ['motivo'],
        additionalProperties: false,
      },
    },
  },
  // ── send_media ────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'send_media',
      description:
        'Envía una imagen, video o documento al cliente vía WhatsApp. ' +
        'Usar cuando el cliente pida: ver catálogo, fotos de ventanas, videos de la planta, ' +
        'video de instalación, ficha técnica, folleto, o cuando quieras mostrarle visualmente un producto.',
      parameters: {
        type: 'object',
        properties: {
          media_type: {
            type: 'string',
            enum: ['image', 'video', 'document'],
            description: 'Tipo de archivo a enviar.',
          },
          catalog_key: {
            type: 'string',
            enum: [
              'catalogo_pvc',
              'catalogo_colores',
              'ficha_tecnica_s60',
              'ficha_tecnica_sliding',
              'video_planta',
              'video_oficina',
              'video_instalaciones',
              'foto_proyecto_1',
              'foto_proyecto_2',
              'certificacion_tse',
            ],
            description:
              'Clave del catálogo/media predefinido. Se resuelve desde env vars en el servidor.',
          },
          caption: {
            type: 'string',
            description: 'Mensaje que acompaña al archivo (máx 200 chars). Opcional.',
          },
        },
        required: ['media_type', 'catalog_key'],
        additionalProperties: false,
      },
    },
  },
  // ── guardar_lead ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'guardar_lead',
      description:
        'Registra el lead calificado (nombre, comuna, lo que necesita, monto estimado). ' +
        'Ejecutar cuando ya se tienen los datos mínimos del cliente y se ha enviado o está ' +
        'por enviarse la propuesta. Persiste en el CRM/BD de la plataforma.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Nombre del cliente (si se conoce).',
          },
          comuna: {
            type: 'string',
            description: 'Comuna del cliente (si se conoce).',
          },
          items: {
            type: 'array',
            description: 'Productos cotizados (si se calcularon). Opcional.',
            items: { type: 'object' },
          },
          grand_total: {
            type: 'number',
            description: 'Monto total estimado en CLP (si se calculó). Opcional.',
          },
          stageKey: {
            type: 'string',
            description: 'Etapa del lead (p.ej. \'cotizado\', \'interesado\'). Opcional.',
          },
        },
        required: [],
        additionalProperties: true,
      },
    },
  },
];

/**
 * Ejecuta una tool por nombre contra el engine-client.
 * @param {string} name - Nombre de la tool (debe estar en TOOL_DEFS).
 * @param {object} input - Argumentos de la tool.
 * @param {object} [ctx] - Contexto opcional (sesion, waId, etc.).
 * @returns {Promise<any>}
 */
export async function runTool(name, input = {}, ctx = {}) {
  switch (name) {
    case 'listar_vidrios':
      return listarVidrios(input.tipo);

    case 'calcular_cotizacion': {
      const med = resolverMedidasMm(input);
      if (!med.ok) return med; // medidas fuera de rango → el LLM pide confirmación, no cotiza
      if (med.corregido) {
        console.warn(`[tools] medidas corregidas por normMeasures desde "${input.medidas_texto}" → ${med.ancho_mm}x${med.alto_mm} (LLM había pasado ${input.ancho_mm}x${input.alto_mm})`);
      }
      return calcularCotizacion({
        tipo: input.tipo,
        ancho_mm: med.ancho_mm,
        alto_mm: med.alto_mm,
        glass_id: input.glass_id,
        serie: input.serie,
        color: input.color,
        comuna: input.comuna,
        cantidad: input.cantidad,
      });
    }

    case 'calcular_por_area':
      return calcularPorArea({
        tipo: input.tipo,
        area_m2: input.area_m2,
        glass_id: input.glass_id,
        proporcion: input.proporcion,
        color: input.color,
        comuna: input.comuna,
      });

    case 'generar_link_simulador':
      return generarLinkSimulador(input);

    case 'generar_link_aprobacion':
      return generarLinkAprobacion(input.quote_id, input.quote_payload);

    case 'notificar_marcelo': {
      // ctx.notifyMarcelo es inyectado por webhook.js (apunta a highValueNotifier.notifyHighValue
      // con el telefono real del cliente como customerPhone).
      // Si no hay notifyMarcelo (ej: simulador local) devolvemos un ok:false silencioso.
      if (typeof ctx.notifyMarcelo !== 'function') {
        console.warn('[tools] notificar_marcelo: ctx.notifyMarcelo no cableado (simulador/test?)');
        return { ok: false, reason: 'notifyMarcelo_not_wired' };
      }
      // La razón empieza con 'oliver_gpt:' para que highValueNotifier
      // NO la bloquee por filtro de tier STANDARD (el filtro solo aplica a reason==='auto').
      const reason = `oliver_gpt:${(input.motivo || 'escalacion').substring(0, 80)}`;
      const result = await ctx.notifyMarcelo({
        reason,
        data: {
          name: input.nombre || '',
          resumen: input.resumen_lead || '',
          // telefono_cliente es informativo para el mensaje; el numero real
          // del cliente ya lo tiene ctx.notifyMarcelo vía webhook.js (from).
          telefono_llm: input.telefono_cliente || '',
        },
      });
      return { ok: true, enviado: result?.sent ?? false, tier: result?.tier, reason };
    }

    case 'send_media': {
      // ctx.sendMedia es inyectado por webhook.js (to, mediaType, catalogKey, caption).
      // Si no está cableado (test local sin ctx) devolvemos ok:false silencioso.
      if (typeof ctx.sendMedia !== 'function') {
        console.warn('[tools] send_media: ctx.sendMedia no cableado (simulador/test?)');
        return { ok: false, reason: 'sendMedia_not_wired' };
      }
      // safe() de webhook.js puede devolver null si traga una excepción → normalizamos a ok:false
      // para que el LLM reciba un objeto, no null literal (ajuste del abogado del diablo).
      const _rMedia = await ctx.sendMedia({
        media_type: input.media_type,
        catalog_key: input.catalog_key,
        caption: input.caption || '',
      });
      return _rMedia ?? { ok: false, error: 'sendMedia_null' };
    }

    case 'guardar_lead': {
      // ctx.saveLead es inyectado por webhook.js ~L330-343 (pushLeadEvent real).
      if (typeof ctx.saveLead !== 'function') {
        console.warn('[tools] guardar_lead: ctx.saveLead no cableado (simulador/test?)');
        return { ok: false, reason: 'saveLead_not_wired' };
      }
      return ctx.saveLead(input);
    }

    default:
      throw new Error(`Tool desconocida: '${name}'.`);
  }
}

// Helper local: arma la URL del simulador (sin llamada al Engine).
function generarLinkSimulador({ tipo, color, ancho_mm, alto_mm } = {}) {
  const params = new URLSearchParams();
  if (tipo !== undefined && tipo !== null && tipo !== '') params.set('tipo', String(tipo).toUpperCase());
  if (color !== undefined && color !== null && color !== '') params.set('color', String(color));
  if (ancho_mm !== undefined && ancho_mm !== null) params.set('ancho_mm', String(ancho_mm));
  if (alto_mm !== undefined && alto_mm !== null) params.set('alto_mm', String(alto_mm));
  const qs = params.toString();
  const url = qs ? `${SIMULADOR_BASE}?${qs}` : SIMULADOR_BASE;
  return { ok: true, url };
}

export { generarLinkSimulador };
