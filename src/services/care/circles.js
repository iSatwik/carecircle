'use strict';

/**
 * Circles and members. Only the elder can change circle settings, the passcode
 * or remove other members; anyone can leave.
 */

const { newId, newCircleCode } = require('../../utils/ids');
const { hashPasscode, verifyPasscode } = require('../auth');
const { forbidden, notFound, unauthorized } = require('../../utils/errors');
const { C, DEFAULT_NOTIFY, ELDER_ONLY_FIELDS, actorOf, nowIso, ownedBy, publicProfile } = require('./shared');

const sameEmail = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

module.exports = {
  /** Creates a circle with a fresh code, hashing the passcode, and adds the creator. */
  async createCircle({ elderName, elderEmail, timezone, passcode, requireElderApproval, member }) {
    let id = newCircleCode();
    while (await this.store.get(C.profiles, id)) id = newCircleCode();

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
      createdAt: nowIso(),
    };
    await this.store.create(C.profiles, profile);
    const created = await this.addMember(id, member);
    await this.logActivity(id, actorOf(created), 'circle.created', `Created the care circle for ${elderName}`);
    return { profile: publicProfile(profile), member: created };
  },

  /** Joins with code + passcode. Re-joining with the same email returns the existing member. */
  async joinCircle(profileId, passcode, member) {
    const profile = await this.store.get(C.profiles, profileId);
    // Same error for an unknown circle and a wrong passcode, so codes can't be enumerated.
    const ok = profile && (await verifyPasscode(passcode, profile.passcodeHash));
    if (!ok) throw unauthorized('Circle code or passcode is incorrect');

    const members = await this.store.listBy(C.members, 'profileId', profileId);
    const existing = members.find((m) => sameEmail(m.email, member.email));
    if (existing) return { profile: publicProfile(profile), member: existing };

    const created = await this.addMember(profileId, member);
    await this.logActivity(profileId, actorOf(created), 'member.joined', `${created.name} joined as ${created.role}`);
    return { profile: publicProfile(profile), member: created };
  },

  async addMember(profileId, { name, email, role }) {
    const doc = {
      id: newId('m_'),
      profileId,
      name,
      email: email || '',
      role,
      notify: { ...DEFAULT_NOTIFY[role] },
      joinedAt: nowIso(),
    };
    await this.store.create(C.members, doc);
    return doc;
  },

  async getProfile(profileId) {
    const p = await this.store.get(C.profiles, profileId);
    if (!p) throw notFound('Care circle not found');
    return publicProfile(p);
  },

  async updateProfile(actor, profileId, patch) {
    if (actor.role !== 'elder' && ELDER_ONLY_FIELDS.some((k) => k in patch)) {
      throw forbidden('Only the elder can change these settings');
    }
    const updated = await this.store.update(C.profiles, profileId, patch);
    await this.logActivity(profileId, actor, 'profile.updated', `Updated profile: ${Object.keys(patch).join(', ')}`);
    return publicProfile(updated);
  },

  async changePasscode(actor, profileId, currentPasscode, newPasscode) {
    if (actor.role !== 'elder') throw forbidden('Only the elder can change the passcode');
    const p = await this.store.get(C.profiles, profileId);
    if (!(await verifyPasscode(currentPasscode, p.passcodeHash))) throw unauthorized('Current passcode is incorrect');
    await this.store.update(C.profiles, profileId, { passcodeHash: await hashPasscode(newPasscode) });
    await this.logActivity(profileId, actor, 'profile.passcode', 'Changed the circle passcode');
  },

  getMember(memberId) {
    return this.store.get(C.members, memberId);
  },

  /** Members in the order they joined. */
  async listMembers(profileId) {
    const members = await this.store.listBy(C.members, 'profileId', profileId);
    return members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  },

  /** Merges the member's email preferences. */
  async updateNotify(actor, notify) {
    const member = await this.store.get(C.members, actor.memberId);
    return this.store.update(C.members, member.id, { notify: { ...member.notify, ...notify } });
  },

  async removeMember(actor, profileId, memberId) {
    if (actor.role !== 'elder' && actor.memberId !== memberId) {
      throw forbidden('Only the elder can remove other members');
    }
    const target = ownedBy(profileId, await this.store.get(C.members, memberId), 'Member');
    await this.store.delete(C.members, memberId);
    await this.logActivity(profileId, actor, 'member.removed', `Removed ${target.name} from the circle`);
  },
};
