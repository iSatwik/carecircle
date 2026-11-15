'use strict';

/** Daily check-ins with vital-sign alerts, "I need help", the health card and the weekly summary. */

const { DateTime } = require('luxon');
const { newId } = require('../../utils/ids');
const { vitalFlags } = require('../vitals');
const { C, LIMITS, SOS_DEDUPE_MS, newestFirst, nowIso } = require('./shared');

const EMERGENCY_LINE = 'If this is an emergency, call 108 or your local emergency number.';

/** "BP 130/85, sugar 110 mg/dL" for the activity log. */
const readingsText = (data) => [
  data.systolic ? `BP ${data.systolic}/${data.diastolic}` : '',
  data.sugar ? `sugar ${data.sugar} mg/dL` : '',
].filter(Boolean).join(', ');

const brief = ({ name, percent, missed }) => ({ name, percent, missed });

module.exports = {
  /**
   * Email addresses of everyone in the circle (plus the elder's own address),
   * without duplicates and without the excluded member.
   */
  async circleEmails(profileId, { excludeMemberId, includeElder = true } = {}) {
    const [profile, members] = await Promise.all([this.getProfile(profileId), this.listMembers(profileId)]);
    const emails = members
      .filter((m) => m.email && m.id !== excludeMemberId && (includeElder || m.role !== 'elder'))
      .map((m) => m.email);
    if (includeElder && profile.elderEmail) emails.push(profile.elderEmail);
    const excluded = members.find((m) => m.id === excludeMemberId)?.email?.toLowerCase();
    const unique = [...new Set(emails.map((e) => e.toLowerCase()))].filter((e) => e !== excluded);
    return { profile, emails: unique };
  },

  /**
   * Saves a check-in. Worrying readings or "not well" email the caretakers and family.
   * @returns {Promise<{ checkin: object, flags: string[], alerted: boolean }>}
   */
  async addCheckin(actor, profileId, data) {
    const checkin = { id: newId('ck_'), profileId, ...data, by: actor, at: nowIso() };
    await this.store.create(C.checkins, checkin);
    const flags = vitalFlags(data);
    if (data.mood === 'unwell') flags.unshift('Said they are not feeling well');

    const readings = readingsText(data);
    await this.logActivity(profileId, actor, 'checkin.added', `Daily check-in: feeling ${data.mood}${readings ? ` (${readings})` : ''}`);

    const alerted = flags.length > 0 && this.email ? await this.sendHealthAlert(profileId, checkin, flags) : false;
    return { checkin, flags, alerted };
  },

  async sendHealthAlert(profileId, checkin, flags) {
    const { profile, emails } = await this.circleEmails(profileId, { includeElder: false });
    return this.email.sendOnce({
      key: `checkin:${checkin.id}`,
      profileId,
      type: 'health-alert',
      to: emails,
      subject: `Health alert for ${profile.elderName}`,
      heading: `${profile.elderName} may need attention`,
      lines: [...flags, checkin.note ? `Note: ${checkin.note}` : '', `Please call to check in. ${EMERGENCY_LINE}`].filter(Boolean),
      ctaUrl: this.config.publicUrl || undefined,
    });
  },

  async listCheckins(profileId, limit = LIMITS.checkins) {
    return newestFirst(await this.store.listBy(C.checkins, 'profileId', profileId), 'at', limit);
  },

  /** "I need help": emails everyone else in the circle right away. */
  async sendSos(actor, profileId, message) {
    const { profile, emails } = await this.circleEmails(profileId, { excludeMemberId: actor.memberId });
    const bucket = Math.floor(Date.now() / SOS_DEDUPE_MS); // collapses accidental double presses
    const pressedAt = DateTime.now().setZone(profile.timezone).toFormat('h:mm a, d LLL');
    const sent = this.email
      ? await this.email.sendOnce({
        key: `sos:${profileId}:${actor.memberId}:${bucket}`,
        profileId,
        type: 'sos',
        to: emails,
        subject: `URGENT: ${actor.name} pressed "I need help"`,
        heading: `${actor.name} needs help`,
        lines: [
          `${actor.name} pressed the help button in ${profile.elderName}'s care circle at ${pressedAt}.`,
          message ? `Message: ${message}` : '',
          profile.emergencyContact ? `Emergency contact: ${profile.emergencyContact}` : '',
          'Please call right away. In an emergency, call 108 or your local emergency number.',
        ].filter(Boolean),
        ctaUrl: this.config.publicUrl || undefined,
      })
      : false;
    await this.logActivity(profileId, actor, 'sos', `Pressed "I need help"${message ? `: ${message}` : ''}`);
    return { sent, recipients: emails.length };
  },

  /** A one-page summary to show a doctor or share in an emergency. */
  async healthCard(profileId) {
    const [profile, meds, report, appts, checkins] = await Promise.all([
      this.getProfile(profileId),
      this.listMedications(profileId),
      this.adherenceReport(profileId, 30),
      this.listAppointments(profileId),
      this.listCheckins(profileId, LIMITS.healthCardCheckins),
    ]);
    const vitals = checkins.find((c) => c.systolic || c.sugar) || null;
    const next = appts[0];
    return {
      elderName: profile.elderName,
      conditions: profile.conditions || '',
      allergies: profile.allergies || '',
      emergencyContact: profile.emergencyContact || '',
      medications: meds
        .filter((m) => m.active !== false)
        .map(({ name, dosage, times, instructions }) => ({ name, dosage: dosage || '', times, instructions: instructions || '' })),
      adherence30: report.overall.percent,
      perMed: report.perMed.map(brief),
      latestVitals: vitals && { systolic: vitals.systolic, diastolic: vitals.diastolic, sugar: vitals.sugar, at: vitals.at },
      recentMoods: checkins.slice(0, 7).map((c) => ({ mood: c.mood, at: c.at })),
      nextAppointment: next ? { doctor: next.doctor, specialty: next.specialty || '', datetime: next.datetime } : null,
      generatedAt: nowIso(),
    };
  },

  /** A short, kind summary of the week for the family (Gemini when configured). */
  async weeklySummary(profileId, lang = 'en') {
    const [profile, report, appts] = await Promise.all([
      this.getProfile(profileId),
      this.adherenceReport(profileId, 7),
      this.listAppointments(profileId),
    ]);
    return this.ai.careSummary({
      elderName: profile.elderName,
      overall: { percent: report.overall.percent },
      perMed: report.perMed.map(brief),
      upcoming: appts.slice(0, 3).map((a) => ({ doctor: a.doctor, when: a.datetime.replace('T', ' ') })),
    }, lang);
  },
};
