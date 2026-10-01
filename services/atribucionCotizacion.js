// services/atribucionCotizacion.js — SOLO COMPATIBILIDAD (reordenamiento 30-sep). No agregar lógica acá.
//
// Cotizar A NOMBRE DE OTRO (pedido del dueño 08-ago; vendedores del equipo desde el 30-sep) quedó
// partido por responsabilidad:
//   · telefono.js            normalización de teléfonos (una sola copia)
//   · internosEquipo.js      quién es quién: perfilEquipo, telefonoDuenio
//   · comandoCliente.js      el comando CLIENTE (parse, autorización, procesar, mensajes)
//   · atribucionStore.js     la atribución en memoria (fijar/obtener/limpiar/limpiarSiMisma)
//   · consentimiento.js      a quién se le puede escribir primero
//   · identidadCotizacion.js de quién es cada registro del turno (resolverTurno, builders, claves)
//   · sesionCarpetas.js / atribucionTurno.js  la carpeta por cliente y el consumo tras emitir
// Este archivo re-exporta lo que usaban los importadores y tests anteriores.

import { _resetAtribuciones } from './atribucionStore.js';
import { _resetConsentimiento } from './consentimiento.js';

export { normalizarChileno as normalizar, esCelularChileno, ult9 as ultimos9 } from './telefono.js';
export { parseComandoCliente, pareceComando, autorizaComandoCliente, procesarComandoCliente, mensajeTrasPdf } from './comandoCliente.js';
export { fijar, obtener, limpiar, limpiarSiMisma, VIGENCIA_MS } from './atribucionStore.js';
export { yaNosEscribio, marcarSinConsentimiento, registrarQueNosEscribio, sinConsentimiento, sinConsentimientoAsync } from './consentimiento.js';
export { identidadCotizacion, clavesCotizacion, clickIdsDe, leadDeAtribucion } from './identidadCotizacion.js';
export { telefonoDuenio, DUENIO_DEFAULT } from './internosEquipo.js';

/** Para tests: limpia atribuciones y consentimiento en memoria. */
export function _reset() { _resetAtribuciones(); _resetConsentimiento(); }
