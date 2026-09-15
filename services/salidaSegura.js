// salidaSegura.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// ACTIVA / Oliver — EMBUDO ÚNICO de texto hacia el cliente.
//
// BUG QUE RESUELVE (medido en producción, conv 4d16c6ca, 14-sep-2026 22:34):
// a una clienta le llegaron 2.120 caracteres de JSON interno — el bloque crudo
// `<tool_call>{"name":"calcular_cotizacion","arguments":{…}}` más el
// `<tool_response>` con folio temporal, serie y SKU. 1 de 919 mensajes (0,1 %),
// pero expone la lógica de precios.
//
// POR QUÉ NO ALCANZABA `sanitizeForCustomer` (index.js:956): sus regex de JSON
// exigen claves acotadas (`id|product|measures|qty|color|unit_price|…`). El
// bloque filtrado usaba `name` y `arguments`, que no están en esa lista, y las
// etiquetas `<tool_call>`/`<tool_response>` no las tocaba ninguna de sus 5 reglas.
// Tampoco convertía `**negrita**` (Markdown) a `*negrita*`, que es lo único que
// WhatsApp renderiza: 35 mensajes de la misma semana mostraron los asteriscos.
//
// POR QUÉ ESTE MÓDULO Y NO UN PARCHE EN `waSend` (hallazgo de Codex, tridente
// 15-sep): hay TRES cerebros y DOS transportes. V1 manda por `index.js:waSend`,
// pero Oliver GPT sale por `src/sales-agent/whatsapp-adapter.js:132` y el piloto
// v2 por `src/sales-agent/agent.js:211`, ninguno de los cuales pasa por `waSend`.
// Sanitizar dentro de `waSend` habría dejado dos rutas abiertas. Este módulo es
// el punto único que deben llamar los tres.
//
// LO QUE NO HACE, A PROPÓSITO:
//   · NO corta por largo. El techo de transporte ya lo resuelve
//     `burbujas.js` (LIMITE_DURO_WA = 3500, con suite que prueba que no se
//     pierde texto). Duplicarlo acá sería una segunda verdad que se desincroniza.
//   · NO toca payloads de template de Meta. `_sendMetaTemplate` (index.js:1061)
//     arma `type:"template"` y nunca pasa por acá: su estructura es contrato
//     aprobado por Meta y alterarla rompe el envío.
//
// MÓDULO PURO, sin I/O, testeable. // NO TOCA: el contrato de retorno
// { texto, bloquear, motivos } lo consumen los tres cerebros.
// ═══════════════════════════════════════════════════════════════════════════

import { corregirPromesasImposibles } from './capacidadReal.js';

export const VERSION = '1.1.0';

/** Motivos posibles. Se acumulan en `motivos` para poder loguear y alertar. */
export const MOTIVO = {
  TOOL_ARTIFACT: 'tool_artifact',
  MARKDOWN: 'markdown',
  JSON_INTERNO: 'json_interno',
  URL_LARGA: 'url_larga',
  TOKEN_TECNICO: 'token_tecnico',
  PROMESA_IMPOSIBLE: 'promesa_imposible',
  VACIO: 'vacio',
  NO_ES_TEXTO: 'no_es_texto',
};

// ─── 1. Artefactos de tool-calling ──────────────────────────────────────────
// El modelo a veces emite el bloque de llamada a herramienta como texto plano en
// vez de como tool-call estructurado. Se cortan las etiquetas CON su contenido.
// El `[\s\S]*?` es no-greedy para no tragarse prosa entre dos bloques distintos.
const TOOL_TAG_CERRADA_RE = /<\s*(tool_call|tool_response|function_call|function_results?)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

// Stream cortado: se abrió la etiqueta y nunca cerró. Todo lo que sigue es basura.
const TOOL_TAG_ABIERTA_RE = /<\s*(tool_call|tool_response|function_call|function_results?)\s*>[\s\S]*$/i;

// JSON de tool-call SIN etiquetas. Se exige que `name` y `arguments` aparezcan
// como CLAVES JSON (con comillas y dos puntos), no como palabras sueltas: así
// "le mando los argumentos por correo" no se toca. Cuenta llaves para soportar
// el objeto anidado de `arguments`, que una regex plana cortaría por la mitad.
function borrarJsonToolCall(texto) {
  let out = '';
  let i = 0;
  let hubo = false;

  while (i < texto.length) {
    const abre = texto.indexOf('{', i);
    if (abre === -1) { out += texto.slice(i); break; }

    const cierre = findCierre(texto, abre);
    const bloque = cierre === -1 ? texto.slice(abre) : texto.slice(abre, cierre + 1);

    if (/"name"\s*:/.test(bloque) && /"arguments"\s*:/.test(bloque)) {
      out += texto.slice(i, abre);
      hubo = true;
      i = cierre === -1 ? texto.length : cierre + 1;
    } else {
      out += texto.slice(i, abre + 1);
      i = abre + 1;
    }
  }
  return { texto: out, hubo };
}

/** Índice de la llave que cierra la que abre en `desde`, o -1 si nunca cierra. */
function findCierre(texto, desde) {
  let nivel = 0;
  let enString = false;
  let escape = false;
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { enString = !enString; continue; }
    if (enString) continue;
    if (c === '{') nivel++;
    else if (c === '}') { nivel--; if (nivel === 0) return i; }
  }
  return -1;
}

// ─── 2. Markdown que WhatsApp NO renderiza ──────────────────────────────────
// WhatsApp usa *un* asterisco. El `**doble**` de Markdown se ve literal.
// Se exige contenido sin espacios en los bordes para no tocar "2 * 3 * 4".
const NEGRITA_DOBLE_RE = /\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g;
const NEGRITA_GUION_RE = /__(?!\s)([^_\n]+?)(?<!\s)__/g;

// ─── 3. Reglas heredadas de sanitizeForCustomer (index.js:956) ──────────────
// Se ABSORBEN acá, no se duplican: index.js delega en este módulo.
const JSON_ARRAY_ITEMS_RE = /\[\s*\{[^\[\]]*"(?:id|product|measures|qty|color|unit_price|total_price|source|confidence)"[^\[\]]*\}(?:\s*,\s*\{[^\[\]]*\})*\s*\]/gs;
const JSON_OBJ_INTERNO_RE = /\{\s*"(?:id|product|measures|unit_price|source|confidence)"[^\{\}]*\}/gs;
const URL_NUBE_RE = /https?:\/\/[^\s]*(?:sharepoint\.com|activaspacl-my\.sharepoint|dropbox|drive\.google)[^\s]*/g;
const URL_GIGANTE_RE = /https?:\/\/[^\s]{150,}/g;
const TOKEN_TECNICO_RE = /\b(?:wamid|estimate_id|deal_id|session_id)\s*[:=]\s*[A-Za-z0-9_\-]{10,}/gi;

/**
 * Limpia un texto antes de que salga hacia el cliente.
 *
 * @param {string} texto
 * @param {{destino?: 'cliente'|'interno'|'caption'}} [opts]
 *   - `cliente`  (default) — limpieza completa.
 *   - `interno`  — alertas a Marcelo: se cortan artefactos de tool-calling
 *     (ruido puro) pero se CONSERVA el diagnóstico técnico, que es el motivo
 *     por el que esa alerta existe. Sanitizar global le borraba el contenido útil.
 *   - `caption`  — pie de PDF/imagen/video: se limpia igual, pero un caption que
 *     queda vacío NO bloquea: el adjunto se manda sin pie.
 * @returns {{texto: string, bloquear: boolean, motivos: string[]}}
 *   `bloquear:true` ⇒ NO enviar. El llamador debe regenerar SOLO el texto final
 *   reusando los tool results ya obtenidos (reejecutar el turno entero volvería
 *   a cotizar, pedir folio y mandar PDF — ver src/oliver-gpt/agent.js:73,101,151),
 *   y como máximo UNA vez: un reintento sin tope convierte una fuga en un loop.
 */
export function limpiarParaCliente(texto, opts = {}) {
  const destino = opts.destino || 'cliente';
  const motivos = [];

  if (typeof texto !== 'string') {
    return { texto: '', bloquear: true, motivos: [MOTIVO.NO_ES_TEXTO] };
  }

  const original = texto;
  let out = texto;

  // 1. Artefactos de tool-calling — SIEMPRE, en todo destino.
  const antesTool = out;
  out = out.replace(TOOL_TAG_CERRADA_RE, ' ');
  out = out.replace(TOOL_TAG_ABIERTA_RE, ' ');
  const { texto: sinJson, hubo } = borrarJsonToolCall(out);
  out = sinJson;
  if (hubo || out !== antesTool) motivos.push(MOTIVO.TOOL_ARTIFACT);

  if (destino !== 'interno') {
    // 2. Markdown → formato WhatsApp.
    const antesMd = out;
    out = out.replace(NEGRITA_DOBLE_RE, '*$1*').replace(NEGRITA_GUION_RE, '*$1*');
    if (out !== antesMd) motivos.push(MOTIVO.MARKDOWN);

    // 3. Heredadas: JSON interno, URLs de nube, tokens.
    const antesJson = out;
    out = out.replace(JSON_ARRAY_ITEMS_RE, '[detalles en PDF]')
             .replace(JSON_OBJ_INTERNO_RE, '[detalles en PDF]');
    if (out !== antesJson) motivos.push(MOTIVO.JSON_INTERNO);

    const antesUrl = out;
    out = out.replace(URL_NUBE_RE, '[video disponible — se lo envío en un momento]')
             .replace(URL_GIGANTE_RE, '[link disponible — se lo paso aparte]');
    if (out !== antesUrl) motivos.push(MOTIVO.URL_LARGA);

    const antesTok = out;
    out = out.replace(TOKEN_TECNICO_RE, '');
    if (out !== antesTok) motivos.push(MOTIVO.TOKEN_TECNICO);

    // 4. [2026-09-15] Que no prometa lo que NO PUEDE hacer.
    // Caso real (Roxana, 14-sep 22:50): Oliver dijo *"le acabo de enviar la propuesta a su
    // correo"* y NO existe ninguna capacidad de enviar correos en el repo. Seis minutos
    // después: *"No llego nada pésima atención"*. El prompt ya se lo prohibía dos veces
    // (system-prompt.js:974, index.js:1577 *"vos NUNCA mandás nada a terceros"*) — y el
    // modelo lo hizo igual. Misma lección que la fuga del `<tool_call>`: si algo no puede
    // pasar, lo tiene que impedir el código, no el prompt.
    // Solo en destino `cliente`/`caption`: en las alertas internas a Marcelo no aplica.
    const _cap = corregirPromesasImposibles(out);
    if (_cap.corregido) {
      out = _cap.texto;
      motivos.push(MOTIVO.PROMESA_IMPOSIBLE);
    }
  }

  // Normalizar el espacio que dejan los recortes, sin aplastar los párrafos.
  out = out.replace(/[ \t]{2,}/g, ' ')
           .replace(/\n{3,}/g, '\n\n')
           .replace(/[ \t]+\n/g, '\n')
           .trim();

  // ¿Quedó algo que valga la pena mandar?
  const vacio = out.length === 0;
  if (vacio) motivos.push(MOTIVO.VACIO);

  // Un caption vacío no bloquea: el adjunto igual se manda, sin pie.
  const bloquear = vacio && destino !== 'caption' && original.trim().length > 0;

  return { texto: out, bloquear, motivos };
}

export default limpiarParaCliente;
