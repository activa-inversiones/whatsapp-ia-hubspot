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
  for (const it of items) {
    const dims = medidasDesdeTexto(it.measures_original || it.measures);
    const vid = vidrioDesdeEtiqueta(it.glass_label);
    if (!dims || !vid) { ilegibles += 1; continue; }
    legibles.push({
      nombre: (it.producto_label || it.product || 'Ventana').slice(0, 60),
      ancho_mm: dims.ancho_mm, alto_mm: dims.alto_mm,
      vidrio: { ...vid, tratamiento: 'recocido' },
      cantidad: Number(it.qty) || 1,
    });
  }
  return { legibles, ilegibles };
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
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;   // THERMAL caido o sin la ruta todavia: la secuencia sigue sin vientos
  }
}
