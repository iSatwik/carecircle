'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const schedule = require('../src/services/schedule');

const TZ = 'Asia/Kolkata';
const med = { id: 'med1', name: 'Metformin', times: ['20:00', '08:00'], active: true };

test('dosesForDay returns sorted doses in the elder timezone', () => {
  const doses = schedule.dosesForDay(med, '2026-11-15', TZ);
  assert.deepEqual(doses.map((d) => d.time), ['08:00', '20:00']);
  assert.equal(doses[0].id, 'med1__2026-11-15T08:00');
  assert.equal(doses[0].at.toUTC().toISO(), '2026-11-15T02:30:00.000Z');
});

test('respects start date, end date, inactive flag and weekdays', () => {
  assert.equal(schedule.dosesForDay({ ...med, startDate: '2026-11-16' }, '2026-11-15', TZ).length, 0);
  assert.equal(schedule.dosesForDay({ ...med, endDate: '2026-11-14' }, '2026-11-15', TZ).length, 0);
  assert.equal(schedule.dosesForDay({ ...med, active: false }, '2026-11-15', TZ).length, 0);
  // 2026-11-15 is a Sunday (weekday 7)
  assert.equal(schedule.dosesForDay({ ...med, daysOfWeek: [1, 3] }, '2026-11-15', TZ).length, 0);
  assert.equal(schedule.dosesForDay({ ...med, daysOfWeek: [7] }, '2026-11-15', TZ).length, 2);
});

test('dosesInRange spans multiple days in order', () => {
  const doses = schedule.dosesInRange([med], '2026-11-14', '2026-11-15', TZ);
  assert.equal(doses.length, 4);
  assert.ok(doses.every((d, i) => i === 0 || d.at >= doses[i - 1].at));
});

test('doseStatus classifies by time and log', () => {
  const [dose] = schedule.dosesForDay(med, '2026-11-15', TZ);
  const at = (h, m) => DateTime.fromISO(`2026-11-15T${h}:${m}`, { zone: TZ });
  assert.equal(schedule.doseStatus(dose, null, at('06', '00'), 30), 'upcoming');
  assert.equal(schedule.doseStatus(dose, null, at('07', '45'), 30), 'due');
  assert.equal(schedule.doseStatus(dose, null, at('08', '20'), 30), 'due');
  assert.equal(schedule.doseStatus(dose, null, at('08', '45'), 30), 'overdue');
  assert.equal(schedule.doseStatus(dose, { status: 'taken' }, at('08', '45'), 30), 'taken');
});

test('adherence ignores doses still inside the grace window', () => {
  const doses = schedule.dosesForDay(med, '2026-11-15', TZ);
  const now = DateTime.fromISO('2026-11-15T20:10', { zone: TZ });
  const logs = new Map([[doses[0].id, { status: 'taken' }]]);
  assert.deepEqual(schedule.adherence(doses, logs, now, 30), { expected: 1, taken: 1, percent: 100 });
  const later = now.plus({ hours: 1 });
  assert.deepEqual(schedule.adherence(doses, logs, later, 30), { expected: 2, taken: 1, percent: 50 });
  assert.equal(schedule.adherence([], logs, now, 30).percent, null);
});
