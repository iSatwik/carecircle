'use strict';

const { request, createCircle } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { MemoryStore } = require('../src/db/memoryStore');
const { TtsService } = require('../src/services/tts');
const { AiService } = require('../src/services/ai');

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('TTS uses a Chirp 3 HD voice in the chosen language and caches audio', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return ok({ audioContent: 'QUJD' }); };
  const tts = new TtsService({ enabled: true, apiKey: 'k' }, { fetchImpl });
  const a = await tts.synthesize('నమస్కారం', 'te');
  const b = await tts.synthesize('నమస్కారం', 'te');
  assert.deepEqual(a, { audio: 'QUJD', mime: 'audio/mpeg' });
  assert.equal(b, a);
  assert.equal(calls.length, 1, 'second call served from cache');
  assert.equal(calls[0].url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
  assert.deepEqual(calls[0].body.voice, { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Aoede' });
  assert.equal(calls[0].headers['x-goog-api-key'], 'k');
});

test('TTS falls back to the default voice when a voice name is rejected', async () => {
  const voices = [];
  const fetchImpl = async (_url, opts) => {
    const { voice } = JSON.parse(opts.body);
    voices.push(voice);
    return voice.name ? { ok: false, status: 400 } : ok({ audioContent: 'WFla' });
  };
  const tts = new TtsService({ enabled: true, apiKey: 'k' }, { fetchImpl });
  assert.equal((await tts.synthesize('Hello', 'hi')).audio, 'WFla');
  assert.deepEqual(voices[1], { languageCode: 'hi-IN' });
});

test('TTS pauses after a permission error and uses the service-account token without a key', async () => {
  let tokenAsked = 0;
  const fetchImpl = async (_url, opts) => {
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    return { ok: false, status: 403 };
  };
  const tts = new TtsService({ enabled: true, apiKey: '' }, { fetchImpl, getToken: async () => { tokenAsked += 1; return 'tok'; } });
  assert.equal(await tts.synthesize('Hello', 'en'), null);
  assert.equal(tokenAsked, 1);
  assert.equal(tts.enabled, false, 'backs off instead of retrying a disabled API');
  assert.equal(await tts.synthesize('Hello again', 'en'), null);
});

test('/speak returns audio when available and 204 so the browser voice can take over', async () => {
  const fakeTts = { enabled: true, synthesize: async (text, lang) => (lang === 'hi' ? { audio: 'AAA', mime: 'audio/mpeg' } : null) };
  const ctx = createApp({ store: new MemoryStore(), tts: fakeTts, config: { cronSecret: 'x' } });
  const { token } = await createCircle(ctx);
  const hi = await request(ctx.app).post('/api/circle/speak').set(bearer(token)).send({ text: 'नमस्ते', lang: 'hi' });
  assert.equal(hi.status, 200);
  assert.equal(hi.body.audio, 'AAA');
  const en = await request(ctx.app).post('/api/circle/speak').set(bearer(token)).send({ text: 'Hello' });
  assert.equal(en.status, 204);
  const bad = await request(ctx.app).post('/api/circle/speak').set(bearer(token)).send({ text: 'Hi', lang: 'fr' });
  assert.equal(bad.status, 400);
  const anon = await request(ctx.app).post('/api/circle/speak').send({ text: 'Hi' });
  assert.equal(anon.status, 401);
  const cfg = await request(ctx.app).get('/api/config');
  assert.deepEqual(cfg.body.languages, ['en', 'hi', 'te']);
  assert.equal(cfg.body.ttsEnabled, true);
});

test('Gemini is asked to answer in the chosen language', async () => {
  let prompt = '';
  const fetchImpl = async (_url, opts) => {
    prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    return ok({ candidates: [{ content: { parts: [{ text: '- మధుమేహం కోసం' }] } }] });
  };
  const ai = new AiService({ apiKey: 'k', model: 'm', timeoutMs: 1000 }, fetchImpl);
  const res = await ai.explainMedication({ name: 'Metformin' }, 'te');
  assert.equal(res.source, 'gemini');
  assert.match(prompt, /Reply in simple Telugu/);
  await ai.careSummary({ elderName: 'K', overall: { percent: 90 }, perMed: [], upcoming: [] }, 'hi');
  assert.match(prompt, /Reply in simple Hindi/);
});

test('explain endpoint passes the language through and ignores unknown ones', async () => {
  const seen = [];
  const fakeAi = { enabled: false, explainMedication: async (_m, lang) => { seen.push(lang); return { source: 'fallback', text: 'x', disclaimer: 'd' }; }, careSummary: async () => ({}) };
  const ctx = createApp({ store: new MemoryStore(), ai: fakeAi, config: { cronSecret: 'x' } });
  const { token } = await createCircle(ctx);
  const med = await request(ctx.app).post('/api/circle/medications').set(bearer(token)).send({ name: 'Aspirin', times: ['09:00'] });
  await request(ctx.app).get(`/api/circle/medications/${med.body.medication.id}/explain?lang=hi`).set(bearer(token));
  await request(ctx.app).get(`/api/circle/medications/${med.body.medication.id}/explain?lang=xx`).set(bearer(token));
  assert.deepEqual(seen, ['hi', 'en']);
});
