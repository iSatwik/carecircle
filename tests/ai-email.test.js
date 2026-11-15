'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AiService } = require('../src/services/ai');
const { EmailService, escapeHtml, renderHtml } = require('../src/services/email');
const { MemoryStore } = require('../src/db/memoryStore');

const med = { name: 'Metformin', dosage: '500 mg', instructions: 'After food' };

test('AI falls back gracefully when Gemini is not configured', async () => {
  const ai = new AiService({ apiKey: '' });
  assert.equal(ai.enabled, false);
  const r = await ai.explainMedication(med);
  assert.equal(r.source, 'fallback');
  assert.match(r.text, /Metformin/);
});

test('AI calls Gemini with the key in a header and caches results', async () => {
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls += 1;
    assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-test:generateContent$/);
    assert.equal(opts.headers['x-goog-api-key'], 'k');
    assert.ok(!url.includes('key='), 'API key must not be in the URL');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '- Helps control blood sugar' }] } }] }) };
  };
  const ai = new AiService({ apiKey: 'k', model: 'gemini-test', timeoutMs: 1000 }, fakeFetch);
  const a = await ai.explainMedication(med);
  const b = await ai.explainMedication(med);
  assert.equal(a.source, 'gemini');
  assert.equal(b.text, a.text);
  assert.equal(calls, 1);
});

test('AI failure returns the deterministic fallback summary', async () => {
  const ai = new AiService({ apiKey: 'k', model: 'm', timeoutMs: 1000 }, async () => ({ ok: false, status: 500 }));
  const r = await ai.careSummary({
    elderName: 'Kamala',
    overall: { percent: 80 },
    perMed: [{ name: 'Aspirin', percent: 60, missed: 2 }],
    upcoming: [{ doctor: 'Dr. Rao', when: '2026-11-17 11:00' }],
  });
  assert.equal(r.source, 'fallback');
  assert.match(r.text, /80%/);
  assert.match(r.text, /Aspirin \(2 missed\)/);
  assert.match(r.text, /Dr\. Rao/);
});

test('email HTML escapes user content', () => {
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  const html = renderHtml({ heading: '<b>Hi</b>', lines: ['<img src=x onerror=alert(1)>'] });
  assert.ok(!html.includes('<img src=x'));
});

test('outbox mode records once per key and skips empty recipients', async () => {
  const store = new MemoryStore();
  const email = new EmailService({ store, smtp: {} });
  assert.equal(email.mode, 'outbox');
  const msg = { key: 'k1', profileId: 'p', type: 't', to: ['a@x.com', 'a@x.com'], subject: 's', heading: 'h', lines: ['l'] };
  assert.equal(await email.sendOnce(msg), true);
  assert.equal(await email.sendOnce(msg), false);
  assert.equal(await email.sendOnce({ ...msg, key: 'k2', to: [] }), false);
  const [rec] = await store.listAll('notifications');
  assert.deepEqual(rec.to, ['a@x.com']);
  assert.equal(rec.status, 'recorded');
});
