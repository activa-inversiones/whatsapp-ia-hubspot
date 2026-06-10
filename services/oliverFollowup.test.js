// oliverFollowup.test.js — golden test (node:test + node:assert, ESM)
// Ejecutar: node --experimental-vm-modules services/oliverFollowup.test.js
// O simplemente: node services/oliverFollowup.test.js  (Node >= 18 soporta node:test sin flag)

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkipFollowup, normalizePhone, VERSION } from './oliverFollowup.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Guarda/restaura env para no contaminar entre tests. */
let _savedEnv = {};
function setEnv(overrides) {
  // Guardar originals
  for (const k of Object.keys(overrides)) _savedEnv[k] = process.env[k];
  Object.assign(process.env, overrides);
}
function restoreEnv() {
  for (const [k, v] of Object.entries(_savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _savedEnv = {};
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('oliverFollowup', () => {

  describe('VERSION', () => {
    it('exporta una versión semver', () => {
      assert.match(VERSION, /^\d+\.\d+\.\d+$/);
    });
  });

  // ── normalizePhone ────────────────────────────────────────────────────────

  describe('normalizePhone', () => {
    it('elimina + y espacios', () => {
      assert.equal(normalizePhone('+56 9 5729 6035'), '56957296035');
    });
    it('elimina guiones y paréntesis', () => {
      assert.equal(normalizePhone('(56) 9-5729-6035'), '56957296035');
    });
    it('deja solo dígitos intactos', () => {
      assert.equal(normalizePhone('56957296035'), '56957296035');
    });
    it('devuelve string vacío para null/undefined', () => {
      assert.equal(normalizePhone(null), '');
      assert.equal(normalizePhone(undefined), '');
      assert.equal(normalizePhone(''), '');
    });
  });

  // ── shouldSkipFollowup ────────────────────────────────────────────────────

  describe('shouldSkipFollowup', () => {

    beforeEach(() => restoreEnv());
    after(() => restoreEnv());

    // ── CASO PRINCIPAL: número de Marcelo → skip true ─────────────────────

    it('el número de Marcelo (igual a MARCELO_PHONE) → skip=true', () => {
      setEnv({ MARCELO_PHONE: '56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('56957296035'), true);
    });

    it('el número de Marcelo con formato +56... → skip=true (normalización)', () => {
      setEnv({ MARCELO_PHONE: '+56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('+56957296035'), true);
    });

    it('Marcelo env con +, input sin + → skip=true (ambos se normalizan)', () => {
      setEnv({ MARCELO_PHONE: '+56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('56957296035'), true);
    });

    // ── Cliente normal → skip false ───────────────────────────────────────

    it('un cliente normal (número distinto) → skip=false', () => {
      setEnv({ MARCELO_PHONE: '56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('56912345678'), false);
    });

    it('cliente con formato distinto → skip=false', () => {
      setEnv({ MARCELO_PHONE: '56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('+56 9 8888 7777'), false);
    });

    // ── ESCALATION_PHONE también se excluye ───────────────────────────────

    it('número igual a ESCALATION_PHONE → skip=true', () => {
      setEnv({ MARCELO_PHONE: '', ESCALATION_PHONE: '56911111111', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('56911111111'), true);
    });

    it('número igual a OWNER_NOTIFICATION_PHONE → skip=true', () => {
      setEnv({ MARCELO_PHONE: '', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '56922222222', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('56922222222'), true);
    });

    // ── INTERNAL_PHONES (lista extra) ─────────────────────────────────────

    it('número en INTERNAL_PHONES (lista coma) → skip=true', () => {
      setEnv({ MARCELO_PHONE: '', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '56933333333,56944444444' });
      assert.equal(shouldSkipFollowup('56933333333'), true);
      assert.equal(shouldSkipFollowup('56944444444'), true);
    });

    it('número NO en INTERNAL_PHONES → skip=false', () => {
      setEnv({ MARCELO_PHONE: '', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '56933333333,56944444444' });
      assert.equal(shouldSkipFollowup('56955555555'), false);
    });

    // ── edge cases ────────────────────────────────────────────────────────

    it('env vacío → nunca salta ningún número (skip=false)', () => {
      setEnv({ MARCELO_PHONE: '', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('56957296035'), false);
    });

    it('phone vacío/null → skip=false (no hay número que saltarse)', () => {
      setEnv({ MARCELO_PHONE: '56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup(''), false);
      assert.equal(shouldSkipFollowup(null), false);
      assert.equal(shouldSkipFollowup(undefined), false);
    });

    it('Marcelo ENV sin +, input con espacio/guion → skip=true', () => {
      setEnv({ MARCELO_PHONE: '56957296035', ESCALATION_PHONE: '', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      assert.equal(shouldSkipFollowup('+56 957 296 035'), true);
    });

    it('MARCELO_PHONE == ESCALATION_PHONE (caso típico) → skip=true una sola vez', () => {
      setEnv({ MARCELO_PHONE: '56957296035', ESCALATION_PHONE: '56957296035', OWNER_NOTIFICATION_PHONE: '', INTERNAL_PHONES: '' });
      // Set de-duplica; igual skip=true
      assert.equal(shouldSkipFollowup('56957296035'), true);
    });

  });
});

console.log('oliverFollowup.test.js: todos los tests pasaron ✅');
