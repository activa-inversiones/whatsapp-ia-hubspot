import { test } from 'node:test';
import assert from 'node:assert/strict';

test('el webhook v2 reutiliza parseReferral y convierte el referral CTWA en state', async () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  try {
    const agent = await import('./agent.js');
    assert.equal(typeof agent.referralStateFromBody, 'function');

    const state = agent.referralStateFromBody({
      entry: [{ changes: [{ value: { messages: [{
        referral: {
          source_type: 'ad',
          source_id: 'ad-v2',
          ctwa_clid: 'ctwa-v2',
        },
      }] } }] }],
    });

    assert.deepEqual(state, { ctwa_clid: 'ctwa-v2', ad_id: 'ad-v2' });
  } finally {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});
