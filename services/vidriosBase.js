// services/vidriosBase.js — [2026-10-06] FUENTE ÚNICA de los termopaneles base del bot.
// Regla del dueño, textual: *"los vidrios modificados en winart o agregados deben estar en el motor
// de activa asi podremos cotizar porque esos son los precios que ya estan validados ... esos son los
// termopaneles base que usaremos"*. Son los «Propio» de Winart (Thermoflex), que el sync mantiene al
// dia. Antes eran 34/61/38: copias MANUALES con price_manual=true que el sync no actualiza.
// Las env GLASS_ID_* siguen pudiendo pisarlos, y la allowlist se arma con el valor YA resuelto:
// asi el bot nunca elige un vidrio que su propio guardia despues rechaza.
export const VIDRIO_BASE = Object.freeze({
  STD:   Number(process.env.GLASS_ID_STD)   || 1607,   // 4+12+4 (< 2 m²)
  LARGE: Number(process.env.GLASS_ID_LARGE) || 1608,   // 5+12+5 (≥ 2 m²)
  BANO:  Number(process.env.GLASS_ID_BANO)  || 1609,   // 4+12+4 satén (baño)
});

// Copias manuales viejas: siguen ACEPTADAS (mismo precio) solo porque el LLM puede traer un
// glass_id de una conversacion anterior. El bot ya no las elige. Tablero: sacarlas.
export const VIDRIO_LEGACY = Object.freeze([34, 38, 61]);
