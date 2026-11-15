'use strict';

/** Constants and small helpers shared by the care-circle domain modules. */

const { COLLECTIONS } = require('../../db');
const { notFound } = require('../../utils/errors');

/** Default email preferences for each role when they join a circle. */
const DEFAULT_NOTIFY = Object.freeze({
  elder: { upcoming: true, missed: true, escalation: false, appointments: true, refill: true },
  caretaker: { upcoming: false, missed: true, escalation: true, appointments: true, refill: true },
  family: { upcoming: false, missed: false, escalation: true, appointments: true, refill: false },
});

/** Profile fields only the elder may change. */
const ELDER_ONLY_FIELDS = Object.freeze(['requireElderApproval', 'timezone', 'elderEmail', 'elderName']);

/** A dose can be recorded from this many minutes before it is due. */
const EARLY_LOG_MINUTES = 120;
/** Doses scheduled up to this long before a medicine was added still count (so adding at 8:05 keeps an 8:00 dose). */
const NEW_MED_GRACE_MINUTES = 60;
/** Visits stay in the "upcoming" list until this many hours after they start. */
const VISIT_VISIBLE_AFTER_HOURS = 2;
/** Repeated "I need help" presses inside this window send only one alert. */
const SOS_DEDUPE_MS = 2 * 60 * 1000;
/** Default sizes for lists shown in the app. */
const LIMITS = Object.freeze({ checkins: 14, activity: 50, notifications: 30, healthCardCheckins: 30 });

/** Returns a profile without its passcode hash, which must never leave the server. */
const publicProfile = (profile) => {
  const { passcodeHash: _omitted, ...rest } = profile;
  return rest;
};

/** The activity-log "actor" for a member. */
const actorOf = (member) => ({ memberId: member.id, name: member.name, role: member.role });

const nowIso = () => new Date().toISOString();

/**
 * Returns `doc` when it exists and belongs to the circle; otherwise throws 404.
 * Using one check everywhere means another circle's data is never reachable by id.
 */
function ownedBy(profileId, doc, label) {
  if (!doc || doc.profileId !== profileId) throw notFound(`${label} not found`);
  return doc;
}

/** Newest-first by a timestamp field, then the first `limit` items. */
const newestFirst = (items, field, limit) => items.sort((a, b) => b[field].localeCompare(a[field])).slice(0, limit);

module.exports = {
  C: COLLECTIONS,
  DEFAULT_NOTIFY,
  ELDER_ONLY_FIELDS,
  EARLY_LOG_MINUTES,
  NEW_MED_GRACE_MINUTES,
  VISIT_VISIBLE_AFTER_HOURS,
  SOS_DEDUPE_MS,
  LIMITS,
  publicProfile,
  actorOf,
  nowIso,
  ownedBy,
  newestFirst,
};
