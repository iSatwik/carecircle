'use strict';

/** Unit tests for the care-service building blocks and the reminder ladder's timing. */

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const config = require('../src/config');
const { MemoryStore } = require('../src/db/memoryStore');
const { CareService, publicProfile } = require('../src/services/careService');
const { ReminderEngine } = require('../src/services/reminders');
const { ownedBy, newestFirst, DEFAULT_NOTIFY } = require('../src/services/care/shared');
const { AiService } = require('../src/services/ai');

const makeCare = () => new CareService({ store: new MemoryStore(), config, ai: new AiService({ apiKey: '' }) });

test('CareService exposes every domain operation exactly once', () => {
  const care = makeCare();
  const expected = [
    'createCircle', 'joinCircle', 'addMember', 'getProfile', 'updateProfile', 'changePasscode', 'listMembers', 'removeMember',
    'listMedications', 'requestMedicationChange', 'applyMedicationChange', 'decideChangeRequest', 'explainMedication',
    'todaySchedule', 'logDose', 'adherenceReport', 'listAppointments', 'createAppointment', 'updateAppointment', 'deleteAppointment',
    'addCheckin', 'sendSos', 'healthCard', 'weeklySummary', 'logActivity', 'listActivity', 'listNotifications',
  ];
  for (const name of expected) assert.equal(typeof care[name], 'function', name);
});

test('publicProfile never returns the passcode hash', () => {
  const out = publicProfile({ id: 'CC-1', elderName: 'Kamala', passcodeHash: 'scrypt$secret' });
  assert.deepEqual(out, { id: 'CC-1', elderName: 'Kamala' });
});

test('ownedBy hides records that belong to another circle', () => {
  const doc = { id: 'med_1', profileId: 'CC-A' };
  assert.equal(ownedBy('CC-A', doc, 'Medication'), doc);
  assert.throws(() => ownedBy('CC-B', doc, 'Medication'), { status: 404, message: 'Medication not found' });
  assert.throws(() => ownedBy('CC-A', null, 'Medication'), { status: 404 });
});

test('newestFirst sorts by timestamp and limits the list', () => {
  const items = [{ at: '2026-01-01' }, { at: '2026-03-01' }, { at: '2026-02-01' }];
  assert.deepEqual(newestFirst(items, 'at', 2).map((i) => i.at), ['2026-03-01', '2026-02-01']);
});

test('family members are not emailed about routine doses by default', () => {
  assert.equal(DEFAULT_NOTIFY.family.upcoming, false);
  assert.equal(DEFAULT_NOTIFY.family.escalation, true);
  assert.equal(DEFAULT_NOTIFY.elder.upcoming, true);
});

test('reminder ladder: upcoming at T-15, gentle reminder at T+30, escalation at T+90', () => {
  const engine = new ReminderEngine({ store: null, care: null, email: null, config });
  const { upcomingWindowMin, missedGraceMin, escalateAfterMin } = config;
  assert.equal(engine.doseStage(-(upcomingWindowMin + 1)), null, 'too early');
  assert.equal(engine.doseStage(-upcomingWindowMin), 'upcoming');
  assert.equal(engine.doseStage(-1), 'upcoming');
  assert.equal(engine.doseStage(0), null, 'on time: nothing to send yet');
  assert.equal(engine.doseStage(missedGraceMin - 1), null);
  assert.equal(engine.doseStage(missedGraceMin), 'missed');
  assert.equal(engine.doseStage(escalateAfterMin - 1), 'missed');
  assert.equal(engine.doseStage(escalateAfterMin), 'escalate');
  assert.equal(engine.doseStage(24 * 60), null, 'older than a day is left alone');
});

test('a medicine added at 8:05 still counts its 8:00 dose, but not doses from earlier days', async () => {
  const care = makeCare();
  const med = { id: 'med_1', createdAt: '2026-11-10T02:35:00.000Z' }; // 8:05 IST
  const medById = new Map([[med.id, med]]);
  const at = (iso) => ({ medicationId: 'med_1', at: DateTime.fromISO(iso, { zone: 'Asia/Kolkata' }) });
  assert.equal(care.countsForMed(at('2026-11-10T08:00'), medById), true);
  assert.equal(care.countsForMed(at('2026-11-09T20:00'), medById), false);
  assert.equal(care.countsForMed({ medicationId: 'gone', at: DateTime.utc() }, medById), false);
});
