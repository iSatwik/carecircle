'use strict';

/** Today's doses, recording a dose, and adherence (how many doses were taken). */

const { DateTime } = require('luxon');
const schedule = require('../schedule');
const { streakFromDaily } = require('../vitals');
const { badRequest } = require('../../utils/errors');
const { C, EARLY_LOG_MINUTES, NEW_MED_GRACE_MINUTES, nowIso } = require('./shared');

/** Days of history used for the "days in a row" streak. */
const STREAK_DAYS = 30;

module.exports = {
  /** All dose records of a circle, keyed by dose id. */
  async logsById(profileId) {
    const logs = await this.store.listBy(C.doses, 'profileId', profileId);
    return new Map(logs.map((l) => [l.id, l]));
  },

  /** Doses scheduled before a medicine was added never count as missed. */
  countsForMed(dose, medById) {
    const med = medById.get(dose.medicationId);
    if (!med) return false;
    if (!med.createdAt) return true;
    const countsFrom = DateTime.fromISO(med.createdAt).minus({ minutes: NEW_MED_GRACE_MINUTES });
    return dose.at.toMillis() >= countsFrom.toMillis();
  },

  /** Scheduled doses between two local dates (inclusive) that count for adherence. */
  scheduledDoses(meds, from, to, tz) {
    const medById = new Map(meds.map((m) => [m.id, m]));
    return schedule.dosesInRange(meds, from, to, tz).filter((d) => this.countsForMed(d, medById));
  },

  /** Today's doses with their status, who recorded them and whether they can be recorded yet. */
  async todaySchedule(profileId) {
    const { timezone: tz } = await this.getProfile(profileId);
    const now = this.now().setZone(tz);
    const today = now.toISODate();
    const [meds, logs] = await Promise.all([this.listMedications(profileId), this.logsById(profileId)]);
    const medById = new Map(meds.map((m) => [m.id, m]));

    const doses = this.scheduledDoses(meds, today, today, tz).map((d) => {
      const med = medById.get(d.medicationId);
      const log = logs.get(d.id);
      return {
        id: d.id,
        medicationId: d.medicationId,
        name: med.name,
        dosage: med.dosage || '',
        instructions: med.instructions || '',
        time: d.time,
        status: schedule.doseStatus(d, log, now, this.config.missedGraceMin),
        canLog: d.at.diff(now, 'minutes').minutes <= EARLY_LOG_MINUTES,
        recordedBy: log?.recordedBy?.name || null,
        recordedAt: log?.recordedAt || null,
      };
    });
    return { date: today, timezone: tz, doses };
  },

  /**
   * Records a dose as taken or skipped. The first "taken" also lowers the pill count,
   * which drives refill alerts.
   * @param {string} doseKey `<medicationId>__<YYYY-MM-DD>T<HH:mm>`
   */
  async logDose(actor, profileId, doseKey, status, note) {
    const [medId, localStamp] = doseKey.split('__');
    if (!medId || !localStamp) throw badRequest('Invalid dose id');
    const med = await this.getMedication(profileId, medId);
    const profile = await this.getProfile(profileId);
    const [localDate, time] = localStamp.split('T');
    const dose = schedule.dosesForDay(med, localDate, profile.timezone).find((d) => d.time === time);
    if (!dose) throw badRequest('That dose is not on the schedule');
    if (dose.at.diff(this.now(), 'minutes').minutes > EARLY_LOG_MINUTES) {
      throw badRequest('You cannot log a dose more than 2 hours early');
    }

    const previous = await this.store.get(C.doses, dose.id);
    const log = {
      id: dose.id,
      profileId,
      medicationId: medId,
      scheduledFor: dose.at.toUTC().toISO(),
      status,
      note: note || '',
      recordedBy: actor,
      recordedAt: nowIso(),
      late: status === 'taken' && this.now().diff(dose.at, 'minutes').minutes > this.config.missedGraceMin,
    };
    await this.store.create(C.doses, log);

    const firstTaken = status === 'taken' && previous?.status !== 'taken';
    if (firstTaken && typeof med.pillsRemaining === 'number') {
      const perDose = med.pillsPerDose || 1;
      await this.store.update(C.medications, med.id, { pillsRemaining: Math.max(0, med.pillsRemaining - perDose) });
    }
    await this.logActivity(profileId, actor, `dose.${status}`, `Marked ${med.name} (${time}) as ${status}`);
    return log;
  },

  /**
   * Adherence for the last `days` days: overall, per day, per medicine, and the
   * current streak of days with every dose taken.
   */
  async adherenceReport(profileId, days = 7) {
    const { timezone: tz } = await this.getProfile(profileId);
    const now = this.now().setZone(tz);
    const from = now.minus({ days: days - 1 }).toISODate();
    const to = now.toISODate();
    const [meds, logs] = await Promise.all([this.listMedications(profileId), this.logsById(profileId)]);
    const doses = this.scheduledDoses(meds, from, to, tz);
    const adherenceOf = (list) => schedule.adherence(list, logs, now, this.config.missedGraceMin);

    const perMed = meds.map((m) => {
      const a = adherenceOf(doses.filter((d) => d.medicationId === m.id));
      return { medicationId: m.id, name: m.name, ...a, missed: a.expected - a.taken };
    });
    const history = this.dailyAdherence(meds, logs, tz, now, Math.max(days, STREAK_DAYS));
    return {
      from,
      to,
      overall: adherenceOf(doses),
      daily: history.slice(-days),
      perMed,
      streak: streakFromDaily(history.slice(-STREAK_DAYS)),
    };
  },

  /** Per-day adherence over the last `days` days, oldest first. */
  dailyAdherence(meds, logs, tz, now, days) {
    const from = now.minus({ days: days - 1 }).toISODate();
    const doses = this.scheduledDoses(meds, from, now.toISODate(), tz);
    const start = DateTime.fromISO(from, { zone: tz });
    return Array.from({ length: days }, (_, i) => {
      const date = start.plus({ days: i }).toISODate();
      const ofDay = doses.filter((d) => d.localDate === date);
      return { date, ...schedule.adherence(ofDay, logs, now, this.config.missedGraceMin) };
    });
  },
};
