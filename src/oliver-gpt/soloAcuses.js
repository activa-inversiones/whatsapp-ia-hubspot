// src/oliver-gpt/soloAcuses.js — ¿este webhook de Meta trae SOLO acuses (sent/delivered/read/failed)?
//
// 🔴 [2026-10-08, OK del dueño: «dale con la a»] LOS ACUSES NUNCA LLEGABAN A QUIEN LOS PROCESA.
// El enrutador de index.js elige el manejador por el número de quien ESCRIBE (extractMsg), y para un
// acuse extractMsg dice "no es mensaje" ⇒ el acuse caía a V1, que lo descarta (`if (!inc.ok) return`).
// Consecuencia medida: `documento_entregado` = 0 en 90 días (#1403), `mensaje_leido` = 0 tras el deploy,
// y el aviso de "propuesta NO entregada" (webhook.js, camino de fallo) jamás se disparó en producción.
//
// Solo cuenta como "solo acuses" si NO viene ningún mensaje: un webhook mixto sigue su camino de siempre
// (el de los mensajes), para no cambiar en nada cómo se atiende a un cliente.
export function esSoloAcuses(body) {
  const cambios = (Array.isArray(body?.entry) ? body.entry : [])
    .flatMap((e) => (Array.isArray(e?.changes) ? e.changes : []));
  let hayAcuse = false;
  for (const c of cambios) {
    const v = c?.value;
    if (Array.isArray(v?.messages) && v.messages.length) return false;
    if (Array.isArray(v?.statuses) && v.statuses.length) hayAcuse = true;
  }
  return hayAcuse;
}
