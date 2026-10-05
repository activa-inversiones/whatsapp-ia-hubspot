// services/folioReuso.js — cuánto vive un folio REUSADO. UNA constante, importada por los dos canales
// (webhook.js, channel-agent.js) y por el aviso del satén perdido (vidrioCotizado.js).
//
// Una corrección del cliente es una REVISIÓN del mismo folio, no un correlativo nuevo, mientras la cotización
// anterior tenga menos de FOLIO_REUSO_MS (antes: 0081→0085→0086 en una sola sesión = 3 folios ISO quemados para la
// misma propuesta). Pasado ese plazo la sesión se trata como nueva: una cotización genuinamente nueva semanas después
// no hereda un folio viejo. La ventana corre desde la ÚLTIMA cotización del cliente (`last_quote.at`), así que cada
// revisión la renueva.
//
// Estaba copiada en tres lugares; dos copias de un plazo se desincronizan igual que dos copias de una regla. Quien
// necesite "cuánto dura un folio" importa esto, no escribe 48 h.

export const FOLIO_REUSO_MS = 48 * 60 * 60 * 1000;
