// 🛡️ [2026-10-06] Decision del dueño (opcion A): la correccion ya entregada sale con letra (0598-B) Y con la franja
// «reemplaza a la N° 0598», para que el cliente no se quede con la version mas barata que se llama casi igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leyendaReemplaza, generatePremiumQuotePdf } from './quotePdf.js';

test('🛡️ la leyenda nombra el folio que reemplaza; sin folio previo, nada', () => {
  assert.match(leyendaReemplaza({ reemplaza_a: 'CM-FR-004-2026-0598' }), /REEMPLAZA A LA N° CM-FR-004-2026-0598/);
  assert.equal(leyendaReemplaza({}), '');
});

test('🛡️ el PDF con reemplaza_a se genera (la franja no rompe el documento)', async () => {
  const buf = await generatePremiumQuotePdf({ client_name: 'X', comuna: 'Temuco', reemplaza_a: 'CM-FR-004-2026-0598',
    items: [{ product: 'Fijo S60', measures: '1000x1000', color: 'Blanco', qty: 1, unit_price: 100000 }] }, 'CM-FR-004-2026-0598-B');
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
});
