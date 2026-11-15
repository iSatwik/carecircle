'use strict';

/** Doctor visits, each with a Google Calendar link and (when it has a place) a Google Maps link. */

const { DateTime } = require('luxon');
const { newId } = require('../../utils/ids');
const { calendarLink, mapsLink } = require('../googleLinks');
const { C, VISIT_VISIBLE_AFTER_HOURS, nowIso, ownedBy } = require('./shared');

module.exports = {
  /** Adds the Google Calendar and Maps links to a stored visit. */
  decorateAppointment(appt, tz) {
    return { ...appt, calendarUrl: calendarLink(appt, tz), mapsUrl: mapsLink(appt.location) };
  },

  /** Visits in date order; past visits are hidden a couple of hours after they start. */
  async listAppointments(profileId, { includePast = false } = {}) {
    const { timezone: tz } = await this.getProfile(profileId);
    const cutoff = this.now().minus({ hours: VISIT_VISIBLE_AFTER_HOURS });
    const all = await this.store.listBy(C.appointments, 'profileId', profileId);
    return all
      .filter((a) => includePast || DateTime.fromISO(a.datetime, { zone: tz }) >= cutoff)
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .map((a) => this.decorateAppointment(a, tz));
  },

  async createAppointment(actor, profileId, data) {
    const { timezone } = await this.getProfile(profileId);
    const appt = { id: newId('ap_'), profileId, ...data, createdBy: actor.name, createdAt: nowIso() };
    await this.store.create(C.appointments, appt);
    await this.logActivity(profileId, actor, 'appt.created', `Added appointment with ${appt.doctor} on ${appt.datetime.replace('T', ' ')}`);
    return this.decorateAppointment(appt, timezone);
  },

  async updateAppointment(actor, profileId, id, patch) {
    ownedBy(profileId, await this.store.get(C.appointments, id), 'Appointment');
    const { timezone } = await this.getProfile(profileId);
    const updated = await this.store.update(C.appointments, id, patch);
    await this.logActivity(profileId, actor, 'appt.updated', `Updated appointment with ${updated.doctor}`);
    return this.decorateAppointment(updated, timezone);
  },

  async deleteAppointment(actor, profileId, id) {
    const existing = ownedBy(profileId, await this.store.get(C.appointments, id), 'Appointment');
    await this.store.delete(C.appointments, id);
    await this.logActivity(profileId, actor, 'appt.deleted', `Cancelled appointment with ${existing.doctor}`);
  },
};
