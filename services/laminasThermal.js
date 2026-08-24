// laminasThermal.js — [2026-08-24]
//
// TRAE LAS LÁMINAS DE ISOTERMAS del solver FEM de ACTIVA THERMAL para meterlas en el informe.
//
// Pedido del dueño, textual: *"tan pequeño sabiendo que puedes pasarle el FEM al termopanel
// para ver la isoterma"*. Tenía razón: el informe pesaba 9 KB y THERMAL ya tiene 7 figuras
// del corte real del perfil, con las isotermas cada 1 °C, aprobadas y firmadas el 19-ago.
// Eran el mejor argumento de venta que teníamos y no se estaba usando.
//
// ─── CUÁLES SE MANDAN, Y POR QUÉ CAMBIARON (2026-08-24) ────────────────────────────────
// Arrancó con las tres que THERMAL marca `destacada` (01 corte vertical, 02 horizontal,
// 10 comparativa). El dueño —que es el evaluador que firma el informe— las bajó:
//     "sería mejor presentarlos por separador superior e inferior con panel, mejor para que
//      se vean las isotermas, porque a esta le falta todo"
// y enumeró lo que echaba de menos en el corte completo: calzo, puente de acristalamiento,
// el cierre del termopanel, las cotas b1/b2, los 190 mm de panel que exige la norma, y que
// la cavidad se resuelva por radiosidad con sus Rsi/Rse y emisividades (0,9 en general;
// ~0,3 en el acero galvanizado). Eso es MODELO DE THERMAL y no se toca desde acá: quedó
// como pedido formal en el tablero (#393).
// Lo que SÍ es nuestro: dejar de mandar en un documento firmado una figura que su propio
// autor considera incompleta. Por eso el set por defecto pasó a los NUDOS:
//     04 · nudo SUPERIOR con termopanel extendido 190 mm
//     03 · nudo INFERIOR con termopanel extendido 190 mm   <- el punto más exigido
//     07 · nudo inferior con separador de ALUMINIO  (lambda 160)     — caso desfavorable
//     08 · nudo inferior con separador WARM-EDGE    (lambda 0,135)   — caso mejorado
// 07 y 08 juntas dicen lo mismo que la 10, pero SOBRE EL NUDO, que es donde se ve.
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
 * Cuáles y en qué orden. Ver el bloque de la cabecera: son los NUDOS con panel, no los
 * cortes completos. El orden cuenta una historia — arriba, abajo, y después el mismo nudo
 * de abajo con un separador y con el otro, que es la comparación que vende.
 *
 * [P2 · Gemini, 24-ago] Propuso bajar a dos ('10','01') porque 6 páginas cansarían al
 * cliente. NO se aplicó: el dueño ya decidió lo contrario, textual — *"entregale el informe
 * real, no importa que sean varias hojas"* y *"pensé que tendría gráficas para que se vea
 * impresionante"*. Una recomendación de un revisor no pisa una decisión del dueño.
 * Pero SÍ se hizo configurable: si mañana cambia de opinión, se ajusta con una variable de
 * entorno y sin deployar.
 */
export const IDS_POR_DEFECTO = (process.env.THERMAL_LAMINAS_IDS || '04,03,07,08')
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

      // 🔴 [hallazgo de Codex, 24-ago] EL TECHO SE MIRA ANTES DE BAJAR, cuando se puede.
      // Antes el control estaba solo DESPUES de `arrayBuffer()`, o sea protegia el tamaño
      // del PDF pero NO la memoria: una lámina gigante se materializaba entera y recién ahí
      // se descartaba. Si el servidor declara `Content-Length` y no entra, ni se descarga.
      const declarado = Number(r.headers?.get?.('content-length'));
      if (Number.isFinite(declarado) && declarado > 0 && total + declarado > tope) {
        log(`[laminasThermal] techo de ${Math.round(tope / 1024)} KB alcanzado: la lámina ${id} `
          + `(${Math.round(declarado / 1024)} KB declarados) y las siguientes no van`);
        break;
      }

      const ab = await r.arrayBuffer();
      const png = Buffer.from(ab);
      // Se comprueba la FIRMA del PNG. Si THERMAL devolviera un JSON de error con 200,
      // meterlo en `doc.image()` reventaria la generacion del PDF entero y el cliente se
      // quedaria sin informe por culpa de un adorno.
      if (!esPng(png)) { log(`[laminasThermal] lámina ${id}: no es un PNG válido — se omite`); continue; }

      // El tope por megapíxeles (ver MAX_MPX): el peso en bytes NO acota la memoria.
      const med = medidasPng(png);
      if (med && med.mpx > MAX_MPX()) {
        log(`[laminasThermal] lámina ${id}: ${med.ancho}x${med.alto} = ${med.mpx.toFixed(1)} MPx supera el tope `
          + `de ${MAX_MPX()} MPx — se omite (decodificarla podría tumbar el proceso)`);
        continue;
      }

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

/** Ancho y alto leidos del IHDR. null si no es un PNG. */
export function medidasPng(buf) {
  if (!esPng(buf)) return null;
  const ancho = buf.readUInt32BE(16);
  const alto = buf.readUInt32BE(20);
  return ancho > 0 && alto > 0 ? { ancho, alto, mpx: (ancho * alto) / 1e6 } : null;
}

/**
 * 🔴 TOPE POR MEGAPIXELES — hallazgo de Codex en la compuerta cruzada del 24-ago, MEDIDO.
 *
 * EL PESO EN BYTES NO ACOTA LA MEMORIA. Un PNG uniforme comprime enormisimamente: se midio
 * uno de 3000x3000 RGBA que ocupa 34 KB en disco y hace subir el RSS 129 MB al generarse el
 * PDF. Uno de 10000x10000 entraria comodo bajo el techo de 2,5 MB y se comeria ~1,4 GB:
 * eso no deja al cliente sin informe, MATA EL PROCESO DEL BOT — se cae la atencion de todos
 * los clientes por culpa de un adorno de un informe.
 *
 * Por que RGBA y no cualquier PNG: pdfkit incrusta un PNG RGB tal cual, sin decodificarlo
 * (medido: +0 MB). Un RGBA lo TIENE que decodificar para separar el canal alfa en un SMask,
 * y ahi aparece el costo. Las laminas de THERMAL son RGBA, asi que caen del lado caro.
 *
 * Numeros reales medidos el 24-ago:
 *     lamina real 1950x1950 RGBA (3,8 MPx)  ->  +70 MB
 *     las 3 laminas juntas, camino completo ->  +103 MB de pico, 640 ms
 * El tope se pone en 8 MPx: mas del doble de lo que THERMAL manda hoy, y acota el peor caso
 * a ~115 MB por figura en vez de dejarlo abierto.
 */
const MAX_MPX = () => Number(process.env.THERMAL_LAMINA_MAX_MPX || 8);

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
