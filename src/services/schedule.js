'use strict';

/**
 * Pure scheduling helpers: turn a medication's recurring schedule into
 * concrete dose instants, in the elder's own timezone.
 * Kept free of I/O so it is trivially unit-testable.
 */

const { DateTime } = require('luxon');

/** Deterministic dose ID: logging the same dose twice is idempotent. */
const doseId = (medicationId, localDate, time) => `${medicationId}__${localDate}T${time}`;

function isActiveOn(med, localDate) {
  if (med.active === false) return false;
  if (med.startDate && localDate < med.startDate) return false;
  if (med.endDate && localDate > med.endDate) return false;
  if (Array.isArray(med.daysOfWeek) && med.daysOfWeek.length > 0) {
    const weekday = DateTime.fromISO(localDate).weekday; // 1 = Monday … 7 = Sunday
    if (!med.daysOfWeek.includes(weekday)) return false;
  }
  return true;
}

/**
 * Doses scheduled on one local calendar day.
 * @returns {{id:string, medicationId:string, localDate:string, time:string, at:DateTime}[]}
 */
function dosesForDay(med, localDate, timezone) {
  if (!isActiveOn(med, localDate)) return [];
  return [...(med.times || [])].sort().map((time) => {
    const at = DateTime.fromISO(`${localDate}T${time}`, { zone: timezone });
    return { id: doseId(med.id, localDate, time), medicationId: med.id, localDate, time, at };
  });
}

/** All doses for a list of medications across [fromDate, toDate] (inclusive, local dates). */
function dosesInRange(meds, fromDate, toDate, timezone) {
  const out = [];
  let day = DateTime.fromISO(fromDate, { zone: timezone });
  const end = DateTime.fromISO(toDate, { zone: timezone });
  while (day <= end) {
    const iso = day.toISODate();
    for (const med of meds) out.push(...dosesForDay(med, iso, timezone));
    day = day.plus({ days: 1 });
  }
  return out.sort((a, b) => a.at.toMillis() - b.at.toMillis());
}

/**
 * Classifies a dose for display.
 * taken | skipped | missed (logged) take precedence; otherwise derive from time.
 */
function doseStatus(dose, log, now, graceMin) {
  if (log && log.status) return log.status;
  const minutesLate = now.diff(dose.at, 'minutes').minutes;
  if (minutesLate > graceMin) return 'overdue';
  if (minutesLate >= -30) return 'due';
  return 'upcoming';
}

/**
 * Adherence = taken / (doses whose time has passed), over the given doses.
 * Doses still within their grace window are not counted against the elder.
 */
function adherence(doses, logsById, now, graceMin) {
  let expected = 0;
  let taken = 0;
  for (const d of doses) {
    const log = logsById.get(d.id);
    const settled = log || now.diff(d.at, 'minutes').minutes > graceMin;
    if (!settled) continue;
    expected += 1;
    if (log && log.status === 'taken') taken += 1;
  }
  return { expected, taken, percent: expected === 0 ? null : Math.round((taken / expected) * 100) };
}

module.exports = { doseId, isActiveOn, dosesForDay, dosesInRange, doseStatus, adherence };
