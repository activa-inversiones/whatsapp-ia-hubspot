import test from 'node:test';
import assert from 'node:assert/strict';
import { esMonorrielPorForma } from '../../services/enginePricer.js';

/* =========================================================================
 * 🏭 HECHO DEL NEGOCIO (dueño, textual 2026-09-18):
 *     "una corredera un hoja paño fijo es andes monorriel"
 *
 * Ya estaba en el mallado desde el 11-sep y no se consulto:
 *   DIBUJO-VENTANAS-ACTIVA.md:57  "Monorriel = 1 hoja movil + 1 paño FIJO, en UN marco."
 *   DIBUJO-VENTANAS-ACTIVA.md:65  "'Mitad fija mitad corredera' = monorriel = ANDES."
 *
 * POR QUE IMPORTA PARA LA PLATA: el monorriel es linea ANDES, y `ANDES_AUTO_COTIZA = false`
 * ⇒ se escala a Marcelo. Hoy el cliente NUNCA escribe la palabra "andes": describe la FORMA
 * ("corredera con un paño fijo"), y la rama ANDES solo se activa por la palabra. O sea:
 *   · antes se cotizaba como ventana FIJA  (producto equivocado)
 *   · y con el fix de apertura pasaria a SLIDING 2 hojas doble riel (otro producto equivocado;
 *     SLIDING ni siquiera tiene monorriel: el motor responde monorriel_no_disponible_en_sliding)
 * Lo correcto es ESCALAR.
 *
 * ⚠️ LA FRONTERA: monorriel = UNA hoja movil. La corredera de 3 hojas con la central fija tiene
 * DOS moviles ⇒ NO es monorriel, es SLIDING doble riel, y esa SI esta calibrada (Winart v69621).
 * ========================================================================= */

test('🔴 1 hoja movil + 1 paño fijo ES monorriel (→ ANDES → escala)', () => {
  for (const t of [
    'corredera con un paño fijo',
    'corredera de dos paños, un paño fijo',
    'corredera de dos hojas, una fija',
    'corredera de dos hojas, la derecha fija',
    'corredera 2 hojas con una hoja fija',
    'mitad fija mitad corredera',
    'fija + corredera',
    'corredera monorriel',
    'ventana corredera de una hoja y un paño fijo',
  ]) {
    assert.equal(esMonorrielPorForma(t), true, t);
  }
});

test('🔒 LA FRONTERA: 3 hojas con la central fija son DOS moviles → NO es monorriel', () => {
  // Esta es la que el dueño pidio habilitar y esta calibrada contra Winart v69621.
  // Si cayera en monorriel, se escalaria una ventana que SI sabemos cotizar.
  for (const t of [
    'CORREDERA DOBLE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',
    'CORREDERA DOBRE RIEL TRIPLE HOJA, LA DEL MEDIO FIJA',
    'corredera 3 hojas central fija',
    'corredera tres hojas la del centro fija',
    'corredera 3 hojas, lateral fijo',
    'corredera de 3 hojas, 1 fija',
    'doble riel triple hoja la del medio fija',
  ]) {
    assert.equal(esMonorrielPorForma(t), false, t);
  }
});

test('🔒 una corredera comun y una fija comun no son monorriel', () => {
  for (const t of ['corredera de 2 hojas', 'corredera', 'ventana fija', 'paño fijo', 'proyectante baño']) {
    assert.equal(esMonorrielPorForma(t), false, t);
  }
});

test('🔒 la negacion se respeta: "que NO sea monorriel" no es monorriel', () => {
  assert.equal(esMonorrielPorForma('corredera que no sea monorriel'), false);
});

/* 🔱 LOS QUE CAZO LA COMPUERTA (Codex) ==================================== */

test('🔴 BLOCKER: una señal de forma NO puede apagar la de 3 hojas antes de contar', () => {
  // "Corredera 3 hojas (1 fija + 2 correderas)" activaba "fija + corredera" y hacia return
  // true ANTES del conteo: escalaba la ventana que el dueño acaba de pedir que se cotice.
  // Textual de Codex: "el comentario afirma que la cantidad de hojas decide, pero el flujo
  // ejecutable dice lo contrario".
  assert.equal(esMonorrielPorForma('Corredera 3 hojas (1 fija + 2 correderas)'), false);
  assert.equal(esMonorrielPorForma('corredera 3 hojas: 1 fija y 2 correderas'), false);
});

test('🔒 el cliente tambien lo dice con VERBOS, no solo con sustantivos', () => {
  for (const t of [
    'una hoja corre y la otra es fija',
    'una corre y la otra queda fija',
    'un lado corre y el otro no abre',
  ]) {
    assert.equal(esMonorrielPorForma(t), true, t);
  }
});
