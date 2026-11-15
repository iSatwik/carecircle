'use strict';

const { request, buildApp, createCircle, join } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { vitalFlags, streakFromDaily } = require('../src/services/vitals');

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

test('vitalFlags only warns on clearly worrying readings', () => {
  assert.deepEqual(vitalFlags({ systolic: 128, diastolic: 82, sugar: 140 }), []);
  assert.match(vitalFlags({ systolic: 190, diastolic: 100 })[0], /Very high blood pressure/);
  assert.match(vitalFlags({ systolic: 120, diastolic: 115 })[0], /Very high blood pressure/);
  assert.match(vitalFlags({ systolic: 85, diastolic: 55 })[0], /Low blood pressure/);
  assert.match(vitalFlags({ sugar: 60 })[0], /Low blood sugar/);
  assert.match(vitalFlags({ sugar: 350 })[0], /Very high blood sugar/);
  assert.deepEqual(vitalFlags(), []);
});

test('streak counts full days and ignores an unfinished today', () => {
  const d = (expected, taken) => ({ expected, taken });
  assert.equal(streakFromDaily([d(2, 2), d(2, 1), d(2, 2), d(0, 0), d(3, 3), d(2, 1)]), 2);
  assert.equal(streakFromDaily([d(2, 2), d(2, 2), d(2, 2)]), 3);
  assert.equal(streakFromDaily([d(2, 1)]), 0);
  assert.equal(streakFromDaily([]), 0);
});

test('check-ins are stored, logged and alert the family when worrying', async () => {
  const ctx = buildApp();
  const elder = await createCircle(ctx);
  await join(ctx, elder.code, { role: 'family', email: 'ravi@example.com' });

  const ok = await request(ctx.app).post('/api/circle/checkins').set(bearer(elder.token)).send({ mood: 'good', systolic: 126, diastolic: 80 });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.flags, []);
  assert.equal(ok.body.alerted, false);

  const bad = await request(ctx.app).post('/api/circle/checkins').set(bearer(elder.token)).send({ mood: 'unwell', sugar: 55, note: 'Dizzy' });
  assert.equal(bad.body.alerted, true);
  assert.equal(bad.body.flags.length, 2);

  const outbox = await request(ctx.app).get('/api/circle/notifications').set(bearer(elder.token));
  const alert = outbox.body.find((n) => n.type === 'health-alert');
  assert.ok(alert.to.includes('ravi@example.com'));
  assert.ok(!alert.to.includes('kamala@example.com'), 'the elder is not alerted about themselves');

  const list = await request(ctx.app).get('/api/circle/checkins').set(bearer(elder.token));
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].mood, 'unwell');

  const invalid = await request(ctx.app).post('/api/circle/checkins').set(bearer(elder.token)).send({ mood: 'good', systolic: 120 });
  assert.equal(invalid.status, 400, 'both BP numbers are required together');
});

test('"I need help" emails everyone else once, even on double press', async () => {
  const ctx = buildApp();
  const elder = await createCircle(ctx);
  await join(ctx, elder.code, { role: 'caretaker', name: 'Asha', email: 'asha@example.com' });
  await join(ctx, elder.code, { role: 'family', name: 'Ravi', email: 'ravi@example.com' });

  const first = await request(ctx.app).post('/api/circle/sos').set(bearer(elder.token)).send({ message: 'Fell in the bathroom' });
  assert.equal(first.status, 200);
  assert.equal(first.body.sent, true);
  assert.equal(first.body.recipients, 2);
  const second = await request(ctx.app).post('/api/circle/sos').set(bearer(elder.token)).send({});
  assert.equal(second.body.sent, false);

  const outbox = await request(ctx.app).get('/api/circle/notifications').set(bearer(elder.token));
  const sos = outbox.body.filter((n) => n.type === 'sos');
  assert.equal(sos.length, 1);
  assert.deepEqual(sos[0].to.sort(), ['asha@example.com', 'ravi@example.com']);
  assert.match(sos[0].text, /Fell in the bathroom/);
});

test('health card summarises profile, medicines, adherence and vitals', async () => {
  const ctx = buildApp();
  const { token } = await createCircle(ctx);
  await request(ctx.app).patch('/api/circle').set(bearer(token)).send({ conditions: 'Diabetes', allergies: 'Penicillin' });
  await request(ctx.app).post('/api/circle/medications').set(bearer(token)).send({ name: 'Metformin', dosage: '500 mg', times: ['08:00'] });
  await request(ctx.app).post('/api/circle/checkins').set(bearer(token)).send({ mood: 'okay', sugar: 150 });

  const card = await request(ctx.app).get('/api/circle/health-card').set(bearer(token));
  assert.equal(card.status, 200);
  assert.equal(card.body.elderName, 'Kamala Devi');
  assert.equal(card.body.allergies, 'Penicillin');
  assert.equal(card.body.medications[0].name, 'Metformin');
  assert.equal(card.body.latestVitals.sugar, 150);
  assert.equal(card.body.recentMoods[0].mood, 'okay');

  const adherence = await request(ctx.app).get('/api/circle/adherence').set(bearer(token));
  assert.equal(typeof adherence.body.streak, 'number');
});
