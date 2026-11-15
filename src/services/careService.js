'use strict';

/**
 * Core domain logic for a Care Circle (one elder + their caretakers & family).
 *
 * Elder-centred design principles enforced here:
 *  - The elder can switch on "my approval required": medication changes made by
 *    others become change requests that only the elder can approve or reject.
 *  - Only the elder can change circle settings, the passcode or remove members.
 *  - Every action is written to a transparent activity log everyone can read.
 */

const { DateTime } = require('luxon');
const { COLLECTIONS } = require('../db');
const { newId, newCircleCode } = require('../utils/ids');
const { hashPasscode, verifyPasscode } = require('./auth');
const schedule = require('./schedule');
const { calendarLink, mapsLink } = require('./googleLinks');
const { vitalFlags, streakFromDaily } = require('./vitals');
const { badRequest, forbidden, notFound, unauthorized } = require('../utils/errors');

const C = COLLECTIONS;

const DEFAULT_NOTIFY = Object.freeze({
  elder: { upcoming: true, missed: true, escalation: false, appointments: true, refill: true },
  caretaker: { upcoming: false, missed: true, escalation: true, appointments: true, refill: true },
  family: { upcoming: false, missed: false, escalation: true, appointments: true, refill: false },
});

const publicProfile = ({ passcodeHash, ...rest }) => rest; // never expose the hash
const actorOf = (m) => ({ memberId: m.id, name: m.name, role: m.role });

class CareService {
  constructor({ store, config, ai, email }) {
    this.store = store;
    this.config = config;
    this.ai = ai;
    this.email = email;
  }

  now() {
    return DateTime.utc();
  }

  // ---------------------------------------------------------------- circles

  async createCircle({ elderName, elderEmail, timezone, passcode, requireElderApproval, member }) {
    let id = newCircleCode();
    while (await this.store.get(C.profiles, id)) id = newCircleCode();

    const createdAt = new Date().toISOString();
    const profile = {
      id,
      elderName,
      elderEmail: elderEmail || '',
      timezone: timezone || this.config.defaultTimezone,
      requireElderApproval: Boolean(requireElderApproval),
      conditions: '',
      allergies: '',
      emergencyContact: '',
      passcodeHash: await hashPasscode(passcode),
      createdAt,
    };
    await this.store.create(C.profiles, profile);
    const created = await this.addMember(id, member);
    await this.logActivity(id, actorOf(created), 'circle.created', `Created the care circle for ${elderName}`);
    return { profile: publicProfile(profile), member: created };
  }

  async joinCircle(profileId, passcode, member) {
    const profile = await this.store.get(C.profiles, profileId);
    // Same error for unknown circle and wrong passcode: no circle enumeration.
    const ok = profile && (await verifyPasscode(passcode, profile.passcodeHash));
    if (!ok) throw unauthorized('Circle code or passcode is incorrect');

    const existing = (await this.store.listBy(C.members, 'profileId', profileId)).find(
      (m) => m.email && member.email && m.email.toLowerCase() === member.email.toLowerCase(),
    );
    if (existing) return { profile: publicProfile(profile), member: existing };

    const created = await this.addMember(profileId, member);
    await this.logActivity(profileId, actorOf(created), 'member.joined', `${created.name} joined as ${created.role}`);
    return { profile: publicProfile(profile), member: created };
  }

  async addMember(profileId, { name, email, role }) {
    const doc = {
      id: newId('m_'),
      profileId,
      name,
      email: email || '',
      role,
      notify: { ...DEFAULT_NOTIFY[role] },
      joinedAt: new Date().toISOString(),
    };
    await this.store.create(C.members, doc);
    return doc;
  }

  async getProfile(profileId) {
    const p = await this.store.get(C.profiles, profileId);
    if (!p) throw notFound('Care circle not found');
    return publicProfile(p);
  }

  async updateProfile(actor, profileId, patch) {
    const elderOnly = ['requireElderApproval', 'timezone', 'elderEmail', 'elderName'];
    if (actor.role !== 'elder' && elderOnly.some((k) => k in patch)) {
      throw forbidden('Only the elder can change these settings');
    }
    const updated = await this.store.update(C.profiles, profileId, patch);
    await this.logActivity(profileId, actor, 'profile.updated', `Updated profile: ${Object.keys(patch).join(', ')}`);
    return publicProfile(updated);
  }

  async changePasscode(actor, profileId, currentPasscode, newPasscode) {
    if (actor.role !== 'elder') throw forbidden('Only the elder can change the passcode');
    const p = await this.store.get(C.profiles, profileId);
    if (!(await verifyPasscode(currentPasscode, p.passcodeHash))) throw unauthorized('Current passcode is incorrect');
    await this.store.update(C.profiles, profileId, { passcodeHash: await hashPasscode(newPasscode) });
    await this.logActivity(profileId, actor, 'profile.passcode', 'Changed the circle passcode');
  }

  // ---------------------------------------------------------------- members

  async getMember(memberId) {
    return this.store.get(C.members, memberId);
  }

  async listMembers(profileId) {
    const members = await this.store.listBy(C.members, 'profileId', profileId);
    return members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  async updateNotify(actor, notify) {
    const member = await this.store.get(C.members, actor.memberId);
    const updated = await this.store.update(C.members, member.id, { notify: { ...member.notify, ...notify } });
    return updated;
  }

  async removeMember(actor, profileId, memberId) {
    if (actor.role !== 'elder' && actor.memberId !== memberId) {
      throw forbidden('Only the elder can remove other members');
    }
    const target = await this.store.get(C.members, memberId);
    if (!target || target.profileId !== profileId) throw notFound('Member not found');
    await this.store.delete(C.members, memberId);
    await this.logActivity(profileId, actor, 'member.removed', `Removed ${target.name} from the circle`);
  }

  // ------------------------------------------------------------ medications

  async listMedications(profileId) {
    const meds = await this.store.listBy(C.medications, 'profileId', profileId);
    return meds.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getMedication(profileId, medId) {
    const med = await this.store.get(C.medications, medId);
    if (!med || med.profileId !== profileId) throw notFound('Medication not found');
    return med;
  }

  /** Applies a medication change, or queues it for the elder's approval. */
  async requestMedicationChange(actor, profileId, action, payload, medId) {
    const target = medId ? await this.getMedication(profileId, medId) : null; // ownership check
    const profile = await this.store.get(C.profiles, profileId);
    if (profile.requireElderApproval && actor.role !== 'elder') {
      const request = {
        id: newId('cr_'),
        profileId,
        action,
        medId: medId || null,
        medName: payload?.name || target?.name || '',
        payload: payload || null,
        requestedBy: actor,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await this.store.create(C.changeRequests, request);
      await this.logActivity(profileId, actor, 'change.requested', `Asked to ${action} medication ${request.medName}`.trim());
      return { pending: true, request };
    }
    const result = await this.applyMedicationChange(actor, profileId, action, payload, medId);
    return { pending: false, medication: result };
  }

  async applyMedicationChange(actor, profileId, action, payload, medId) {
    if (action === 'create') {
      const med = {
        id: newId('med_'),
        profileId,
        ...payload,
        active: payload.active !== false,
        createdAt: new Date().toISOString(),
        createdBy: actor.name,
      };
      await this.store.create(C.medications, med);
      await this.logActivity(profileId, actor, 'med.created', `Added ${med.name} at ${med.times.join(', ')}`);
      return med;
    }
    if (action === 'update') {
      const med = await this.store.update(C.medications, medId, { ...payload, updatedAt: new Date().toISOString() });
      if (!med) throw notFound('Medication not found');
      await this.logActivity(profileId, actor, 'med.updated', `Updated ${med.name}`);
      return med;
    }
    if (action === 'delete') {
      const med = await this.store.get(C.medications, medId);
      if (!med) throw notFound('Medication not found');
      await this.store.delete(C.medications, medId);
      await this.logActivity(profileId, actor, 'med.deleted', `Removed ${med.name}`);
      return med;
    }
    throw badRequest('Unknown action');
  }

  async listChangeRequests(profileId) {
    const all = await this.store.listBy(C.changeRequests, 'profileId', profileId);
    return all.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async decideChangeRequest(actor, profileId, requestId, approve) {
    if (actor.role !== 'elder') throw forbidden('Only the elder can approve or reject changes');
    const req = await this.store.get(C.changeRequests, requestId);
    if (!req || req.profileId !== profileId) throw notFound('Change request not found');
    if (req.status !== 'pending') throw badRequest('This request was already decided');

    let medication = null;
    if (approve) {
      medication = await this.applyMedicationChange(req.requestedBy, profileId, req.action, req.payload, req.medId);
    }
    await this.store.update(C.changeRequests, requestId, {
      status: approve ? 'approved' : 'rejected',
      decidedAt: new Date().toISOString(),
    });
    await this.logActivity(
      profileId,
      actor,
      approve ? 'change.approved' : 'change.rejected',
      `${approve ? 'Approved' : 'Rejected'} ${req.requestedBy.name}'s request to ${req.action} ${req.medName || 'a medication'}`,
    );
    return { status: approve ? 'approved' : 'rejected', medication };
  }

  // ------------------------------------------------------------------ doses

  async logsById(profileId) {
    const logs = await this.store.listBy(C.doses, 'profileId', profileId);
    return new Map(logs.map((l) => [l.id, l]));
  }

  async todaySchedule(profileId) {
    const profile = await this.getProfile(profileId);
    const tz = profile.timezone;
    const now = this.now().setZone(tz);
    const today = now.toISODate();
    const [meds, logs] = await Promise.all([this.listMedications(profileId), this.logsById(profileId)]);
    const medById = new Map(meds.map((m) => [m.id, m]));
    const doses = schedule.dosesInRange(meds, today, today, tz).filter((d) => this.countsForMed(d, medById));

    return {
      date: today,
      timezone: tz,
      doses: doses.map((d) => {
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
          canLog: d.at.diff(now, 'minutes').minutes <= 120,
          recordedBy: log?.recordedBy?.name || null,
          recordedAt: log?.recordedAt || null,
        };
      }),
    };
  }

  /** Doses scheduled before a medication was added never count as missed. */
  countsForMed(dose, medById) {
    const med = medById.get(dose.medicationId);
    if (!med) return false;
    return !med.createdAt || dose.at.toMillis() >= DateTime.fromISO(med.createdAt).minus({ minutes: 60 }).toMillis();
  }

  async logDose(actor, profileId, doseKey, status, note) {
    const [medId, localStamp] = doseKey.split('__');
    if (!medId || !localStamp) throw badRequest('Invalid dose id');
    const med = await this.getMedication(profileId, medId);
    const profile = await this.getProfile(profileId);
    const [localDate, time] = localStamp.split('T');
    const dose = schedule.dosesForDay(med, localDate, profile.timezone).find((d) => d.time === time);
    if (!dose) throw badRequest('That dose is not on the schedule');
    if (dose.at.diff(this.now(), 'minutes').minutes > 120) throw badRequest('You cannot log a dose more than 2 hours early');

    const previous = await this.store.get(C.doses, dose.id);
    const log = {
      id: dose.id,
      profileId,
      medicationId: medId,
      scheduledFor: dose.at.toUTC().toISO(),
      status,
      note: note || '',
      recordedBy: actor,
      recordedAt: new Date().toISOString(),
      late: status === 'taken' && this.now().diff(dose.at, 'minutes').minutes > this.config.missedGraceMin,
    };
    await this.store.create(C.doses, log);

    // Pill count tracking for refill alerts (only on first "taken").
    if (status === 'taken' && previous?.status !== 'taken' && typeof med.pillsRemaining === 'number') {
      const perDose = med.pillsPerDose || 1;
      await this.store.update(C.medications, med.id, { pillsRemaining: Math.max(0, med.pillsRemaining - perDose) });
    }
    await this.logActivity(profileId, actor, `dose.${status}`, `Marked ${med.name} (${time}) as ${status}`);
    return log;
  }

  async adherenceReport(profileId, days = 7) {
    const profile = await this.getProfile(profileId);
    const tz = profile.timezone;
    const now = this.now().setZone(tz);
    const from = now.minus({ days: days - 1 }).toISODate();
    const to = now.toISODate();
    const [meds, logs] = await Promise.all([this.listMedications(profileId), this.logsById(profileId)]);
    const medById = new Map(meds.map((m) => [m.id, m]));
    const doses = schedule.dosesInRange(meds, from, to, tz).filter((d) => this.countsForMed(d, medById));
    const grace = this.config.missedGraceMin;

    const daily = [];
    for (let i = 0; i < days; i++) {
      const date = DateTime.fromISO(from, { zone: tz }).plus({ days: i }).toISODate();
      daily.push({ date, ...schedule.adherence(doses.filter((d) => d.localDate === date), logs, now, grace) });
    }
    const perMed = meds.map((m) => {
      const own = doses.filter((d) => d.medicationId === m.id);
      const a = schedule.adherence(own, logs, now, grace);
      return { medicationId: m.id, name: m.name, ...a, missed: a.expected - a.taken };
    });
    const streak = streakFromDaily(await this.dailyAdherence(meds, logs, tz, now, 30));
    return { from, to, overall: schedule.adherence(doses, logs, now, grace), daily, perMed, streak };
  }

  /** Per-day adherence over the last `days` days (oldest first). */
  async dailyAdherence(meds, logs, tz, now, days) {
    const from = now.minus({ days: days - 1 }).toISODate();
    const medById = new Map(meds.map((m) => [m.id, m]));
    const doses = schedule.dosesInRange(meds, from, now.toISODate(), tz).filter((d) => this.countsForMed(d, medById));
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = DateTime.fromISO(from, { zone: tz }).plus({ days: i }).toISODate();
      out.push({ date, ...schedule.adherence(doses.filter((d) => d.localDate === date), logs, now, this.config.missedGraceMin) });
    }
    return out;
  }

  // ----------------------------------------------------------- appointments

  decorateAppointment(appt, tz) {
    return { ...appt, calendarUrl: calendarLink(appt, tz), mapsUrl: mapsLink(appt.location) };
  }

  async listAppointments(profileId, { includePast = false } = {}) {
    const profile = await this.getProfile(profileId);
    const tz = profile.timezone;
    const cutoff = this.now().minus({ hours: 2 });
    const all = await this.store.listBy(C.appointments, 'profileId', profileId);
    return all
      .filter((a) => includePast || DateTime.fromISO(a.datetime, { zone: tz }) >= cutoff)
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .map((a) => this.decorateAppointment(a, tz));
  }

  async createAppointment(actor, profileId, data) {
    const profile = await this.getProfile(profileId);
    const appt = { id: newId('ap_'), profileId, ...data, createdBy: actor.name, createdAt: new Date().toISOString() };
    await this.store.create(C.appointments, appt);
    await this.logActivity(profileId, actor, 'appt.created', `Added appointment with ${appt.doctor} on ${appt.datetime.replace('T', ' ')}`);
    return this.decorateAppointment(appt, profile.timezone);
  }

  async updateAppointment(actor, profileId, id, patch) {
    const existing = await this.store.get(C.appointments, id);
    if (!existing || existing.profileId !== profileId) throw notFound('Appointment not found');
    const profile = await this.getProfile(profileId);
    const updated = await this.store.update(C.appointments, id, patch);
    await this.logActivity(profileId, actor, 'appt.updated', `Updated appointment with ${updated.doctor}`);
    return this.decorateAppointment(updated, profile.timezone);
  }

  async deleteAppointment(actor, profileId, id) {
    const existing = await this.store.get(C.appointments, id);
    if (!existing || existing.profileId !== profileId) throw notFound('Appointment not found');
    await this.store.delete(C.appointments, id);
    await this.logActivity(profileId, actor, 'appt.deleted', `Cancelled appointment with ${existing.doctor}`);
  }

  // ------------------------------------------------- check-ins, SOS, health card

  /** Emails of everyone in the circle except the given member (plus the elder's own address). */
  async circleEmails(profileId, { excludeMemberId, includeElder = true } = {}) {
    const [profile, members] = await Promise.all([this.getProfile(profileId), this.listMembers(profileId)]);
    const emails = members.filter((m) => m.email && m.id !== excludeMemberId && (includeElder || m.role !== 'elder')).map((m) => m.email);
    if (includeElder && profile.elderEmail) emails.push(profile.elderEmail);
    const excluded = members.find((m) => m.id === excludeMemberId)?.email?.toLowerCase();
    const unique = [...new Set(emails.map((e) => e.toLowerCase()))].filter((e) => e !== excluded);
    return { profile, emails: unique };
  }

  async addCheckin(actor, profileId, data) {
    const checkin = { id: newId('ck_'), profileId, ...data, by: actor, at: new Date().toISOString() };
    await this.store.create(C.checkins, checkin);
    const flags = vitalFlags(data);
    if (data.mood === 'unwell') flags.unshift('Said they are not feeling well');

    const readings = [
      data.systolic ? `BP ${data.systolic}/${data.diastolic}` : '',
      data.sugar ? `sugar ${data.sugar} mg/dL` : '',
    ].filter(Boolean).join(', ');
    await this.logActivity(profileId, actor, 'checkin.added', `Daily check-in: feeling ${data.mood}${readings ? ` (${readings})` : ''}`);

    let alerted = false;
    if (flags.length && this.email) {
      const { profile, emails } = await this.circleEmails(profileId, { includeElder: false });
      alerted = await this.email.sendOnce({
        key: `checkin:${checkin.id}`,
        profileId,
        type: 'health-alert',
        to: emails,
        subject: `Health alert for ${profile.elderName}`,
        heading: `${profile.elderName} may need attention`,
        lines: [...flags, data.note ? `Note: ${data.note}` : '', 'Please call to check in. If this is an emergency, call 108 or your local emergency number.'].filter(Boolean),
        ctaUrl: this.config.publicUrl || undefined,
      });
    }
    return { checkin, flags, alerted };
  }

  async listCheckins(profileId, limit = 14) {
    const all = await this.store.listBy(C.checkins, 'profileId', profileId);
    return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  /** "I need help" – emails everyone in the circle immediately. */
  async sendSos(actor, profileId, message) {
    const { profile, emails } = await this.circleEmails(profileId, { excludeMemberId: actor.memberId });
    const bucket = Math.floor(Date.now() / 120000); // collapse accidental double-presses (2 min)
    const sent = this.email
      ? await this.email.sendOnce({
        key: `sos:${profileId}:${actor.memberId}:${bucket}`,
        profileId,
        type: 'sos',
        to: emails,
        subject: `URGENT: ${actor.name} pressed "I need help"`,
        heading: `${actor.name} needs help`,
        lines: [
          `${actor.name} pressed the help button in ${profile.elderName}'s care circle at ${DateTime.now().setZone(profile.timezone).toFormat('h:mm a, d LLL')}.`,
          message ? `Message: ${message}` : '',
          profile.emergencyContact ? `Emergency contact: ${profile.emergencyContact}` : '',
          'Please call right away. In an emergency, call 108 or your local emergency number.',
        ].filter(Boolean),
        ctaUrl: this.config.publicUrl || undefined,
      })
      : false;
    await this.logActivity(profileId, actor, 'sos', `Pressed "I need help"${message ? `: ${message}` : ''}`);
    return { sent, recipients: emails.length };
  }

  /** One-page summary to show a doctor or share in an emergency. */
  async healthCard(profileId) {
    const [profile, meds, report, appts, checkins] = await Promise.all([
      this.getProfile(profileId),
      this.listMedications(profileId),
      this.adherenceReport(profileId, 30),
      this.listAppointments(profileId),
      this.listCheckins(profileId, 30),
    ]);
    const vitals = checkins.find((c) => c.systolic || c.sugar) || null;
    return {
      elderName: profile.elderName,
      conditions: profile.conditions || '',
      allergies: profile.allergies || '',
      emergencyContact: profile.emergencyContact || '',
      medications: meds.filter((m) => m.active !== false).map(({ name, dosage, times, instructions }) => ({ name, dosage: dosage || '', times, instructions: instructions || '' })),
      adherence30: report.overall.percent,
      perMed: report.perMed.map(({ name, percent, missed }) => ({ name, percent, missed })),
      latestVitals: vitals && { systolic: vitals.systolic, diastolic: vitals.diastolic, sugar: vitals.sugar, at: vitals.at },
      recentMoods: checkins.slice(0, 7).map((c) => ({ mood: c.mood, at: c.at })),
      nextAppointment: appts[0] ? { doctor: appts[0].doctor, specialty: appts[0].specialty || '', datetime: appts[0].datetime } : null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------- activity & misc

  async logActivity(profileId, actor, action, summary) {
    await this.store.create(C.activity, {
      id: newId('ac_'),
      profileId,
      actor,
      action,
      summary,
      at: new Date().toISOString(),
    });
  }

  async listActivity(profileId, limit = 50) {
    const items = await this.store.listBy(C.activity, 'profileId', profileId);
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  async listNotifications(profileId, limit = 30) {
    const items = await this.store.listBy(C.notifications, 'profileId', profileId);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async weeklySummary(profileId, lang = 'en') {
    const [profile, report, appts] = await Promise.all([
      this.getProfile(profileId),
      this.adherenceReport(profileId, 7),
      this.listAppointments(profileId),
    ]);
    return this.ai.careSummary({
      elderName: profile.elderName,
      overall: { percent: report.overall.percent },
      perMed: report.perMed.map(({ name, percent, missed }) => ({ name, percent, missed })),
      upcoming: appts.slice(0, 3).map((a) => ({ doctor: a.doctor, when: a.datetime.replace('T', ' ') })),
    }, lang);
  }

  async explainMedication(profileId, medId, lang = 'en') {
    const med = await this.getMedication(profileId, medId);
    return this.ai.explainMedication(med, lang);
  }
}

module.exports = { CareService, DEFAULT_NOTIFY, publicProfile };
