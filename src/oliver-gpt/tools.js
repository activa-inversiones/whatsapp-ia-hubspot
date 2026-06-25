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
import { generatePremiumQuotePdf } from '../../services/quotePdf.js';
import { priceAllEngine } from '../../services/enginePricer.js'; // [2026-06-14] pricer completo de V1 (serie SLIDING+hojas+vidrio auto)

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
  let fromText = false;
  if (medidas_texto) {
    const norm = normMeasures(medidas_texto);
    if (norm && norm.ancho_mm && norm.alto_mm) {
      if (norm.ancho_mm !== a || norm.alto_mm !== b) corregido = true;
      a = norm.ancho_mm;
      b = norm.alto_mm;
      fromText = true; // el texto YA resolvió unidades (mm/cm/m) → es autoritativo, no re-escalar
    }
  }
  // [FIX 2026-06-18] Rescate cm en el path NUMÉRICO (LLM pasó ancho_mm/alto_mm sin texto).
  // Una ventana fabricable mide ≥400 mm (mín. S60 400 / SLIDING 500). Si el número quedó en
  // [150,400) casi seguro venía en CENTÍMETROS sin convertir (caso real: 3,15×2,40 m → el
  // cerebro mandó 315×240 → cotizó 0,08 m² → $301k en vez de $948k). ×10 es la única lectura
  // física válida. <150 se deja caer al guard de rango (pide confirmar, no adivina).
  if (!fromText) {
    const rescatarCm = (v) =>
      (Number.isFinite(v) && v >= 150 && v < 400 && v * 10 <= MEDIDA_MAX_MM) ? v * 10 : v;
    const na = rescatarCm(a), nb = rescatarCm(b);
    if (na !== a || nb !== b) corregido = true;
    a = na; b = nb;
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
        'listar_vidrios y pasa su glass_id. Nunca pongas tipo:"TERMOPANEL". ' +
        'DEVUELVE el campo "unit_price" (precio unitario NETO, sin IVA): es EXACTAMENTE el ' +
        'valor que debes pasar como unit_price a generar_pdf_cotizacion. NO uses total_con_iva ' +
        'ni precio_por_m2. EL VIDRIO Y LA SERIE SE ELIGEN SOLOS (por tamaño y ambiente) — NO ' +
        'pases glass_id ni serie; NO uses listar_vidrios. Solo manda tipo + medidas_texto + (si es baño) ambiente.',
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
            description: 'IGNORADO — el vidrio se elige AUTOMÁTICAMENTE por tamaño/ambiente. No lo pases.',
          },
          serie: {
            type: 'string',
            description: 'IGNORADO — la serie se elige AUTOMÁTICAMENTE. No la pases.',
          },
          color: { type: 'string', description: 'Color del perfil. Opcional.' },
          comuna: { type: 'string', description: 'Comuna de despacho/instalacion. Opcional.' },
          cantidad: { type: 'integer', description: 'Cantidad de ventanas. Opcional.' },
          ambiente: { type: 'string', description: 'Recinto de la ventana (ej. "baño", "living"). Opcional pero ÚTIL: si es baño se usa vidrio satén automáticamente.' },
        },
        required: ['tipo', 'medidas_texto'],
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
          cantidad: { type: 'integer', description: 'Cantidad de ventanas iguales. Opcional, default 1.' },
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
  // ── generar_pdf_cotizacion ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'generar_pdf_cotizacion',
      description:
        'Genera el PDF de cotización OFICIAL (ISO CM-FR-004) y lo envía al cliente por WhatsApp. ' +
        'Invocar SOLO cuando ya se calculó la cotización con calcular_cotizacion (los precios deben ' +
        'venir del motor, nunca inventados). Registra el Deal/Note en Zoho CRM y dispara la ' +
        'conversión «cotizacion» al canal de origen del lead (Meta/Google/TikTok).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del cliente.' },
          phone: { type: 'string', description: 'Teléfono del cliente (se usa el waId si se omite).' },
          comuna: { type: 'string', description: 'Comuna del cliente.' },
          items: {
            type: 'array',
            description:
              'Lista de ítems cotizados. Cada ítem DEBE incluir unit_price tal cual lo devolvió ' +
              'calcular_cotizacion (NO inventar precios). ' +
              'Campos: producto_label, measures, color, qty, unit_price, glass_label, ambiente.',
            items: {
              type: 'object',
              properties: {
                producto_label: { type: 'string' },
                measures:       { type: 'string', description: 'Ej: "1500x1200 mm"' },
                color:          { type: 'string' },
                qty:            { type: 'integer' },
                unit_price:     { type: 'number', description: 'Precio unitario NETO en CLP (sin IVA). DEBE ser el campo "unit_price" que devolvió calcular_cotizacion, copiado tal cual. El PDF agrega el 19% de IVA. NUNCA total_con_iva ni precio_por_m2.' },
                glass_label:    { type: 'string', description: 'Ej: "Termopanel DVH"' },
                ambiente:       { type: 'string', description: 'Ej: "Dormitorio". Opcional.' },
              },
              required: ['producto_label', 'measures', 'qty', 'unit_price'],
            },
          },
          grand_total: { type: 'number', description: 'Total calculado en CLP (suma de unit_price * qty). Debe venir de calcular_cotizacion.' },
          descuento_pct: { type: 'number', description: 'Descuento al cliente en % (ej. 10 = 10% off). Opcional (default 0). SOLO si el dueño autoriza un descuento. Se muestra como línea "Descuento" en el PDF y se recalcula el total con IVA.' },
        },
        required: ['items'],
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
 * [2026-06-13] Normaliza la respuesta del motor a un unit_price DETERMINISTA (NETO).
 * El motor devuelve varios campos de precio (total_clp neto, total_con_iva, precio_por_m2,
 * subtotal). El PDF (services/quotePdf.js) AGREGA 19% IVA sobre la suma de unit_price, así
 * que unit_price DEBE ser NETO (total_clp), igual que enginePricer.js (V1). Antes el LLM
 * elegía el campo a ojo → riesgo de DOBLE IVA (~19% de más) o precio/m². Esto lo elimina:
 * el LLM recibe un unit_price ya resuelto y solo lo copia a generar_pdf_cotizacion.
 * @param {object} r - Respuesta cruda del motor.
 * @param {number} [cantidad=1] - Cantidad cotizada (total_clp es el total de línea).
 * @returns {object} r + { unit_price, total_neto } o { ok:false, precio_invalido } si el total no sirve.
 */
export function conUnitPrice(r, cantidad = 1) {
  if (!r || r.ok === false) return r;
  const qty = Math.max(1, Number(cantidad) || 1);
  // [FIX 2026-06-19 COB-02] saco total_con_iva del fallback: si el motor solo devuelve con IVA, usarlo como neto + 19% del PDF = doble IVA (~19% de más). Mejor escalar.
  const lineTotal = Number(r.total_clp ?? r.total_neto_clp ?? 0);
  if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
    return { ...r, ok: false, precio_invalido: true,
      error: r.error || 'Total inválido del motor; requiere revisión de especialista (no cotizar a ciegas).' };
  }
  const unit_price = Math.round(lineTotal / qty);
  return { ...r, unit_price, total_neto: lineTotal,
    _nota_precio: 'unit_price es NETO (sin IVA). Pásalo TAL CUAL a generar_pdf_cotizacion; el PDF agrega el 19% de IVA. NO uses total_con_iva ni precio_por_m2.' };
}

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
      // [2026-06-14 FIX RAÍZ] Cotizar vía priceAllEngine (pricer COMPLETO de V1): arma la
      // llamada CORRECTA al motor — serie SLIDING + hojas + vidrio por área/ambiente + clamp
      // de medidas. ANTES el cerebro mandaba la llamada incompleta (sin serie) → el motor
      // cotizaba "Corredera S60" a MITAD de precio ($184k vs $352k correcto). El LLM ya NO
      // elige vidrio ni serie: lo decide el código battle-tested de V1.
      // Guard de medidas del cerebro INTACTO (cm/mm determinista + rechaza absurdas/fuera de rango).
      const med = resolverMedidasMm(input);
      if (!med.ok) return med; // medidas fuera de rango → el LLM pide confirmación, no cotiza
      const qty = Math.max(1, Number(input.cantidad) || 1);
      const d = {
        items: [{ measures: `${med.ancho_mm}x${med.alto_mm}`, product: input.tipo, qty, color: input.color || '', ambiente: input.ambiente || '' }],
        comuna: input.comuna || '',
        default_color: input.color || '',
      };
      const r = await priceAllEngine(d);
      const it = d.items[0] || {};
      if (!r.ok || !(Number(it.unit_price) > 0)) {
        return { ok: false, precio_invalido: true, requiere_revision: true,
          error: it.price_warning || r.error || 'No se pudo cotizar; lo revisa un especialista.' };
      }
      return {
        ok: true,
        unit_price: it.unit_price,            // NETO (sin IVA) — camino V1
        total_neto: it.total_price,
        cantidad: it.qty || qty,
        glass_label: it.glass_label,
        producto_label: it.producto_label,
        serie: it.serie,
        referencial: it.referencial || false,
        termico: it.termico || null,          // [thermal] hoja Uw para el PDF (null = no mostrar)
        _nota_precio: 'unit_price es NETO (sin IVA). Pásalo TAL CUAL a generar_pdf_cotizacion; el PDF agrega el 19% de IVA. NO uses otro campo.',
      };
    }

    case 'calcular_por_area': {
      // [2026-06-14 FIX] Mismo criterio que calcular_cotizacion. El endpoint by-area del
      // motor cotiza con serie S60 (llamada incompleta, sin serie) → SUB-cotiza ~40%
      // (VERIFICADO en vivo: corredera 1.5m² da $207k vs $352k correcto). Por eso usamos
      // calcularPorArea SOLO para DERIVAR ancho×alto desde area+proporcion, y el PRECIO
      // sale de priceAllEngine (serie SLIDING + hojas + vidrio auto). El LLM no elige vidrio/serie.
      let _ra;
      try {
        _ra = await calcularPorArea({
          tipo: input.tipo,
          area_m2: input.area_m2,
          glass_id: input.glass_id || 34, // vidrio dummy permitido: solo derivamos medidas; el precio se recalcula con priceAllEngine
          proporcion: input.proporcion,
          color: input.color,
          comuna: input.comuna,
        });
      } catch (e) {
        return { ok: false, precio_invalido: true, requiere_revision: true,
          error: (e && e.message) || 'No se pudo derivar medidas por área; lo revisa un especialista.' };
      }
      const dims = _ra?.derived_dimensions || {};
      const ancho = Number(dims.ancho_mm), alto = Number(dims.alto_mm);
      if (!_ra?.ok || !(ancho > 0) || !(alto > 0)) {
        return { ok: false, precio_invalido: true, requiere_revision: true,
          error: _ra?.error || 'No se pudo derivar medidas por área; lo revisa un especialista.' };
      }
      const qtyArea = Math.max(1, Number(input.cantidad) || 1);   // [FIX 2026-06-19 COB-05] antes qty:1 fijo → cobraba 1/3 si pedían 3 iguales
      const d = {
        items: [{ measures: `${ancho}x${alto}`, product: input.tipo, qty: qtyArea, color: input.color || '', ambiente: input.ambiente || '' }],
        comuna: input.comuna || '',
        default_color: input.color || '',
      };
      const r = await priceAllEngine(d);
      const it = d.items[0] || {};
      if (!r.ok || !(Number(it.unit_price) > 0)) {
        return { ok: false, precio_invalido: true, requiere_revision: true,
          error: it.price_warning || r.error || 'No se pudo cotizar; lo revisa un especialista.' };
      }
      return {
        ok: true,
        unit_price: it.unit_price,            // NETO (sin IVA) — camino V1, idéntico a calcular_cotizacion
        total_neto: it.total_price,
        cantidad: it.qty || qtyArea,
        area_m2: Number(input.area_m2) || _ra.area_m2,
        medidas_derivadas: `${ancho}x${alto}`,
        glass_label: it.glass_label,
        producto_label: it.producto_label,
        serie: it.serie,
        referencial: it.referencial || false,
        _nota_precio: 'unit_price es NETO (sin IVA). Pásalo TAL CUAL a generar_pdf_cotizacion; el PDF agrega el 19% de IVA. NO uses precio_por_m2 ni otro campo.',
      };
    }

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

    case 'generar_pdf_cotizacion': {
      // ctx.generarPdf es inyectado por webhook.js (los 6 pasos: correlativo ISO,
      // PDF premium, envío WA, CRM, WorkDrive inerte, conversión multicanal).
      if (typeof ctx.generarPdf !== 'function') {
        console.warn('[tools] generar_pdf_cotizacion: ctx.generarPdf no cableado (simulador/test?)');
        return { ok: false, reason: 'generarPdf_not_wired' };
      }
      // CRÍTICO: los unit_price de los items deben venir del motor (calcular_cotizacion),
      // nunca inventados por el LLM. El webhook.js pasa el name/phone/comuna desde el state
      // si el LLM no los pasó explícitamente.
      return ctx.generarPdf(input);
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
