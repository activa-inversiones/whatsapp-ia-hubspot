// videosFabrica.js — [2026-08-25]
//
// 🎥 EL VIDEO DE LA FABRICA QUE VA DESPUES DE LA PROPUESTA.
//
// Pedido del dueño: *"debería enviarle catálogos… que Oliver pueda enviar al cliente después
// de enviar la propuesta y diga algo para que nos conozca"*.
//
// ⚠️ SU CONDICION, TEXTUAL: *"que no gaste almacenamiento de nosotros, solo del cliente que
// revise; nosotros no lo volvemos a almacenar"*.
//
// COMO SE CUMPLE — la parte importante del diseño:
// cada video se sube UNA sola vez a Meta, que devuelve un `media_id` de unos 40 caracteres.
// Ese texto es lo UNICO que guardamos (en el estado persistente). El archivo lo aloja Meta y
// el mismo id sirve para todos los clientes: no se re-sube por cliente, el repo no engorda,
// el servidor de Railway no guarda ni un byte de video, y los originales siguen viviendo en
// el OneDrive del dueño. La carga se hace UNA vez con `tools/subir-videos-wa.mjs`.
//
// ⏳ LOS media_id CADUCAN (~30 dias). Un id vencido falla al enviar. Por eso: (a) el envio es
// fire-and-forget y JAMAS puede tumbar ni demorar la propuesta —el video es un regalo, la
// propuesta es la venta—; y (b) cuando un envio falla, el id se descarta para que la proxima
// carga lo reponga.

/**
 * Los videos que se le pueden mandar a un cliente. `archivo` es el nombre TAL CUAL en
 * `OneDrive/VIDEOS PARA WHATSAPP/_LISTOS PARA WHATSAPP`, que es lo que lee el script de
 * carga. El `media_id` NO vive aca: se guarda al subirlos, porque caduca.
 *
 * Orden = prioridad. Primero lo que mejor explica quienes somos.
 */
export const CATALOGO_VIDEOS = [
  // [2026-08-27] Pedido del dueño ("que Oliver envíe el mejorado"): su video de presentación
  // (él a cámara + sello ISO), con color y luz mejorados. Va PRIMERO: es el que mejor presenta.
  {
    id: 'presentacion',
    archivo: 'PRESENTACION MARCELO ACTIVA MEJORADO.mp4',
    titulo: 'la presentación de nuestra empresa — con Marcelo, el dueño',
  },
  {
    id: 'fabrica',
    archivo: 'V2 FABRICA DE VENTANAS ACTIVA.mp4',
    titulo: 'nuestra fábrica en Temuco',
  },
  {
    id: 'cnc_corte',
    archivo: 'VIDEO_CENTRO_CNC_CORTE_PVC _ITALIANA .mp4',
    titulo: 'el centro de corte CNC italiano',
  },
  {
    id: 'mesas_armado',
    archivo: 'VIDEO_MESAS_ARMADO.mp4',
    titulo: 'las mesas de armado',
  },
  {
    id: 'refuerzos',
    archivo: 'VIDEO_ATORNILLADO_REFUERZOS_ARMADO_ALUMINIO.mp4',
    titulo: 'los refuerzos de acero que van dentro del perfil',
  },
  {
    id: 'limpieza_cnc',
    archivo: 'VIDEO_CENTRO_CNC_LIMPIEZA_VENTANAS_PVC.mp4',
    titulo: 'la terminación de las esquinas',
  },
  {
    id: 'oficina',
    archivo: '1 PRESENTACION OFICINA Y PUERTA .mp4',
    titulo: 'nuestra oficina y sala de muestras',
  },
];

/**
 * Cual le toca a este cliente.
 *
 * @param {string[]} vistos       ids que ya recibio (van en su sesion)
 * @param {string[]} disponibles  ids que HOY tienen media_id cargado. Si no se pasa, se
 *                                asume que estan todos: elegir uno sin id produciria un
 *                                envio fallido y un cliente esperando algo que no llega.
 * @returns {object|null} el video, o null si no queda ninguno por mandar
 */
export function elegirVideo({ vistos, disponibles } = {}) {
  const yaVio = new Set(Array.isArray(vistos) ? vistos : []);
  const cargados = Array.isArray(disponibles) ? new Set(disponibles) : null;
  return CATALOGO_VIDEOS.find((v) => !yaVio.has(v.id) && (!cargados || cargados.has(v.id))) || null;
}

/**
 * Que se le dice al mandarlo.
 *
 * No es una pregunta ni pide nada: el cliente acaba de recibir su propuesta y este video es
 * para que sepa a quien le esta comprando. Una gestion mas en ese momento cansa; algo que
 * mirar, no.
 */
export function mensajeDelVideo(video) {
  return `Le dejo un video corto de ${video.titulo}, para que sepa quiénes somos y cómo `
    + 'trabajamos. Fabricamos acá en Temuco, así que cualquier detalle lo resolvemos nosotros.';
}

/**
 * De donde salen los `media_id`. Dos fuentes, en orden:
 *   1. el estado compartido (`videos_fabrica:media_ids`) — se renueva sin deploy;
 *   2. `data/videos-media-ids.json` del repo — respaldo para cuando la carga se corre desde
 *      un PC que no tiene las credenciales de sales-os (que es el caso del dueño: las
 *      credenciales viven en Railway y los videos en su OneDrive).
 *
 * Si no hay ninguno, no se manda video. No pasa nada malo: el cliente igual tiene su
 * propuesta y su informe.
 */
export async function mediaIdsDisponibles(leerEstado) {
  let ids = null;
  try { ids = await leerEstado('videos_fabrica:media_ids'); } catch { /* se prueba el archivo */ }
  if (ids && Object.keys(ids).length) return ids;
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const ruta = fileURLToPath(new URL('../data/videos-media-ids.json', import.meta.url));
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch { return {}; }          // sin ids cargados: simplemente no se manda video
}
