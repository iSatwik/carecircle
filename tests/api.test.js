'use strict';

const { request, buildApp, createCircle, join } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

test('health check and security headers', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).get('/healthz');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-security-policy'].includes("default-src 'self'"));
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('serves the accessible front end', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /<html lang="en">/);
  assert.match(res.text, /Skip to main content/);
});

test('create circle never leaks the passcode hash', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).post('/api/circles').send({
    elderName: 'Kamala', passcode: 'secret123', member: { name: 'Kamala', role: 'elder' },
  });
  assert.equal(res.status, 201);
  assert.match(res.body.profile.id, /^CC-[A-Z0-9]{6}$/);
  assert.equal(res.body.profile.passcodeHash, undefined);
  assert.ok(res.body.token);
});

test('rejects invalid input with field details', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).post('/api/circles').send({ elderName: '', passcode: '123', member: { name: 'x', role: 'admin' } });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.details));
  const bad = await request(ctx.app).post('/api/circles').set('Content-Type', 'application/json').send('{"oops"');
  assert.equal(bad.status, 400);
});

test('join requires the right passcode and gives the same error for unknown circles', async () => {
  const ctx = buildApp();
  const { code } = await createCircle(ctx);
  const wrong = await join(ctx, code, { passcode: 'nottheone' });
  const unknown = await join(ctx, 'CC-ZZZZZZ');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, unknown.body.error);
  const ok = await join(ctx, code);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.member.role, 'family');
  const again = await join(ctx, code);
  assert.equal(again.body.member.id, ok.body.member.id, 'rejoining with the same email reuses the member');
});

test('protected routes require a valid token', async () => {
  const ctx = buildApp();
  assert.equal((await request(ctx.app).get('/api/circle/today')).status, 401);
  assert.equal((await request(ctx.app).get('/api/circle/today').set(bearer('bad.token.here'))).status, 401);
});

test('members can never read another circle', async () => {
  const ctx = buildApp();
  const a = await createCircle(ctx);
  const b = await createCircle(ctx);
  const med = await request(ctx.app).post('/api/circle/medications').set(bearer(a.token)).send({ name: 'Aspirin', times: ['09:00'] });
  assert.equal(med.status, 201);
  const fromB = await request(ctx.app).patch(`/api/circle/medications/${med.body.medication.id}`).set(bearer(b.token)).send({ dosage: '1' });
  assert.equal(fromB.status, 404);
  const listB = await request(ctx.app).get('/api/circle/medications').set(bearer(b.token));
  assert.deepEqual(listB.body, []);
});

test('medication CRUD, AI explanation fallback and activity log', async () => {
  const ctx = buildApp();
  const { token } = await createCircle(ctx);
  const created = await request(ctx.app).post('/api/circle/medications').set(bearer(token))
    .send({ name: 'Metformin', dosage: '500 mg', times: ['20:00', '08:00', '08:00'], pillsRemaining: 10 });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.medication.times, ['08:00', '20:00'], 'times are de-duplicated and sorted');

  const id = created.body.medication.id;
  const updated = await request(ctx.app).patch(`/api/circle/medications/${id}`).set(bearer(token)).send({ instructions: 'After food' });
  assert.equal(updated.body.medication.instructions, 'After food');

  const explain = await request(ctx.app).get(`/api/circle/medications/${id}/explain`).set(bearer(token));
  assert.equal(explain.status, 200);
  assert.equal(explain.body.source, 'fallback');
  assert.match(explain.body.disclaimer, /not medical advice/);

  const bad = await request(ctx.app).post('/api/circle/medications').set(bearer(token)).send({ name: 'X', times: ['25:00'] });
  assert.equal(bad.status, 400);

  const del = await request(ctx.app).delete(`/api/circle/medications/${id}`).set(bearer(token));
  assert.equal(del.status, 200);
  const activity = await request(ctx.app).get('/api/circle/activity').set(bearer(token));
  assert.ok(activity.body.some((a) => a.action === 'med.created'));
  assert.ok(activity.body.some((a) => a.action === 'med.deleted'));
});

test('elder approval: family changes wait for the elder', async () => {
  const ctx = buildApp();
  const elder = await createCircle(ctx, { requireElderApproval: true });
  const fam = (await join(ctx, elder.code)).body;

  const proposed = await request(ctx.app).post('/api/circle/medications').set(bearer(fam.token)).send({ name: 'Aspirin', times: ['09:00'] });
  assert.equal(proposed.status, 202);
  assert.equal(proposed.body.pending, true);
  assert.equal((await request(ctx.app).get('/api/circle/medications').set(bearer(elder.token))).body.length, 0);

  const changes = await request(ctx.app).get('/api/circle/changes').set(bearer(fam.token));
  assert.equal(changes.body.length, 1);

  const famDecide = await request(ctx.app).post(`/api/circle/changes/${changes.body[0].id}/decision`).set(bearer(fam.token)).send({ approve: true });
  assert.equal(famDecide.status, 403, 'only the elder may decide');

  const approved = await request(ctx.app).post(`/api/circle/changes/${changes.body[0].id}/decision`).set(bearer(elder.token)).send({ approve: true });
  assert.equal(approved.body.status, 'approved');
  assert.equal((await request(ctx.app).get('/api/circle/medications').set(bearer(elder.token))).body.length, 1);

  const twice = await request(ctx.app).post(`/api/circle/changes/${changes.body[0].id}/decision`).set(bearer(elder.token)).send({ approve: false });
  assert.equal(twice.status, 400);
});

test('only the elder can change approval settings, passcode and remove others', async () => {
  const ctx = buildApp();
  const elder = await createCircle(ctx);
  const fam = (await join(ctx, elder.code)).body;
  const r1 = await request(ctx.app).patch('/api/circle').set(bearer(fam.token)).send({ requireElderApproval: false });
  assert.equal(r1.status, 403);
  const r2 = await request(ctx.app).patch('/api/circle').set(bearer(fam.token)).send({ allergies: 'Penicillin' });
  assert.equal(r2.status, 200);
  const r3 = await request(ctx.app).post('/api/circle/passcode').set(bearer(fam.token)).send({ currentPasscode: 'secret123', newPasscode: 'newsecret1' });
  assert.equal(r3.status, 403);
  const r4 = await request(ctx.app).delete(`/api/circle/members/${elder.member.id}`).set(bearer(fam.token));
  assert.equal(r4.status, 403);

  const r5 = await request(ctx.app).delete(`/api/circle/members/${fam.member.id}`).set(bearer(elder.token));
  assert.equal(r5.status, 204);
  const afterRemoval = await request(ctx.app).get('/api/me').set(bearer(fam.token));
  assert.equal(afterRemoval.status, 401, 'removed members lose access immediately');

  const r6 = await request(ctx.app).post('/api/circle/passcode').set(bearer(elder.token)).send({ currentPasscode: 'secret123', newPasscode: 'newsecret1' });
  assert.equal(r6.status, 204);
  assert.equal((await join(ctx, elder.code, { passcode: 'secret123' })).status, 401);
  assert.equal((await join(ctx, elder.code, { passcode: 'newsecret1' })).status, 200);
});

test('logging doses updates today, adherence and pill count', async () => {
  const ctx = buildApp();
  const { token } = await createCircle(ctx);
  const nowIst = DateTime.now().setZone('Asia/Kolkata').toFormat('HH:mm');
  const med = await request(ctx.app).post('/api/circle/medications').set(bearer(token))
    .send({ name: 'Vitamin D', times: [nowIst], pillsRemaining: 3 });
  const today = await request(ctx.app).get('/api/circle/today').set(bearer(token));
  assert.equal(today.body.doses.length, 1);
  const dose = today.body.doses[0];
  assert.equal(dose.status, 'due');
  assert.equal(dose.canLog, true);

  const logged = await request(ctx.app).post(`/api/circle/doses/${encodeURIComponent(dose.id)}`).set(bearer(token)).send({ status: 'taken' });
  assert.equal(logged.status, 200);
  await request(ctx.app).post(`/api/circle/doses/${encodeURIComponent(dose.id)}`).set(bearer(token)).send({ status: 'taken' });

  const meds = await request(ctx.app).get('/api/circle/medications').set(bearer(token));
  assert.equal(meds.body.find((m) => m.id === med.body.medication.id).pillsRemaining, 2, 'double-tap only decrements once');

  const after = await request(ctx.app).get('/api/circle/today').set(bearer(token));
  assert.equal(after.body.doses[0].status, 'taken');
  const adherence = await request(ctx.app).get('/api/circle/adherence?days=7').set(bearer(token));
  assert.equal(adherence.body.overall.percent, 100);
  assert.equal(adherence.body.daily.length, 7);

  const badId = await request(ctx.app).post('/api/circle/doses/nonsense').set(bearer(token)).send({ status: 'taken' });
  assert.equal(badId.status, 400);
  const badRange = await request(ctx.app).get('/api/circle/adherence?days=99').set(bearer(token));
  assert.equal(badRange.status, 400);
});

test('appointments include Google Calendar and Maps links', async () => {
  const ctx = buildApp();
  const { token } = await createCircle(ctx);
  const res = await request(ctx.app).post('/api/circle/appointments').set(bearer(token))
    .send({ doctor: 'Dr. Rao', specialty: 'Cardiology', datetime: '2099-01-10T11:00', location: 'Apollo Hospital, Hyderabad' });
  assert.equal(res.status, 201);
  assert.match(res.body.calendarUrl, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(res.body.calendarUrl, /20990110T053000Z/); // 11:00 IST in UTC
  assert.match(res.body.mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\//);

  const list = await request(ctx.app).get('/api/circle/appointments').set(bearer(token));
  assert.equal(list.body.length, 1);
  const upd = await request(ctx.app).patch(`/api/circle/appointments/${res.body.id}`).set(bearer(token)).send({ notes: 'Carry ECG' });
  assert.equal(upd.body.notes, 'Carry ECG');
  assert.equal((await request(ctx.app).delete(`/api/circle/appointments/${res.body.id}`).set(bearer(token))).status, 204);
});

test('weekly summary works without Gemini configured', async () => {
  const ctx = buildApp();
  const { token } = await createCircle(ctx);
  const res = await request(ctx.app).get('/api/circle/summary').set(bearer(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'fallback');
  assert.match(res.body.text, /Kamala Devi/);
});

test('cron endpoint requires the shared secret', async () => {
  const ctx = buildApp();
  assert.equal((await request(ctx.app).post('/api/cron/tick')).status, 401);
  assert.equal((await request(ctx.app).post('/api/cron/tick').set('X-Cron-Secret', 'nope')).status, 401);
  const ok = await request(ctx.app).post('/api/cron/tick').set('X-Cron-Secret', 'test-cron-secret');
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.profiles, 'number');
});

test('unknown API routes return JSON 404', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Not found');
});
