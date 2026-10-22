// services/ufDosModelos.js — [2026-10-22]
// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS Uf DEL MARCO, LADO A LADO, EN EL INFORME TÉRMICO AL CLIENTE (CM-FR-006).
//
// Decisión del dueño (21-oct, textual): «declarar ambos Uf, explicando que vienen de modelos
// distintos». Imagen de la sección aprobada el 22-oct («OK a la imagen»).
//
// Para un mismo perfil conviven dos Uf:
//  · MODELO 1 — el del informe THERM de WinHouse (activa-thermal `data/uf_winhouse.json`). Es el
//    que usa `/uw` para el Uw de cada ventana, y llega en `item.termico.detalle.uf`. NO se copia
//    acá: se lee del ítem, que es el número que de verdad entró al Uw.
//  · MODELO 2 — el del motor fem-tri de ACTIVA THERMAL, un Uf POR NODO, impreso en la Tabla 1 de
//    los informes de marcos con folio (NCh 3137/2). Esos sí viven acá, con su folio: son
//    documentos emitidos, no un cálculo que el bot pueda pedir.
//
// Reglas (las del encargo, y no se negocian):
//  · Los dos valores van uno al lado del otro. NUNCA se promedian ni uno reemplaza al otro.
//  · Solo se arma la fila cuando EXISTEN LOS DOS para el MISMO perfil. Hoy eso es la corredera
//    S75 H98 (doble y triple riel). Andes 66 tiene solo el fem-tri, H80 y S60 solo el THERM, y la
//    V8 oscilobatiente NO es la «Abatible S60» (dueño 21-oct: «No, son distintas»).
//  · Calce EXACTO del rótulo del motor, la misma regla del piloto Uw (uwLineaPiloto.js): un
//    rótulo con agregados («- triple hoja central fija», «— Blanco») no calza.
//  · Sin el Uf del modelo 1 en el ítem (sales-os sin `UW_ENABLED`, THERMAL caído) NO hay fila:
//    no se inventa un 2,30 de memoria.
// ═══════════════════════════════════════════════════════════════════════════

// 🔴 Si THERMAL reemite un informe de marcos, ESTA tabla se actualiza con el folio y la Tabla 1
// nuevos. Fuente: los PDF oficiales con folio (activa-thermal salida/informes/2026-10-19_con_folio),
// citados por `tools/informe_nodo/informe_uw.py` INFORME_UF @ origin/main d761e4b. Valores con
// dos cifras significativas (cl. 7.4 de NCh 3137/2), iguales en cámaras isótropas y anisótropas.
export const UF_FEM_TRI_POR_LINEA = Object.freeze({
  'corredera sliding h98 doble riel s75': Object.freeze({
    perfil: 'Sliding_H98',
    linea: 'Corredera S75 H98 doble riel',
    folio: 'AT-NCH3137-2-2026-000012',
    nodos: Object.freeze([
      Object.freeze({ nodo: 'Nodo inferior · riel 1', uf: 2.1 }),
      Object.freeze({ nodo: 'Nodo inferior · riel 2', uf: 2.2 }),
      Object.freeze({ nodo: 'Nodo de traslapo', uf: 1.7 }),
    ]),
  }),
  'corredera sliding h98 triple riel s75': Object.freeze({
    perfil: 'Sliding_H98',
    linea: 'Corredera S75 H98 triple riel',
    folio: 'AT-NCH3137-2-2026-000008',
    nodos: Object.freeze([
      Object.freeze({ nodo: 'Nodo inferior · riel 1', uf: 2.4 }),
      Object.freeze({ nodo: 'Nodo inferior · riel 2', uf: 2.2 }),
      Object.freeze({ nodo: 'Nodo inferior · riel 3', uf: 2.5 }),
      Object.freeze({ nodo: 'Nodo de traslapo', uf: 1.7 }),
    ]),
  }),
});

// Texto de cada modelo. Declara el método; nunca dice «HUECO», «no comprada» ni «no certificado»
// (lo vigila el test). El modelo 1 explica la extensión H80 → H98 (decisión del dueño 26-ago)
// como lo que es: el ensayo se hizo sobre la hoja H80 del mismo sistema.
export const TEXTO_UF_DOS_MODELOS = Object.freeze({
  titulo: 'Transmitancia del marco (Uf): dos modelos, lado a lado',
  entrada: 'El marco de sus correderas tiene hoy valores de Uf de dos modelos distintos: el modelo 1 entrega '
    + 'un valor para el perfil completo y el modelo 2 uno por cada nodo del marco. Se declaran los dos, uno al '
    + 'lado del otro. No se promedian ni uno reemplaza al otro: cada número responde a su propio modelo, y se '
    + 'informa de cuál salió.',
  cabecera1: 'MODELO 1 · Uf',
  sub1: 'Informe THERM de WinHouse',
  cabecera2: 'MODELO 2 · Uf por nodo',
  sub2: 'Motor fem-tri de ACTIVA THERMAL',
  pie1: 'W/m²K · un valor para el perfil',
  modelo1Titulo: 'Modelo 1 — Informe de transmitancia térmica de WinHouse (THERM · NCh 3137/2)',
  // [Codex r5] Método declarado, tal como lo titula el informe fuente (activa-thermal
  // data/uf_winhouse.json `_fuente.convenciones`): THERM, NCh 3137/2, tabla C.1 con panel de sustitución.
  modelo1: 'Un Uf para el perfil completo, calculado con el programa THERM según NCh 3137/2 con panel de '
    + 'sustitución: Uf = (L2D - Up·bp)/bf. El informe, firmado por el Evaluador CEV Bernardo Quilaman '
    + 'Cayuqueo, lo entrega para el sistema S75 con hoja H80 (tabla C.1); ACTIVA aplica ese valor a la hoja '
    + 'H98 del mismo sistema. Es el Uf con que se calculó el Uw de las ventanas de cada línea de esta tabla, '
    + 'informado más arriba.',
  modelo2Titulo: 'Modelo 2 — Motor de elementos finitos fem-tri de ACTIVA THERMAL (NCh 3137/2 · ISO 10077-2)',
  modelo2: 'Un Uf por cada nodo del marco (cada corte: los rieles inferiores y el traslapo), calculado sobre '
    + 'la geometría de la hoja H98. Uf = (L2D - Up·bp)/bf, con dos cifras significativas (cl. 7.4). Cada '
    + 'informe de marcos lleva su propio folio, citado en la tabla.',
  cierre: 'Los dos modelos difieren en la geometría modelada (H80 / H98) y en la forma de informar (perfil '
    + 'completo / nodo a nodo). Cada valor se declara tal como lo entrega su modelo, sin promediarlo y con los '
    + 'decimales de su fuente.',
});

const normalizar = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Uf del modelo 1 que entró al Uw de ESTA ventana, o null si no viene (no se inventa). */
function ufModelo1(v) {
  const t = v && v._perfil && v._perfil.termico;
  if (!t || typeof t !== 'object') return null;
  // [Codex r3] El perfil sale del MISMO objeto que entrega el Uf (`detalle`); si el nivel de
  // arriba dice otra cosa, la respuesta es inconsistente y no se declara.
  const perfil = t.detalle?.perfil ?? t.perfil;
  if (t.perfil != null && t.detalle?.perfil != null && String(t.perfil) !== String(t.detalle.perfil)) return null;
  // [Codex r4] Solo un número JSON: `Number(true)` es 1 y se declararía «1,00 W/m²K».
  const bruto = t.detalle?.uf;
  const uf = typeof bruto === 'number' && Number.isFinite(bruto) && bruto > 0 ? bruto : null;
  return { perfil: perfil == null ? null : String(perfil), uf };
}

/**
 * Las filas de la sección «dos modelos»: una por LÍNEA cotizada (no por ventana) que tenga los
 * dos Uf del mismo perfil, en el orden en que aparece. Vacío ⇒ la sección no se dibuja.
 * PURA: es lo que se le declara al cliente en un documento firmado, y por eso se testea aparte.
 *
 * @param {Array} ventanas  las del informe: {producto, _perfil: {termico: {perfil, detalle: {uf}}}}
 * @returns {Array<{linea, folio, ufModelo1: number, nodos: Array<{nodo, uf}>}>}
 */
export function filasUfDosModelos(ventanas) {
  const vistas = new Map();
  const filas = [];
  for (const v of Array.isArray(ventanas) ? ventanas : []) {
    const clave = normalizar(v?.producto || v?._perfil?.producto_label || v?._perfil?.product);
    const fem = UF_FEM_TRI_POR_LINEA[clave];
    if (!fem) continue;
    // Una fila por LÍNEA, y la línea se declara solo si TODAS sus ventanas tienen un modelo 1
    // compatible e igual. [Codex r2-r4 · Copilot r4] Basta UNA ventana de la línea sin Uf, con
    // otro perfil (un Uf de otro perfil al lado sería comparar dos marcos distintos) o con un Uf
    // distinto (comparado EXACTO: el redondeo es solo para imprimir) para que la línea NO se
    // declare: «es el Uf con que se calculó el Uw de las ventanas de cada línea» tiene que ser
    // cierto para todas.
    let fila = vistas.get(clave);
    if (!fila) {
      fila = { linea: fem.linea, folio: fem.folio, ufModelo1: null, nodos: fem.nodos.map((n) => ({ ...n })) };
      vistas.set(clave, fila);
      filas.push(fila);
    }
    const m1 = ufModelo1(v);
    if (!m1 || m1.uf === null || m1.perfil !== fem.perfil) { fila.inconsistente = true; continue; }
    if (fila.ufModelo1 === null) fila.ufModelo1 = m1.uf;
    else if (m1.uf !== fila.ufModelo1) fila.inconsistente = true;
  }
  return filas.filter((f) => !f.inconsistente && f.ufModelo1 !== null);
}

export default { filasUfDosModelos, UF_FEM_TRI_POR_LINEA, TEXTO_UF_DOS_MODELOS };
