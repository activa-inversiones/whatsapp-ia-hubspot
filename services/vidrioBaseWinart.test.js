// 🛡️ GUARDIA DE DECISIÓN (2026-10-06). Regla del dueño, textual: *"los vidrios modificados en
// winart o agregados deben estar en el motor de activa asi podremos cotizar porque esos son los
// precios que ya estan validados ... esos son los termopaneles base que usaremos"*.
// Los termopaneles base son los «Propio» de Winart: 1607 (4+12+4) · 1608 (5+12+5) · 1609 (satén).
// Antes eran 34/61/38: copias MANUALES que el sync de Winart no actualiza ⇒ un precio cambiado en
// Winart nunca llegaba a la cotización. Si este test falla, alguien volvió a esas copias:
// NO se da vuelta sin una orden nueva del dueño.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.GLASS_ID_STD; delete process.env.GLASS_ID_LARGE; delete process.env.GLASS_ID_BANO;
const { pickGlassId } = await import('./enginePricer.js');
const { ALLOWED_GLASS_IDS } = await import('../src/oliver-gpt/engine-client.js');

test('🛡️ Oliver cotiza con los vidrios «Propio» de Winart, no con las copias manuales', () => {
  assert.equal(pickGlassId(1000, 1000, ''), 1607, '< 2 m² ⇒ 4+12+4 de Winart');
  assert.equal(pickGlassId(2000, 1500, ''), 1608, '≥ 2 m² ⇒ 5+12+5 de Winart');
  assert.equal(pickGlassId(2000, 1000, ''), 1608, 'justo 2,0 m² ⇒ 5+12+5 (el umbral es ≥)');
  assert.equal(pickGlassId(600, 600, 'WC'), 1609, 'WC ⇒ satén');
  assert.equal(pickGlassId(600, 600, 'baño'), 1609, 'baño ⇒ satén de Winart');
  for (const id of [1607, 1608, 1609]) assert.ok(ALLOWED_GLASS_IDS.includes(id), `allowlist sin ${id}`);
});
