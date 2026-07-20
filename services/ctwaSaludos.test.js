// ctwaSaludos.test.js — RED ANTI-REGRESIÓN — saludo por ángulo del anuncio CTWA
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAngle, saludoForAngle, saludoForReferral, SALUDOS, DEFAULT_AD_ANGLE_MAP,
} from './ctwaSaludos.js';

const ENV = {}; // env limpio: sin killswitch ni mapa custom

test('SALUDO: ad_id de Ronda 1 mapea al ángulo exacto (los 3)', () => {
  assert.equal(detectAngle({ adId: '120251614379310092' }, ENV), 'termico');
  assert.equal(detectAngle({ adId: '120251614381940092' }, ENV), 'fabrica');
  assert.equal(detectAngle({ adId: '120251614384990092' }, ENV), 'precio');
});

test('SALUDO: ad_id del mapa GANA sobre headline contradictorio', () => {
  const ref = { adId: '120251614379310092', headline: '¿No sale más caro?' };
  assert.equal(detectAngle(ref, ENV), 'termico');
});

test('SALUDO: headline con acentos/mayúsculas → keywords acento-insensibles', () => {
  assert.equal(detectAngle({ adId: '999', headline: '¿Sus ventanas LLORAN en invierno?' }, ENV), 'termico');
  assert.equal(detectAngle({ adId: '999', headline: 'Somos FÁBRICA, no revendedores' }, ENV), 'fabrica');
  assert.equal(detectAngle({ adId: '999', headline: '«¿No sale más caro?»' }, ENV), 'precio');
});

test('SALUDO: sin match (ad desconocido + headline neutro) → null, no inventa', () => {
  assert.equal(detectAngle({ adId: '999', headline: 'Ventanas PVC Temuco' }, ENV), null);
  assert.equal(detectAngle({}, ENV), null);
  assert.equal(detectAngle(null, ENV), null);
});

test('SALUDO: saludoForAngle entrega el texto aprobado; ángulo inválido → null', () => {
  assert.equal(saludoForAngle('termico'), SALUDOS.termico);
  assert.equal(saludoForAngle('fabrica'), SALUDOS.fabrica);
  assert.equal(saludoForAngle('precio'), SALUDOS.precio);
  assert.equal(saludoForAngle('otro'), null);
  assert.equal(saludoForAngle(null), null);
});

test('SALUDO: saludoForReferral arma { angle, saludo } completo', () => {
  const r = saludoForReferral({ adId: '120251614381940092' }, ENV);
  assert.deepEqual(r, { angle: 'fabrica', saludo: SALUDOS.fabrica });
});

test('SALUDO: killswitch CTWA_SALUDOS_DISABLED=true → null aunque haya match', () => {
  const env = { CTWA_SALUDOS_DISABLED: 'true' };
  assert.equal(saludoForReferral({ adId: '120251614379310092' }, env), null);
});

test('SALUDO: env CTWA_AD_ANGLE_MAP extiende el default (ads futuros sin deploy)', () => {
  const env = { CTWA_AD_ANGLE_MAP: '{"555":"precio"}' };
  assert.equal(detectAngle({ adId: '555' }, env), 'precio');
  // y el default sigue vivo (merge, no reemplazo)
  assert.equal(detectAngle({ adId: '120251614379310092' }, env), 'termico');
});

test('SALUDO: env CTWA_AD_ANGLE_MAP con JSON roto → se ignora, default sigue', () => {
  const env = { CTWA_AD_ANGLE_MAP: '{roto' };
  assert.equal(detectAngle({ adId: '120251614384990092' }, env), 'precio');
});

test('SALUDO: [tribunal] typo en el env sobre un ID de Ronda 1 NO apaga el saludo — cae al fallback por headline', () => {
  const env = { CTWA_AD_ANGLE_MAP: '{"120251614379310092":"termcio"}' }; // typo humano en Railway
  assert.equal(detectAngle({ adId: '120251614379310092', headline: '¿Sus ventanas lloran en invierno?' }, env), 'termico');
  // [Ronda 2 2026-07-20] sin headline rescatable, un ID que el DEFAULT conoce cae al
  // DEFAULT (antes: null → el typo apagaba ese anuncio). Un ad_id desconocido con typo
  // y sin headline sigue dando null limpio (nunca basura).
  assert.deepEqual(saludoForReferral({ adId: '120251614379310092' }, env),
    { angle: 'termico', saludo: SALUDOS.termico });
  assert.equal(saludoForReferral({ adId: '999888777' }, { CTWA_AD_ANGLE_MAP: '{"999888777":"termcio"}' }), null);
});

test('SALUDO: [tribunal] orden de patrones es load-bearing — doble match gana termico sobre fabrica', () => {
  assert.equal(detectAngle({ adId: '999', headline: 'Fabricamos ventanas que no lloran en invierno' }, ENV), 'termico');
});

test('SALUDO: [tribunal] claves heredadas del prototype jamás producen saludo', () => {
  assert.equal(saludoForAngle('constructor'), null);
  assert.equal(saludoForAngle('toString'), null);
  const env = { CTWA_AD_ANGLE_MAP: '{"666":"constructor"}' };
  assert.equal(saludoForReferral({ adId: '666' }, env), null);
});

test('SALUDO: los 3 IDs del default calzan con RUTA-ANUNCIOS (anti-typo)', () => {
  assert.deepEqual(Object.keys(DEFAULT_AD_ANGLE_MAP).sort(), [
    '120251614379310092', '120251614381940092', '120251614384990092',
  ]);
});

// [Ronda 2 2026-07-20] Un typo del env sobre un ad_id que el DEFAULT sí conoce ya no
// apaga el saludo de ese anuncio (antes el merge pisaba el default y, sin headline
// reconocible, terminaba en null — hallazgo de la revisión cruzada Codex).
test('SALUDO: typo del env sobre un ad_id del DEFAULT cae al default, no a null', () => {
  const env = { CTWA_AD_ANGLE_MAP: '{"120251614379310092":"termcio"}' };
  assert.equal(detectAngle({ adId: '120251614379310092', headline: '' }, env), 'termico');
});
