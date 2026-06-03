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

// URL base del simulador (frontend hardcodeado a proposito, sin llamada al Engine).
const SIMULADOR_BASE =
  process.env.ACTIVA_SIMULADOR_URL || 'https://activaspa.cl/simulador';

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
          ancho_mm: { type: 'number', description: 'Ancho en milimetros. Obligatorio.' },
          alto_mm: { type: 'number', description: 'Alto en milimetros. Obligatorio.' },
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

    case 'calcular_cotizacion':
      return calcularCotizacion({
        tipo: input.tipo,
        ancho_mm: input.ancho_mm,
        alto_mm: input.alto_mm,
        glass_id: input.glass_id,
        serie: input.serie,
        color: input.color,
        comuna: input.comuna,
        cantidad: input.cantidad,
      });

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
