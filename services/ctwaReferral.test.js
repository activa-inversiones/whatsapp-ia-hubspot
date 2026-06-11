// ctwaReferral.test.js — RED ANTI-REGRESIÓN — captura atribución CTWA
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReferral, buildCtwaLeadPayload } from './ctwaReferral.js';

test('CTWA: mensaje con referral de anuncio → isCtwaAd + ctwaClid + adId', () => {
  const msg = {
    from: '56999999999',
    referral: {
      source_url: 'https://fb.me/x', source_id: '120210000000', source_type: 'ad',
      headline: 'Ventanas PVC Temuco', body: 'Cotiza gratis', media_type: 'image',
      ctwa_clid: 'ARAbcd1234ClickId',
    },
  };
  const r = parseReferral(msg);
  assert.equal(r.isCtwaAd, true);
  assert.equal(r.ctwaClid, 'ARAbcd1234ClickId');
  assert.equal(r.adId, '120210000000');
  assert.equal(r.sourceType, 'ad');
  assert.equal(r.headline, 'Ventanas PVC Temuco');
});

test('CTWA: mensaje SIN referral → isCtwaAd false, todo null (no inventa)', () => {
  const r = parseReferral({ from: '569', text: { body: 'hola' } });
  assert.equal(r.isCtwaAd, false);
  assert.equal(r.ctwaClid, null);
  assert.equal(r.adId, null);
});

test('CTWA: referral sin ctwa_clid pero source_type ad + source_id → isCtwaAd true', () => {
  const r = parseReferral({ referral: { source_type: 'ad', source_id: '999' } });
  assert.equal(r.isCtwaAd, true);
  assert.equal(r.adId, '999');
  assert.equal(r.ctwaClid, null);
});

test('CTWA: referral de un post normal (no ad) sin clid → no es CTWA', () => {
  const r = parseReferral({ referral: { source_type: 'post', body: 'algo' } });
  assert.equal(r.isCtwaAd, false);
});

test('CTWA: maneja msg nulo/!objeto sin crashear', () => {
  assert.equal(parseReferral(null).isCtwaAd, false);
  assert.equal(parseReferral(undefined).isCtwaAd, false);
  assert.equal(parseReferral({}).isCtwaAd, false);
});

test('CTWA: buildCtwaLeadPayload arma el ingest con phone + ctwa_clid + ad_id + source', () => {
  const ref = parseReferral({ referral: { source_type: 'ad', source_id: '120', ctwa_clid: 'CLID9' } });
  const p = buildCtwaLeadPayload('56988887777', ref, { name: 'Dalia' });
  assert.equal(p.phone, '56988887777');
  assert.equal(p.ctwa_clid, 'CLID9');
  assert.equal(p.ad_id, '120');
  assert.equal(p.source, 'meta_ctwa');
  assert.equal(p.channel, 'whatsapp');
  assert.equal(p.ad_click_id_source, 'ctwa');
  assert.equal(p.name, 'Dalia');
});
