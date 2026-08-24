// laminasThermal.js — [2026-08-24]
//
// TRAE LAS LÁMINAS DE ISOTERMAS del solver FEM de ACTIVA THERMAL para meterlas en el informe.
//
// Pedido del dueño, textual: *"tan pequeño sabiendo que puedes pasarle el FEM al termopanel
// para ver la isoterma"*. Tenía razón: el informe pesaba 9 KB y THERMAL ya tiene 7 figuras
// del corte real del perfil, con las isotermas cada 1 °C, aprobadas y firmadas el 19-ago.
// Eran el mejor argumento de venta que teníamos y no se estaba usando.
//
// ─── LAS TRES QUE VENDEN (marcadas `destacada: true` por THERMAL) ──────────────────────
//   01 · Corte VERTICAL: isotermas cada 1 °C y los elementos que ve el solver
//   02 · Corte HORIZONTAL: idem
//   10 · ALUMINIO vs WARM-EDGE superpuestas — justifica sola el separador mejor
//
// ─── 🔴 LO QUE NUNCA HAY QUE HACER CON ESTAS IMÁGENES ──────────────────────────────────
// Cada PNG viaja con la cabecera `X-No-Declarable: true` y THERMAL lo dice en su propia
// respuesta: *"figuras ilustrativas; los valores declarables salen del cálculo"*.
// ⇒ PROHIBIDO leer un número de una figura, y prohibido presentarla como si fuera la
//   simulación de LA ventana del cliente. Es el corte del SISTEMA, y así hay que rotularlo.
//   El PDF las etiqueta con el perfil real y con esa advertencia; si eso se saca, se está
//   afirmando algo que el proveedor explícitamente no respalda.
//
// ─── NO SE MANDAN COMO LINK ────────────────────────────────────────────────────────────
// Las URLs de THERMAL son relativas y su servicio va por red interna: desde el teléfono
// del cliente no abren. Hay que DESCARGAR el PNG y adjuntarlo. Por eso este módulo
// devuelve buffers, no URLs. (contrato: _activa-docs/CONTRATO-OLIVER-THERMAL.md)
//
// ─── NUNCA FRENA NADA ──────────────────────────────────────────────────────────────────
// Si THERMAL no contesta, devuelve [] y el informe sale sin figuras. El informe ya es un
// extra sobre la cotización; las figuras son un extra sobre el informe. Dos niveles de
// degradación, ninguno rompe la venta.

const BASE_URL = () =>
  (process.env.THERMAL_API_URL || 'https://activa-thermal-production.up.railway.app')
    .replace(/\/$/, '');

/** Timeout POR LÁMINA. Son ~300-450 KB cada una; 12 s es holgado y acotado. */
const TIMEOUT_MS = () => Number(process.env.THERMAL_LAMINA_TIMEOUT_MS || 12000);
/** Techo total: el PDF viaja por WhatsApp y no queremos un adjunto que nadie abra. */
const MAX_BYTES = () => Number(process.env.THERMAL_LAMINAS_MAX_BYTES || 2_500_000);
/**
 * Cuáles y en qué orden. La 10 primero: es la que mejor vende, y quien abandona el PDF a
 * la mitad igual la vio.
 *
 * [P2 · Gemini, 24-ago] Propuso bajar a dos ('10','01') porque 6 páginas cansarían al
 * cliente. NO se aplicó: el dueño ya decidió lo contrario, textual — *"entregale el informe
 * real, no importa que sean varias hojas"* y *"pensé que tendría gráficas para que se vea
 * impresionante"*. Una recomendación de un revisor no pisa una decisión del dueño.
 * Pero SÍ se hizo configurable: si mañana cambia de opinión, se ajusta con una variable de
 * entorno y sin deployar.
 */
export const IDS_POR_DEFECTO = (process.env.THERMAL_LAMINAS_IDS || '10,01,02')
  .split(',').map((s) => s.trim()).filter(Boolean);

function cabeceras() {
  const h = {};
  // Igual que en informeTermico.js: hoy THERMAL no valida la key, pero el dia que la
  // prenda todo lo que llame sin ella se cae de golpe. Mandarla ahora es gratis.
  if (process.env.THERMAL_API_KEY) h['X-API-Key'] = process.env.THERMAL_API_KEY;
  return h;
}

/**
 * Qué perfiles tienen láminas hoy. Devuelve [] si THERMAL no contesta.
 * Al 24-ago hay UNO solo: `S60_proyectante` (9 láminas, 7 para cliente).
 */
export async function perfilesConLaminas({ fetchFn = globalThis.fetch, timeoutMs = null, log = console.warn } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS());
  try {
    const r = await fetchFn(`${BASE_URL()}/api/v1/laminas`, { signal: ctrl.signal, headers: cabeceras() });
    if (!r || r.ok === false) {
      if (r && (r.status === 401 || r.status === 403)) {
        log('[laminasThermal] 🔴 THERMAL exige API key para las láminas: falta THERMAL_API_KEY. El informe sale SIN figuras.');
      }
      return [];
    }
    const j = await r.json();
    return Array.isArray(j?.perfiles) ? j.perfiles : [];
  } catch (e) {
    log(`[laminasThermal] no se pudo listar láminas (${e?.name === 'AbortError' ? 'timeout' : e?.message}) — informe sin figuras`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Descarga las láminas pedidas de UN perfil.
 * Devuelve [{ id, png: Buffer, bytes }] — vacío si algo falla. NUNCA lanza.
 *
 * `perfil` es obligatorio y se usa para ROTULAR la figura en el PDF: mostrar el corte de
 * un perfil sin decir cuál es, sería dejar que el cliente asuma que es el suyo.
 */
export async function descargarLaminas(perfil, {
  ids = IDS_POR_DEFECTO, fetchFn = globalThis.fetch, timeoutMs = null,
  maxBytes = null, log = console.warn,
} = {}) {
  if (!perfil) return [];
  const tope = maxBytes || MAX_BYTES();
  const out = [];
  let total = 0;

  for (const id of ids) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS());
    try {
      const r = await fetchFn(`${BASE_URL()}/api/v1/lamina/${encodeURIComponent(perfil)}/${encodeURIComponent(id)}`,
        { signal: ctrl.signal, headers: cabeceras() });
      if (!r || r.ok === false) { log(`[laminasThermal] lámina ${id}: HTTP ${r?.status} — se omite`); continue; }

      const ab = await r.arrayBuffer();
      const png = Buffer.from(ab);
      // Se comprueba la FIRMA del PNG. Si THERMAL devolviera un JSON de error con 200,
      // meterlo en `doc.image()` reventaria la generacion del PDF entero y el cliente se
      // quedaria sin informe por culpa de un adorno.
      if (!esPng(png)) { log(`[laminasThermal] lámina ${id}: no es un PNG válido — se omite`); continue; }

      if (total + png.length > tope) {
        log(`[laminasThermal] techo de ${Math.round(tope / 1024)} KB alcanzado: la lámina ${id} y las siguientes no van`);
        break;
      }
      total += png.length;
      out.push({ id: String(id), png, bytes: png.length });
    } catch (e) {
      log(`[laminasThermal] lámina ${id} falló (${e?.name === 'AbortError' ? 'timeout' : e?.message}) — se omite`);
    } finally {
      clearTimeout(t);
    }
  }
  return out;
}

/** Firma PNG: 89 50 4E 47 0D 0A 1A 0A. */
export function esPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
}

/**
 * Atajo para el webhook: elige el perfil y trae sus láminas destacadas.
 * Hoy THERMAL publica un solo perfil, así que se toma ese; el día que haya varios,
 * `preferido` permite pedir el que corresponda al producto cotizado.
 */
export async function laminasParaInforme({ preferido = '', ...opts } = {}) {
  const perfiles = await perfilesConLaminas(opts);
  if (!perfiles.length) return { perfil: null, nombre: '', laminas: [], aprobadoPor: '', fecha: '' };

  const elegido = (preferido && perfiles.find((p) => p.perfil === preferido)) || perfiles[0];
  const laminas = await descargarLaminas(elegido.perfil, opts);
  return {
    perfil: elegido.perfil,
    nombre: elegido.nombre_comercial || elegido.perfil,
    aprobadoPor: elegido.aprobado_por || '',
    fecha: elegido.fecha_aprobacion || '',
    laminas,
  };
}

export default { laminasParaInforme, perfilesConLaminas, descargarLaminas, esPng, IDS_POR_DEFECTO };
