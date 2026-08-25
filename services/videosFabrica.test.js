// videosFabrica.test.js — [2026-08-25]
//
// 🎥 MANDARLE AL CLIENTE UN VIDEO DE LA FABRICA DESPUES DE LA PROPUESTA.
//
// Pedido del dueño: *"debería enviarle catálogos… que Oliver pueda enviar al cliente después
// de enviar la propuesta y diga algo para que nos conozca"*. Hay 33 videos listos en su
// OneDrive, todos de 13–15 MB (bajo el limite de 16 MB de WhatsApp).
//
// ⚠️ SU CONDICION, TEXTUAL: *"que no gaste almacenamiento de nosotros, solo del cliente que
// revise; nosotros no lo volvemos a almacenar"*.
//
// COMO SE CUMPLE: cada video se sube UNA sola vez a Meta, que devuelve un `media_id` de unos
// 40 caracteres. Ese texto es lo unico que guardamos. El archivo lo aloja Meta y el MISMO id
// sirve para todos los clientes: no se re-sube por cliente, el repo no engorda y el servidor
// no guarda ni un byte de video.
//
// ⏳ LA TRAMPA CONOCIDA: los `media_id` de Meta CADUCAN (~30 dias). Un id vencido falla al
// enviar, asi que hay que poder re-subir sin intervencion — y sobre todo, que un video
// vencido NUNCA tumbe ni demore la propuesta, que es lo que de verdad importa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { elegirVideo, CATALOGO_VIDEOS, mensajeDelVideo } from './videosFabrica.js';

/* =========================================================================
 * EL CATALOGO
 * ========================================================================= */

test('el catalogo tiene videos, y cada uno con lo minimo para mandarlo', () => {
  assert.ok(CATALOGO_VIDEOS.length > 0);
  for (const v of CATALOGO_VIDEOS) {
    assert.ok(v.id, 'un id interno estable');
    assert.ok(v.archivo, 'el nombre del archivo original');
    assert.ok(v.titulo, 'que decirle al cliente');
    assert.ok(!/\.\.|[/\\]/.test(v.archivo), `${v.archivo}: solo el nombre, sin rutas`);
  }
});

test('🔒 los ids del catalogo son unicos', () => {
  const ids = CATALOGO_VIDEOS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
});

/* =========================================================================
 * QUE VIDEO LE TOCA
 * ========================================================================= */

test('🔴 al cliente NO se le repite el video que ya vio', () => {
  const primero = elegirVideo({ vistos: [] });
  assert.ok(primero, 'alguno tiene que salir');
  const segundo = elegirVideo({ vistos: [primero.id] });
  assert.notEqual(segundo.id, primero.id, 'mandar dos veces el mismo se lee como bot trabado');
});

test('🔒 si ya los vio todos, no se manda nada (no se empieza de nuevo)', () => {
  const todos = CATALOGO_VIDEOS.map((v) => v.id);
  assert.equal(elegirVideo({ vistos: todos }), null);
});

test('🔒 `vistos` con basura no rompe: sale el primero', () => {
  for (const basura of [null, undefined, 'texto', 42, {}]) {
    assert.ok(elegirVideo({ vistos: basura }), `con ${JSON.stringify(basura)}`);
  }
});

test('un video sin media_id cargado NO se elige: no se puede mandar', () => {
  // El catalogo lista lo que EXISTE; el media_id lo pone la carga inicial. Elegir uno sin
  // id produciria un envio fallido y un cliente esperando un video que no llega.
  const soloUno = CATALOGO_VIDEOS[0].id;
  const v = elegirVideo({ vistos: [], disponibles: [soloUno] });
  assert.equal(v.id, soloUno, 'solo se elige entre los que tienen media_id');
  assert.equal(elegirVideo({ vistos: [], disponibles: [] }), null,
    'sin ninguno cargado, no se manda nada');
});

/* =========================================================================
 * QUE SE LE DICE
 * ========================================================================= */

test('🔴 el mensaje invita a conocernos y NO pide nada a cambio', () => {
  const t = mensajeDelVideo(CATALOGO_VIDEOS[0]);
  assert.ok(t.length > 20, 'algo tiene que decir');
  assert.doesNotMatch(t, /\$|precio|descuento/i, 'el precio va en el PDF, no acá');
  assert.doesNotMatch(t, /\?$/, 'no es una pregunta: es un regalo, no una gestión más');
});

test('🔒 el mensaje no promete nada que no podamos cumplir', () => {
  for (const v of CATALOGO_VIDEOS) {
    const t = mensajeDelVideo(v);
    assert.doesNotMatch(t, /garantiz|el mejor|el más barato|único/i, `"${t}"`);
  }
});

test('🔴 los media_id se leen del estado compartido, y si no del archivo del repo', async () => {
  // Dos fuentes a proposito: la carga se corre desde el PC del dueño, que NO tiene las
  // credenciales de sales-os (viven en Railway) pero SI tiene los videos (OneDrive).
  // Exigir el estado compartido dejaria el script inutilizable justo en esa maquina.
  const { mediaIdsDisponibles } = await import('./videosFabrica.js');

  const delEstado = await mediaIdsDisponibles(async () => ({ fabrica: 'media.DEL_ESTADO' }));
  assert.equal(delEstado.fabrica, 'media.DEL_ESTADO', 'el estado compartido manda');

  // Sin estado, cae al archivo (o a {} si tampoco esta: no se manda video y ya).
  const sinEstado = await mediaIdsDisponibles(async () => null);
  assert.equal(typeof sinEstado, 'object', 'siempre devuelve un objeto');

  const conError = await mediaIdsDisponibles(async () => { throw new Error('KV caido'); });
  assert.equal(typeof conError, 'object', 'un KV caido no puede tumbar la propuesta');
});
