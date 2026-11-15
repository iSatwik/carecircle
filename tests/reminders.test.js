'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const config = require('../src/config');
const { MemoryStore } = require('../src/db/memoryStore');
const { COLLECTIONS: C } = require('../src/db');
const { CareService } = require('../src/services/careService');
const { EmailService } = require('../src/services/email');
const { AiService } = require('../src/services/ai');
const { ReminderEngine } = require('../src/services/reminders');

const TZ = 'Asia/Kolkata';
const ist = (iso) => DateTime.fromISO(iso, { zone: TZ }).toUTC();

async function setup() {
  const store = new MemoryStore();
  const ai = new AiService({ apiKey: '' });
  const care = new CareService({ store, config, ai });
  const email = new EmailService({ store, smtp: {} });
  const engine = new ReminderEngine({ store, care, email, config });

  await store.create(C.profiles, { id: 'CC-TEST01', elderName: 'Kamala', elderEmail: 'kamala@example.com', timezone: TZ });
  await store.create(C.members, {
    id: 'm_fam', profileId: 'CC-TEST01', name: 'Ravi', email: 'ravi@example.com', role: 'family',
    notify: { upcoming: false, missed: false, escalation: true, appointments: true, refill: false },
  });
  await store.create(C.members, {
    id: 'm_care', profileId: 'CC-TEST01', name: 'Asha', email: 'asha@example.com', role: 'caretaker',
    notify: { upcoming: false, missed: true, escalation: true, appointments: true, refill: true },
  });
  await store.create(C.medications, {
    id: 'med_1', profileId: 'CC-TEST01', name: 'Metformin', dosage: '500 mg', times: ['08:00'],
    active: true, createdAt: '2026-11-01T00:00:00.000Z', pillsRemaining: 20, refillThreshold: 5,
  });
  const outbox = async () => (await store.listAll(C.notifications)).sort((a, b) => a.id.localeCompare(b.id));
  return { store, engine, outbox };
}

test('sends an upcoming-dose email to the elder 15 minutes before', async () => {
  const { engine, outbox } = await setup();
  const stats = await engine.tick(ist('2026-11-15T07:50'));
  assert.equal(stats.upcoming, 1);
  const mail = (await outbox()).find((m) => m.type === 'upcoming');
  assert.equal(mail.id, 'upcoming:med_1__2026-11-15T08:00');
  assert.deepEqual(mail.to, ['kamala@example.com']);
});

test('reminds elder + caretaker after the grace period, without duplicates', async () => {
  const { engine, outbox } = await setup();
  await engine.tick(ist('2026-11-15T08:35'));
  await engine.tick(ist('2026-11-15T08:40'));
  const mails = (await outbox()).filter((m) => m.type === 'missed');
  assert.equal(mails.length, 1, 'idempotent across ticks');
  assert.deepEqual(mails[0].to.sort(), ['asha@example.com', 'kamala@example.com']);
});

test('escalates to family and auto-marks the dose missed after 90 minutes', async () => {
  const { engine, store, outbox } = await setup();
  const stats = await engine.tick(ist('2026-11-15T09:35'));
  assert.equal(stats.escalated, 1);
  const log = await store.get(C.doses, 'med_1__2026-11-15T08:00');
  assert.equal(log.status, 'missed');
  assert.equal(log.recordedBy.role, 'system');
  const esc = (await outbox()).find((m) => m.type === 'escalation');
  assert.ok(esc.to.includes('ravi@example.com'));
  const activity = await store.listAll(C.activity);
  assert.equal(activity.filter((a) => a.action === 'dose.missed').length, 1);
});

test('no reminders once the dose is logged as taken', async () => {
  const { engine, store, outbox } = await setup();
  await store.create(C.doses, { id: 'med_1__2026-11-15T08:00', profileId: 'CC-TEST01', status: 'taken' });
  await engine.tick(ist('2026-11-15T09:35'));
  assert.equal((await outbox()).filter((m) => m.type !== 'refill').length, 0);
});

test('doses scheduled before the medicine was added are ignored', async () => {
  const { engine, store, outbox } = await setup();
  await store.update(C.medications, 'med_1', { createdAt: ist('2026-11-15T12:00').toISO() });
  await engine.tick(ist('2026-11-15T12:05'));
  assert.equal((await outbox()).length, 0);
});

test('appointment reminders fire 24h and 2h before', async () => {
  const { engine, store, outbox } = await setup();
  await store.create(C.appointments, { id: 'ap_1', profileId: 'CC-TEST01', doctor: 'Dr. Rao', datetime: '2026-11-16T11:00', location: 'Apollo' });
  await engine.tick(ist('2026-11-15T12:00'));
  await engine.tick(ist('2026-11-16T09:30'));
  const appts = (await outbox()).filter((m) => m.type === 'appointment');
  assert.deepEqual(appts.map((a) => a.id).sort(), ['appt24h:ap_1', 'appt2h:ap_1']);
  assert.ok(appts[0].to.includes('ravi@example.com'));
});

test('low stock triggers one refill alert per day', async () => {
  const { engine, store, outbox } = await setup();
  await store.update(C.medications, 'med_1', { pillsRemaining: 3 });
  await engine.tick(ist('2026-11-15T12:00'));
  await engine.tick(ist('2026-11-15T13:00'));
  const refills = (await outbox()).filter((m) => m.type === 'refill');
  assert.equal(refills.length, 1);
  assert.ok(refills[0].to.includes('asha@example.com'));
  assert.ok(!refills[0].to.includes('ravi@example.com'));
});
