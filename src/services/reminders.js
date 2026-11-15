'use strict';

/**
 * Reminder engine – one idempotent "tick" that can be triggered by:
 *   - Google Cloud Scheduler → POST /api/cron/tick (recommended on Cloud Run)
 *   - the in-process interval (local dev / min-instances=1)
 *
 * Escalation ladder for each scheduled dose that has not been logged:
 *   T - 15 min  → "upcoming dose" email (elder)
 *   T + 30 min  → "did you miss it?" email (elder + caretakers)
 *   T + 90 min  → dose auto-marked MISSED, family & caretakers alerted
 * Plus: appointment reminders (24 h and 2 h before) and low-stock refill alerts.
 *
 * Every email has a deterministic key, so re-running a tick never duplicates.
 */

const { DateTime } = require('luxon');
const { COLLECTIONS } = require('../db');
const schedule = require('./schedule');
const logger = require('../utils/logger');

const C = COLLECTIONS;
const SYSTEM_ACTOR = Object.freeze({ memberId: 'system', name: 'CareCircle', role: 'system' });

class ReminderEngine {
  constructor({ store, care, email, config }) {
    this.store = store;
    this.care = care;
    this.email = email;
    this.config = config;
    this.running = false;
  }

  /** Recipient list for a notification category. */
  recipients(profile, members, category) {
    const emails = members.filter((m) => m.email && m.notify?.[category]).map((m) => m.email);
    const elderWants = ['upcoming', 'missed', 'appointments', 'refill'].includes(category);
    if (profile.elderEmail && elderWants) emails.push(profile.elderEmail);
    return [...new Set(emails.map((e) => e.toLowerCase()))];
  }

  async tick(nowUtc = DateTime.utc()) {
    if (this.running) return { skipped: true };
    this.running = true;
    const stats = { profiles: 0, upcoming: 0, missed: 0, escalated: 0, appointments: 0, refill: 0 };
    try {
      const profiles = await this.store.listAll(C.profiles);
      for (const profile of profiles) {
        stats.profiles += 1;
        try {
          await this.processProfile(profile, nowUtc, stats);
        } catch (err) {
          logger.error('reminders.profile_failed', { profileId: profile.id, error: err.message });
        }
      }
      logger.info('reminders.tick', stats);
      return stats;
    } finally {
      this.running = false;
    }
  }

  async processProfile(profile, nowUtc, stats) {
    const tz = profile.timezone;
    const now = nowUtc.setZone(tz);
    const [members, meds, appts, logs] = await Promise.all([
      this.store.listBy(C.members, 'profileId', profile.id),
      this.store.listBy(C.medications, 'profileId', profile.id),
      this.store.listBy(C.appointments, 'profileId', profile.id),
      this.care.logsById(profile.id),
    ]);
    const medById = new Map(meds.map((m) => [m.id, m]));
    const cta = this.config.publicUrl || undefined;
    const base = { profileId: profile.id, ctaUrl: cta, ctaLabel: 'Open CareCircle' };

    // ---- doses (yesterday + today, so late-night doses are handled)
    const doses = schedule
      .dosesInRange(meds, now.minus({ days: 1 }).toISODate(), now.toISODate(), tz)
      .filter((d) => this.care.countsForMed(d, medById));

    for (const dose of doses) {
      if (logs.has(dose.id)) continue;
      const med = medById.get(dose.medicationId);
      const mins = now.diff(dose.at, 'minutes').minutes; // negative = in the future
      const label = `${med.name}${med.dosage ? ` ${med.dosage}` : ''}`;
      const when = dose.at.toFormat('h:mm a');

      if (mins >= this.config.escalateAfterMin && mins < 24 * 60) {
        const created = await this.store.createIfAbsent(C.doses, {
          id: dose.id,
          profileId: profile.id,
          medicationId: med.id,
          scheduledFor: dose.at.toUTC().toISO(),
          status: 'missed',
          note: 'Automatically marked as missed',
          recordedBy: SYSTEM_ACTOR,
          recordedAt: nowUtc.toISO(),
          late: false,
        });
        if (created) await this.care.logActivity(profile.id, SYSTEM_ACTOR, 'dose.missed', `${label} at ${when} was missed`);
        const sent = await this.email.sendOnce({
          ...base,
          key: `escalate:${dose.id}`,
          type: 'escalation',
          to: this.recipients(profile, members, 'escalation').concat(this.recipients(profile, members, 'missed')),
          subject: `Missed medicine: ${profile.elderName} – ${med.name}`,
          heading: `${profile.elderName} missed a dose`,
          lines: [
            `${label} was due at ${when} and has not been marked as taken.`,
            'Please check in with a gentle call. If it has been taken, mark it in CareCircle.',
          ],
        });
        if (sent) stats.escalated += 1;
      } else if (mins >= this.config.missedGraceMin && mins < this.config.escalateAfterMin) {
        const sent = await this.email.sendOnce({
          ...base,
          key: `missed:${dose.id}`,
          type: 'missed',
          to: this.recipients(profile, members, 'missed'),
          subject: `Reminder: ${med.name} was due at ${when}`,
          heading: 'Did you take your medicine?',
          lines: [
            `${label} was due at ${when}.`,
            med.instructions ? `How to take it: ${med.instructions}` : 'Please take it now if your doctor allows a late dose.',
            'Then tap "I took it" in CareCircle so your family knows you are okay.',
          ],
        });
        if (sent) stats.missed += 1;
      } else if (mins < 0 && -mins <= this.config.upcomingWindowMin) {
        const sent = await this.email.sendOnce({
          ...base,
          key: `upcoming:${dose.id}`,
          type: 'upcoming',
          to: this.recipients(profile, members, 'upcoming'),
          subject: `Coming up at ${when}: ${med.name}`,
          heading: 'Medicine time soon',
          lines: [`It is almost time for ${label} (${when}).`, med.instructions ? `How to take it: ${med.instructions}` : ''].filter(Boolean),
        });
        if (sent) stats.upcoming += 1;
      }
    }

    // ---- appointments
    for (const appt of appts) {
      const at = DateTime.fromISO(appt.datetime, { zone: tz });
      const hours = at.diff(now, 'hours').hours;
      if (hours <= 0 || hours > 24) continue;
      const window = hours <= 2 ? '2h' : '24h';
      const decorated = this.care.decorateAppointment(appt, tz);
      const sent = await this.email.sendOnce({
        ...base,
        key: `appt${window}:${appt.id}`,
        type: 'appointment',
        to: this.recipients(profile, members, 'appointments'),
        subject: `${window === '2h' ? 'Soon' : 'Tomorrow'}: appointment with ${appt.doctor} at ${at.toFormat('h:mm a')}`,
        heading: 'Doctor appointment reminder',
        lines: [
          `${profile.elderName} has an appointment with ${appt.doctor}${appt.specialty ? ` (${appt.specialty})` : ''}.`,
          `When: ${at.toFormat('cccc d LLL, h:mm a')}`,
          appt.location ? `Where: ${appt.location} – ${decorated.mapsUrl}` : '',
          appt.notes ? `Notes: ${appt.notes}` : '',
          'Remember to carry previous prescriptions and reports.',
        ].filter(Boolean),
      });
      if (sent) stats.appointments += 1;
    }

    // ---- refills (at most once per medicine per day)
    for (const med of meds) {
      if (med.active === false || typeof med.pillsRemaining !== 'number') continue;
      if (med.pillsRemaining > (med.refillThreshold ?? 5)) continue;
      const sent = await this.email.sendOnce({
        ...base,
        key: `refill:${med.id}:${now.toISODate()}`,
        type: 'refill',
        to: this.recipients(profile, members, 'refill'),
        subject: `Refill needed: ${med.name} (${med.pillsRemaining} left)`,
        heading: 'Time to refill a medicine',
        lines: [`Only ${med.pillsRemaining} doses of ${med.name} are left for ${profile.elderName}.`, 'Please arrange a refill soon.'],
      });
      if (sent) stats.refill += 1;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error('reminders.tick_failed', { error: err.message }));
    }, this.config.schedulerIntervalMs);
    this.timer.unref();
    logger.info('reminders.scheduler_started', { intervalMs: this.config.schedulerIntervalMs });
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ReminderEngine, SYSTEM_ACTOR };
