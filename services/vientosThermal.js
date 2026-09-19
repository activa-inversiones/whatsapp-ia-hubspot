// vientosThermal.js — [2026-08-28]
//
// EL CLIENTE DEL MOTOR DE VIENTOS DE ACTIVA THERMAL (POST /api/v1/vientos).
//
// Pedido del dueno, textual: *"dale, agrega el informe de vientos a la secuencia de Oliver"*.
//
// REGLA DE LA CASA (2026-08-10): THERMAL SE PIDE, NO SE INCORPORA. Se le piden numeros por
// HTTP y se sigue de largo si no contesta: sin respuesta -> null -> el informe de vientos
// simplemente NO sale y la secuencia continua. Nada se rompe, nada se inventa.
//
// SUPUESTO DECLARADO (viaja al PDF, no se esconde): la demanda automatica se pide para
// altura 3 m en entorno ciudad (primer/segundo piso urbano, el caso tipico de la venta por
// WhatsApp). El propio motor la calcula por el carril legal chileno (NCh 432 del portal
// MINVU, la que cita la OGUC) y DECLARA que la vigente tecnica es NCh432:2025.

const THERMAL_URL = (process.env.THERMAL_API_URL || 'https://activa-thermal-production.up.railway.app').replace(/\/$/, '');

/**
 * Saca (ext, camara, int) de la etiqueta comercial del vidrio: "Termopanel DVH 4+12+4",
 * "DVH 5/12/5", "Termopanel 5+12+5"… Sin numeros legibles -> null (esa ventana no va al
 * informe de vientos; no se adivina un espesor).
 */
export function vidrioDesdeEtiqueta(etiqueta) {
  // [Copilot, compuerta] Tambien con guion ("4-12-4"): el campo es SOLO glass_label, asi
  // que no hay folios ni medidas que puedan confundirse aca.
  const m = String(etiqueta || '').match(/(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { ext_mm: Number(m[1]), camara_mm: Number(m[2]), int_mm: Number(m[3]) };
}

/**
 * ¿Es un vidrio SIMPLE (monolitico o laminado), y de que espesor?
 *
 * 🔴 [2026-09-18] HASTA HOY ESTAS VENTANAS SE CONTABAN COMO "ILEGIBLES". Pregunta del dueño,
 * textual: *"que pasa cuando tiene vidrios que ahora debe cotizar y termopaneles, deberia
 * tener ambos"*. El catalogo tiene **18 vidrios simples cotizables** (VS-3MM a VS-6MM,
 * laminados LM-5 a LM-12, espejos, moriscos, reflect float) y ninguno llegaba al informe.
 *
 * La diferencia importa: "no se pudo leer" y "es vidrio simple" NO son lo mismo. El dato se
 * lee perfecto; lo que pasa es que **el motor de vientos hoy solo acepta termopanel** — MEDIDO
 * el 18-sep: exige `ext_mm`, `int_mm` y `camara_mm > 0`, y rechaza cualquier otra forma.
 * Contarlas como ilegibles le decia al cliente que su lista estaba mal escrita cuando el
 * problema es nuestro alcance.
 */
export function vidrioSimpleDesdeEtiqueta(etiqueta) {
  const t = String(etiqueta || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!t.trim()) return null;
  // Si trae la forma de termopanel (tres numeros), no es simple: lo resuelve la otra funcion.
  if (/(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)\s*[+/-]\s*(\d+(?:\.\d+)?)/.test(t)) return null;
  const esLaminado = /lamin/.test(t) || /\blm-/.test(t);
  // Laminado "3+3" o "5+5": son dos laminas pegadas, el espesor es la suma.
  const lam = t.match(/\b(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\b/);
  if (lam) return { simple_mm: Number(lam[1]) + Number(lam[2]), laminado: true };
  // Texto ("Monolitico 4mm", "cristal 6 mm") o codigo del catalogo (VS-4MM, LM-8MM, ES-3MM).
  const m = t.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (!m) return null;
  const mm = Number(m[1]);
  // Fuera de rango no se inventa: el vidrio mas grueso del catalogo es el laminado de 12 mm.
  if (!Number.isFinite(mm) || mm <= 0 || mm > 25) return null;
  return { simple_mm: mm, laminado: esLaminado };
}

/** "1200x1000mm" | "1200×1000" -> { ancho_mm, alto_mm } | null. */
export function medidasDesdeTexto(medidas) {
  const m = String(medidas || '').match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (!m) return null;
  return { ancho_mm: Number(m[1]), alto_mm: Number(m[2]) };
}

/**
 * Arma el payload del motor desde las partidas de la propuesta. Las ventanas ilegibles se
 * cuentan (van al PDF como "requiere calculo del especialista"), no se rellenan.
 */
export function ventanasParaVientos(items = []) {
  const legibles = [];
  let ilegibles = 0;
  const simples = [];
  for (const it of items) {
    const dims = medidasDesdeTexto(it.measures_original || it.measures);
    const vid = vidrioDesdeEtiqueta(it.glass_label);
    // [2026-09-18] VIDRIO SIMPLE: se LEE bien, pero el motor de vientos solo acepta termopanel.
    // Se cuenta aparte para que el informe diga la verdad ("el especialista calcula la
    // resistencia del vidrio simple") en vez de "no se pudo leer", que le echaba la culpa al
    // cliente por un limite nuestro. Si la medida tampoco se entiende, sigue siendo ilegible.
    if (dims && !vid) {
      const simple = vidrioSimpleDesdeEtiqueta(it.glass_label);
      if (simple) {
        simples.push({
          nombre: (it.producto_label || it.product || 'Ventana').slice(0, 60),
          ancho_mm: dims.ancho_mm, alto_mm: dims.alto_mm,
          espesor_mm: simple.simple_mm, laminado: simple.laminado,
          cantidad: Number(it.qty) || 1,
        });
        continue;
      }
    }
    if (!dims || !vid) { ilegibles += 1; continue; }
    // 🔴 [2026-09-18] SE LE MANDABA LA VENTANA COMPLETA COMO SI FUERA UN PAÑO DE VIDRIO.
    // El vidrio resiste el viento segun SU tamaño, no el de la ventana. En la propuesta de
    // Mario Grey eso preguntaba "¿aguanta un vidrio de 2710x1995?" cuando el paño real mide
    // 770x1747 — tres veces mas angosto. Un paño mas grande flecta mas, asi que la respuesta
    // habria sido pesimista; en la practica ni salia, porque ese tamaño cae fuera de la malla
    // del motor y el informe quedaba SIN VEREDICTO DE RESISTENCIA.
    // Pedido del dueño, textual: *"el tamaño del vidrio debe estar ahi con los descuentos para
    // que lo tengas y muestres la resistencia en la grafica"*.
    // El motor de precios ya calcula el paño con los descuentos de marco y hoja y desde hoy lo
    // publica en `pano_vidrio`. Si no viene (linea sin calcular, o ANDES/S60 que todavia no lo
    // exponen) se cae a la medida de la ventana, que es lo que se hacia hasta ahora: peor
    // aproximacion, pero nunca menos informacion que antes.
    const pano = it.pano_vidrio && Number(it.pano_vidrio.ancho_mm) > 0 && Number(it.pano_vidrio.alto_mm) > 0
      ? { ancho_mm: Math.round(Number(it.pano_vidrio.ancho_mm)), alto_mm: Math.round(Number(it.pano_vidrio.alto_mm)) }
      : null;
    legibles.push({
      // 🔴 [2026-09-19] El numero que puso el CLIENTE, para que los TRES documentos
      // (propuesta, termico, vientos) rotulen igual la misma ventana. Lo advirtio Gemini:
      // dos documentos de la misma casa que numeran distinto no se pueden reconciliar.
      pos: it.pos ?? undefined,
      nombre: (it.producto_label || it.product || 'Ventana').slice(0, 60),
      ancho_mm: pano ? pano.ancho_mm : dims.ancho_mm,
      alto_mm: pano ? pano.alto_mm : dims.alto_mm,
      // Viajan tambien las medidas de la VENTANA, para que el informe pueda decir de que
      // ventana habla aunque el calculo sea del paño. Y `pano_declarado` deja escrito cual de
      // las dos se uso: sin eso, un veredicto no se puede auditar despues.
      ventana_ancho_mm: dims.ancho_mm, ventana_alto_mm: dims.alto_mm,
      pano_declarado: Boolean(pano),
      vidrio: { ...vid, tratamiento: 'recocido' },
      cantidad: Number(it.qty) || 1,
    });
  }
  return { legibles, ilegibles, simples };
}

/**
 * Pide el calculo al motor. Devuelve el JSON del motor o null (y NUNCA lanza): el informe
 * de vientos es un regalo de la secuencia, no puede demorar ni tumbar nada.
 */
export async function pedirVientos({ comuna = '', cliente = '', ventanas }) {
  if (!Array.isArray(ventanas) || !ventanas.length) return null;
  try {
    const r = await fetch(`${THERMAL_URL}/api/v1/vientos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.THERMAL_API_KEY ? { 'x-api-key': process.env.THERMAL_API_KEY } : {}),
      },
      body: JSON.stringify({
        comuna, cliente, ventanas,
        demanda_auto: { altura_m: 3, entorno: 'ciudad' },   // supuesto DECLARADO en el PDF
        // Dueno 28-ago: "muchas curvas... las maximas que indica la ley". El motor devuelve
        // el bloque "curvas" y el PDF lo dibuja; si el motor viejo no lo trae, el informe
        // sale igual en su version de 1 pagina.
        incluir_curvas: true,
        // Dueno 28-ago (2a orden): "maxima informacion a cliente para un informe nivel
        // corp... todos los parametros que encontramos". El bloque "clima" trae zona
        // termica + lluvia/temperatura de la estacion DMC de SU comuna + racha marco.
        incluir_clima: true,
      }),
      // [Copilot, compuerta] 10 s en vez de 8: las curvas agregan ~180 interpolaciones
      // del lado del motor y un timeout corto aca tumba el informe COMPLETO, no solo el
      // grafico. El candado de la secuencia es 30 s: sobra espacio.
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;   // THERMAL caido o sin la ruta todavia: la secuencia sigue sin vientos
  }
}
