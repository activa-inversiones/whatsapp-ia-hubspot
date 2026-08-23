// services/informeTermico.js — v1.0.0
// ═══════════════════════════════════════════════════════════════════════════
// EL INFORME TÉRMICO DE LA COMUNA — lo que se le manda al cliente ANTES de cotizar.
//
// IDEA DEL DUEÑO (2026-08-21), textual: *"el informe quedó para envío aparte de la
// cotización"* · *"en algún punto para que lo lea mientras le decimos preparamos la
// propuesta"* · *"de la misma información capturada del cliente hacemos el informe
// primero y después le enviamos el otro con la cotización"*.
//
// POR QUÉ FUNCIONA: llena el tiempo muerto entre "déjeme calcular" y el PDF, y cuando
// el precio llega ya no llega solo — llega después de que el cliente leyó qué le exige
// la norma en SU comuna. Nadie más en Temuco manda eso.
//
// 🔑 NO PIDE NI UN DATO NUEVO. Se arma solo con la comuna, que Oliver ya captura en el
// 84,7 % de las cotizaciones (416 de 491 medidas el 21-ago). Al 15,3 % restante se le manda
// Temuco como referencia regional, ANUNCIADO como tal (ver COMUNA_REFERENCIA abajo).
// En ningún caso se pregunta un dato extra: la regla del dueño fue explícita.
//
// 🔴 EL BUG QUE ESTE MÓDULO EXISTE PARA TAPAR: la API de THERMAL **rechaza toda comuna
// con tilde**. Medido contra producción el 21-ago:
//     Vilcun OK / Vilcún FALLA · Pucon OK / Pucón FALLA · Pitrufquen OK / Pitrufquén FALLA
//     Curacautin OK / Curacautín FALLA · Traiguen OK / Traiguén FALLA
// Son 70 cotizaciones en 45 días. El cliente escribe "Pucón" —con tilde, como se escribe—
// y la API responde "no está en el registro oficial". Se normaliza ACÁ, del lado que
// llama, porque THERMAL es un proveedor externo y no se toca (regla: se le pide, no se
// incorpora).
//
// COSTO: CERO tokens. Es física determinista sobre nuestro propio Railway, no un LLM.
//
// Módulo PURO con deps inyectables (igual que candadoSeguimiento.js / reporteCosto.js):
// se testea sin red.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = '1.1.0';

// [2026-08-21] LA FIRMA. Pedido del dueño: que se vea "muy formal pero a la vez cercano",
// preparado por el especialista y no por un bot.
//
// ⚠️ EL TÍTULO ES EL REAL Y VERIFICABLE, no uno inventado. El dueño lo pidió como
// "consultor externo del MINVU"; eso insinuaría que trabaja PARA el ministerio, que es otra
// cosa y expone al cliente si lo repite mal. Lo que SÍ es cierto y ya está documentado en
// el system-prompt (líneas 55, 82, 483) es: **Evaluador Energético Externo ACREDITADO POR
// el MINVU, Resolución 266/2025 del Diario Oficial**. Es más fuerte, porque trae número de
// resolución que el cliente puede buscar. Acreditado POR el MINVU ≠ consultor DEL MINVU.
const FIRMA = {
  nombre: 'Ing. Marcelo Cifuentes Méndez',
  cargo: 'Evaluador Energético Externo acreditado MINVU',
  resolucion: 'Res. 266/2025, Diario Oficial',
};

// [2026-08-21] DOS TIEMPOS, no uno. Corrección del dueño: *"no olvidar que hay que ser más
// humano, no puede ser inmediato — el informe debe verse real"*.
//
// Un informe técnico que aparece 6 segundos después de pedir el precio se lee como un
// autoresponder, y eso ANULA todo el trabajo de que parezca preparado por un profesional.
// Nadie redacta un informe con citas normativas en seis segundos.
//
// El ritmo queda así:
//   1. AVISO (~4 s): "déjeme revisar la norma de su comuna". Explica la espera, que es lo
//      que hace tolerable esperar. Un silencio sin explicación se lee como que se colgó.
//   2. ELABORACIÓN (~35 s): el tiempo en que un humano estaría armándolo. Durante ese rato
//      se mantienen los puntitos de "escribiendo…" en WhatsApp, así el cliente VE que hay
//      alguien trabajando en vez de mirar una pantalla muerta.
//   3. El PDF.
// Los dos son ajustables por env; el tope duro de 90 s existe para que un valor mal escrito
// no deje a un cliente esperando eternamente.
const DEMORA_AVISO_MS = Number(process.env.INFORME_AVISO_MS || 4000);
const DEMORA_MS = Number(process.env.INFORME_DEMORA_MS || 35000);

const BASE_URL = () =>
  (process.env.THERMAL_API_URL || 'https://activa-thermal-production.up.railway.app')
    .trim().replace(/\/+$/, '');

const TIMEOUT_MS = Number(process.env.THERMAL_TIMEOUT_MS || 4000);

/**
 * Quita tildes y normaliza para que THERMAL la reconozca.
 * NO se toca la ñ: "Ñuñoa" existe como tal en el registro oficial.
 */
export function normalizarComuna(comuna) {
  const s = String(comuna || '').trim();
  if (!s) return '';
  return s
    .normalize('NFD')
    // Solo los diacríticos de las vocales acentuadas. ̃ (tilde de la ñ) se preserva
    // a propósito: sacarlo convertiría "Ñuñoa" en "Nunoa", que TAMPOCO está en el registro.
    .replace(/[̀́̂̈]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

/**
 * Pide el informe térmico de una comuna. NUNCA lanza: o devuelve datos o null.
 * @returns {Promise<object|null>}
 */
export async function pedirInformeComuna(comuna, { fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS, baseUrl = null } = {}) {
  const norm = normalizarComuna(comuna);
  if (!norm) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${baseUrl || BASE_URL()}/api/v1/exigencia?comuna=${encodeURIComponent(norm)}`;
    const r = await fetchFn(url, { signal: ctrl.signal });
    if (!r || r.ok === false) return null;          // 404 = comuna fuera del registro: sin informe
    const j = await r.json();
    return j && j.comuna ? j : null;
  } catch {
    // Filosofía anti-alucinación del proyecto: si no hay dato verificado, no hay informe.
    // Jamás se rellena con un número inventado — es una cita normativa, no una estimación.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Arma el mensaje de WhatsApp. Devuelve null si no hay nada REAL que decir.
 *
 * Por qué mensaje y no PDF: el PDF lo abre uno de cada tres; esto tiene que leerlo
 * mientras espera. El PDF formal va después, con la propuesta.
 */
// En Chile el separador decimal es COMA. "3.2 W/m²K" en un informe que cita un decreto
// se lee como traduccion automatica y le baja la credibilidad justo donde hay que tenerla.
const dec = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');
// [2026-08-21 · revision cruzada de Codex] Un numero que no es finito NO se imprime.
// Reproducido: con `clima: {}` el mensaje salia "*NaN °C* con *NaN %* de humedad exterior"
// — en un texto que cita un decreto. Es exactamente lo que la regla anti-alucinacion del
// proyecto prohibe: si el dato no esta, no se dice; jamas se rellena.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function armarMensaje(datos, { nombre = '', esReferenciaRegional = false } = {}) {
  if (!datos || !datos.comuna) return null;

  const trato = nombre ? `, ${String(nombre).trim().split(/\s+/)[0]}` : '';
  const cond = datos.condensacion;
  const lineas = [];
  // [2026-08-21 · Codex] Se cuentan los BLOQUES con dato duro, no `lineas.length`.
  // El bloque PDA empuja exactamente 3 elementos, asi que el viejo `lineas.length <= 3`
  // descartaba un informe con tope de Uw VERIFICADO solo porque faltaba la condensacion.
  let bloquesConDato = 0;

  // 1) La exigencia. Solo se afirma "por decreto" cuando REALMENTE hay un tope por elemento
  //    Y sabemos que el cliente está en esa comuna. Si es la referencia regional, se dice.
  if (esReferenciaRegional) {
    lineas.push(
      `Le cuento algo mientras termino su propuesta${trato}.`,
      '',
      `Le preparé un informe corto de la región para que sepa contra qué se compara su ventana.`,
      '',
      `Tomo *${datos.comuna}* como referencia (es la capital regional) — cuando me confirme su ` +
      `comuna le afino los números, porque la exigencia cambia de una a otra.`,
    );
    if (datos.regimen === 'PDA' && num(datos.uw_max_Wm2K) > 0) {
      lineas.push(
        '',
        `En ${datos.comuna} rige el Plan de Descontaminación: Uw máximo *${dec(datos.uw_max_Wm2K)} W/m²K* ` +
        `por decreto. En otras comunas de la región no hay ese tope, aunque el frío sea el mismo.`,
      );
      bloquesConDato++;
    }
  } else if (datos.regimen === 'PDA' && num(datos.uw_max_Wm2K) > 0) {
    lineas.push(
      `Le cuento algo mientras termino su propuesta${trato}.`,
      '',
      `Le preparé un informe corto de ${datos.comuna} para que sepa contra qué se compara ` +
      `su ventana. Léalo con calma, son 30 segundos.`,
      '',
      `Su comuna está bajo Plan de Descontaminación, así que las ventanas tienen un tope ` +
      `*obligatorio*: Uw máximo *${dec(datos.uw_max_Wm2K)} W/m²K*.` +
      // [Codex] Solo se dice "esta en el decreto" si HAY decreto que citar. Afirmar una
      // norma sin poder nombrarla es peor que no mencionarla.
      (datos.criterio_ref ? ' No es una recomendación, está en el decreto.' : ''),
    );
    bloquesConDato++;
  } else {
    lineas.push(
      `Le cuento algo mientras termino su propuesta${trato}.`,
      '',
      `Le preparé un informe corto de ${datos.comuna} para que sepa contra qué se compara ` +
      `su ventana. Léalo con calma, son 30 segundos.`,
      '',
      `Su comuna es zona térmica *${datos.zona_termica_NCh1079 || '?'}* según la NCh 1079. ` +
      `Acá no hay tope obligatorio de Uw por ventana, pero el frío es el mismo.`,
    );
  }

  // 2) La condensación: el dato que el cliente SIENTE. Es lo que más engancha.
  const tE = num(cond?.clima?.theta_e_C);
  const hE = num(cond?.clima?.phi_e);
  const t65 = num(cond?.f_rsi_minimo?.['0.65']?.theta_si_min_C);
  const t75 = num(cond?.f_rsi_minimo?.['0.75']?.theta_si_min_C);
  if (tE !== null && hE !== null && t65 !== null) {
    lineas.push(
      '',
      `Sobre la condensación —esa agüita en el vidrio—: el clima oficial de ${datos.comuna}${esReferenciaRegional ? ' (referencia)' : ''} ` +
      `es *${dec(tE)} °C* con *${Math.round(hE * 100)} %* de humedad exterior.`,
      // [2026-08-21 · Codex] La condición de HR INTERIOR va DICHA. El umbral sale de suponer
      // 65 % adentro; con aire más seco esa superficie NO condensa. Presentarlo como
      // incondicional es una conclusión física falsa, y acá se citan normas.
      `Con 19 °C adentro y 65 % de humedad, si la superficie del vidrio baja de *${dec(t65)} °C*, condensa.`,
    );
    bloquesConDato++;
    if (t75 !== null) {
      lineas.push(
        `Y si adentro hay más humedad —75 %, como en una cocina o con ropa secándose—, ` +
        `el umbral sube a *${dec(t75)} °C*.`,
      );
    }
  }

  if (bloquesConDato === 0) return null;   // sin un solo dato duro no hay informe que valga

  // 3) La fuente. Sin esto es marketing; con esto es un informe.
  // [Codex] Cada afirmacion con su fuente. `criterio_ref` respalda la exigencia de Uw y
  // `cond.metodo` respalda la condensacion: atribuirle una a la otra es citar mal.
  const fuentes = [];
  if (datos.criterio_ref) fuentes.push(datos.criterio_ref);
  if (t65 !== null && cond && cond.metodo) fuentes.push(cond.metodo);
  if (fuentes.length) lineas.push('', `_Fuente: ${fuentes.join(' · ')}_`);

  // La firma va al final y con el número de resolución: eso es lo que convierte un mensaje
  // de WhatsApp en algo que el cliente guarda y le muestra a su marido, su arquitecto o su
  // maestro. Formal por el título, cercano porque lo firma una persona con nombre.
  lineas.push(
    '',
    `Se lo preparó *${FIRMA.nombre}*, ${FIRMA.cargo} (${FIRMA.resolucion}).`,
    'Cualquier duda técnica se la responde él mismo.',
    '',
    'Ahora le mando su propuesta con el Uw de sus ventanas. 👇',
  );

  return lineas.join('\n');
}

// [2026-08-21] Si no hay comuna, se usa TEMUCO como referencia regional (decision del
// dueño: "y si no entrega comuna indicar la de Temuco, como capital región"). Cubre el
// 15,3 % de las cotizaciones que hoy no traen comuna (75 de 491 medidas el 21-ago).
//
// ⚠️ PERO NO SE PUEDE PRESENTAR COMO SI FUERA SU COMUNA. Temuco está bajo PDA y tiene un
// tope de Uw *obligatorio por decreto*; Villarrica, Pucón, Lautaro y casi todo el resto NO.
// Decirle a alguien de Villarrica "usted tiene esta obligación legal" es falso, y una cita
// normativa mal aplicada destruye justo la credibilidad que el informe viene a construir.
// Por eso el fallback se ANUNCIA como referencia de la región y NUNCA afirma que el decreto
// le aplique a él.
export const COMUNA_REFERENCIA = 'Temuco';

/**
 * Atajo: comuna → mensaje listo (o null).
 * Sin comuna, cae a la referencia regional y lo dice explícitamente.
 */
export async function informeParaComuna(comuna, opts = {}) {
  const norm = normalizarComuna(comuna);

  if (norm) {
    const datos = await pedirInformeComuna(norm, opts);
    const msg = armarMensaje(datos, opts);
    if (msg) return msg;
  }

  // [2026-08-21 · hallazgo de Gemini en la revisión cruzada] El fallback NO alcanza con
  // cubrir "sin comuna": también tiene que cubrir "comuna que THERMAL no reconoce".
  // El cliente rara vez escribe una comuna — escribe DÓNDE VIVE. Medido contra la API real:
  //     Labranza ❌ · Cajón ❌ · Metrenco ❌ · "Temuco centro" ❌ · Pedro de Valdivia ❌
  // Los tres primeros son sectores de Temuco y Padre Las Casas. Sin este segundo intento,
  // esa gente NO RECIBÍA NADA — y justo después de que Oliver le prometió un dato técnico.
  // Quedarse callado ahí es peor que no haber prometido: el cliente espera en vano.
  const ref = await pedirInformeComuna(COMUNA_REFERENCIA, opts);
  return armarMensaje(ref, { ...opts, esReferenciaRegional: true });
}

/**
 * Espera antes de mandar el informe. Pedido del dueño: "la idea es demorarse un poco".
 * Sin esto el informe sale pegado al "déjeme calcular" y el cliente lee todo junto.
 * `dormir` es inyectable para que los tests no esperen de verdad.
 */
export async function esperarAntesDeEnviar({ dormir = null, ms = DEMORA_MS } = {}) {
  const espera = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Math.min(Number(ms), 90000) : 0;
  if (!espera) return;
  if (typeof dormir === 'function') return dormir(espera);
  await new Promise((r) => setTimeout(r, espera));
}

export { FIRMA, DEMORA_MS, DEMORA_AVISO_MS };
export default { normalizarComuna, pedirInformeComuna, armarMensaje, informeParaComuna, esperarAntesDeEnviar, FIRMA, VERSION };
