/**
 * [2026-08-24] Reengancha a los 3 clientes que quedaron sin su informe térmico.
 *
 * POR QUÉ EXISTE: el bug del candado (un `mediaId` de Meta se tomó por entrega confirmada)
 * marcó el informe como "ya enviado" por 30 días a gente que nunca lo recibió. Los candados
 * ya se vencieron a mano —verificado en `simple_cache`—, así que Oliver PUEDE volver a
 * mandarlo. Este script manda el texto que provoca el pedido.
 *
 * QUÉ HACE Y QUÉ NO: manda TEXTO por `/internal/operator-send`. NO manda el PDF, porque ese
 * endpoint pide una URL pública (Meta va a buscar el `link`) y el PDF se arma en memoria.
 * El PDF lo manda Oliver solo, con la tool `enviar_informe_termico`, en cuanto el cliente
 * responde que sí.
 *
 * USO (el token NUNCA se escribe en el comando ni se imprime):
 *   $env:INTERNAL_OPERATOR_TOKEN = "<pegar acá>"
 *   node enviar-3-clientes.mjs --dry     # muestra a quién y qué, sin mandar nada
 *   node enviar-3-clientes.mjs           # manda de verdad
 */
const BOT = process.env.BOT_URL || 'https://whatsapp-ia-hubspot-production.up.railway.app';
const TOKEN = process.env.INTERNAL_OPERATOR_TOKEN || '';
const DRY = process.argv.includes('--dry');

// Datos REALES, verificados contra ACTIVA THERMAL el 2026-08-24 (`/api/v1/exigencia`):
//   Temuco -> `regimen: "PDA"`,      tope Uw 3,2 W/m²K por elemento, zona térmica F
//   Vilcún -> `regimen: "sin_PDA"`,  uw_max_Wm2K: null (la norma NO fija tope por elemento),
//             misma zona F y mismo clima de cálculo (3,8 °C / 94 % HR) que Temuco.
// ⛔ NO decir que Vilcún "es más exigente": es al revés, y el cliente puede comprobarlo.
const CLIENTES = [
  {
    tel: '56982872242', nombre: 'Abelardo', comuna: 'Temuco', cot: 'CM-FR-004-2026-0333',
    texto:
      'Hola Abelardo, le preparé el informe térmico de su proyecto en Temuco.\n\n'
      + 'Temuco está bajo Plan de Descontaminación, así que la norma le pone un tope de Uw de '
      + '3,2 W/m²K a cada ventana. El informe le muestra ese número, el de la ventana que le '
      + 'cotizamos, y a qué temperatura empieza a condensar el vidrio.\n\n'
      + 'También va el cálculo del borde de su termopanel por elementos finitos: ahí es donde '
      + 'se escapa el calor que casi nadie mide.\n\n'
      + 'Va firmado por el Ing. Marcelo Cifuentes, Evaluador Energético acreditado MINVU.\n\n'
      + '¿Se lo envío para que lo revise?',
  },
  {
    tel: '56939240014', nombre: 'René', comuna: 'Vilcún', cot: 'CM-FR-004-2026-0332',
    texto:
      'Hola René, le preparé el informe térmico de su proyecto en Vilcún.\n\n'
      + 'Un dato que conviene tener claro antes de decidir: Vilcún no está bajo Plan de '
      + 'Descontaminación, así que la norma NO le exige un tope de Uw por ventana. Pero el '
      + 'clima de cálculo es el mismo que el de Temuco (3,8 °C y 94 % de humedad). O sea: la '
      + 'exigencia real no se la pone el papel, se la pone el invierno.\n\n'
      + 'El informe le muestra a qué temperatura empieza a condensar, y el cálculo del borde '
      + 'de su termopanel por elementos finitos, que es por donde se pierde el calor que casi '
      + 'nadie mide. Son 6 ventanas, así que la diferencia se nota.\n\n'
      + 'Va firmado por el Ing. Marcelo Cifuentes, Evaluador Energético acreditado MINVU.\n\n'
      + '¿Se lo envío?',
  },
  {
    tel: '56953265924', nombre: 'Liliana', comuna: 'Temuco', cot: 'CM-FR-004-2026-0331',
    texto:
      'Hola Liliana, le preparé el informe térmico de su proyecto en Temuco.\n\n'
      + 'Temuco está bajo Plan de Descontaminación, así que la norma le pone un tope de Uw de '
      + '3,2 W/m²K a cada ventana. El informe le muestra ese número, el de la ventana que le '
      + 'cotizamos, y a qué temperatura empieza a condensar el vidrio.\n\n'
      + 'También va el cálculo del borde de su termopanel por elementos finitos, que es por '
      + 'donde se escapa el calor que casi nadie mide.\n\n'
      + 'Va firmado por el Ing. Marcelo Cifuentes, Evaluador Energético acreditado MINVU.\n\n'
      + '¿Se lo envío para que lo revise?',
  },
];

if (!TOKEN && !DRY) {
  console.error('Falta INTERNAL_OPERATOR_TOKEN en el entorno. No se manda nada.');
  process.exit(1);
}

let ok = 0; let fallo = 0;
for (const c of CLIENTES) {
  if (DRY) {
    console.log(`\n──── ${c.nombre} · ${c.comuna} · ${c.tel} · ${c.cot} ────\n${c.texto}`);
    continue;
  }
  try {
    const r = await fetch(`${BOT}/internal/operator-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TOKEN },
      body: JSON.stringify({ phone: c.tel, text: c.texto, operator_name: 'Oliver' }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { console.log(`✅ ${c.nombre.padEnd(9)} ${c.tel}  enviado`); ok++; }
    else { console.log(`❌ ${c.nombre.padEnd(9)} ${c.tel}  HTTP ${r.status} ${j.error || ''}`); fallo++; }
  } catch (e) {
    console.log(`❌ ${c.nombre.padEnd(9)} ${c.tel}  ${e.message}`); fallo++;
  }
}
if (!DRY) console.log(`\n${ok} enviados · ${fallo} fallidos`);
