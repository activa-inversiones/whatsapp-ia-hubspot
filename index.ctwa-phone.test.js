import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la captura CTWA legacy normaliza waId antes de construir el lead', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /buildCtwaLeadPayload\(normPhone\(waId\),\s*_ref,/,
    'el POST CTWA debe usar el mismo formato +56 de buildLeadPayload',
  );
});
