'use strict';

/**
 * Medicines and change requests. When the elder has switched on "my approval
 * required", changes made by anyone else are queued until the elder decides.
 */

const { newId } = require('../../utils/ids');
const { badRequest, forbidden, notFound } = require('../../utils/errors');
const { C, nowIso, ownedBy } = require('./shared');

module.exports = {
  /** Medicines sorted by name. */
  async listMedications(profileId) {
    const meds = await this.store.listBy(C.medications, 'profileId', profileId);
    return meds.sort((a, b) => a.name.localeCompare(b.name));
  },

  async getMedication(profileId, medId) {
    return ownedBy(profileId, await this.store.get(C.medications, medId), 'Medication');
  },

  /**
   * Applies a medicine change, or queues it for the elder's approval.
   * @param {'create' | 'update' | 'delete'} action
   * @returns {Promise<{ pending: true, request: object } | { pending: false, medication: object }>}
   */
  async requestMedicationChange(actor, profileId, action, payload, medId) {
    const target = medId ? await this.getMedication(profileId, medId) : null; // also the ownership check
    const profile = await this.store.get(C.profiles, profileId);
    if (!profile.requireElderApproval || actor.role === 'elder') {
      return { pending: false, medication: await this.applyMedicationChange(actor, profileId, action, payload, medId) };
    }
    const request = {
      id: newId('cr_'),
      profileId,
      action,
      medId: medId || null,
      medName: payload?.name || target?.name || '',
      payload: payload || null,
      requestedBy: actor,
      status: 'pending',
      createdAt: nowIso(),
    };
    await this.store.create(C.changeRequests, request);
    await this.logActivity(profileId, actor, 'change.requested', `Asked to ${action} medication ${request.medName}`.trim());
    return { pending: true, request };
  },

  /** Carries out a medicine change straight away. */
  applyMedicationChange(actor, profileId, action, payload, medId) {
    switch (action) {
      case 'create': return this.createMedication(actor, profileId, payload);
      case 'update': return this.updateMedication(actor, profileId, medId, payload);
      case 'delete': return this.deleteMedication(actor, profileId, medId);
      default: throw badRequest('Unknown action');
    }
  },

  async createMedication(actor, profileId, payload) {
    const med = {
      id: newId('med_'),
      profileId,
      ...payload,
      active: payload.active !== false,
      createdAt: nowIso(),
      createdBy: actor.name,
    };
    await this.store.create(C.medications, med);
    await this.logActivity(profileId, actor, 'med.created', `Added ${med.name} at ${med.times.join(', ')}`);
    return med;
  },

  async updateMedication(actor, profileId, medId, payload) {
    const med = await this.store.update(C.medications, medId, { ...payload, updatedAt: nowIso() });
    if (!med) throw notFound('Medication not found');
    await this.logActivity(profileId, actor, 'med.updated', `Updated ${med.name}`);
    return med;
  },

  async deleteMedication(actor, profileId, medId) {
    const med = await this.store.get(C.medications, medId);
    if (!med) throw notFound('Medication not found');
    await this.store.delete(C.medications, medId);
    await this.logActivity(profileId, actor, 'med.deleted', `Removed ${med.name}`);
    return med;
  },

  /** Pending change requests, oldest first. */
  async listChangeRequests(profileId) {
    const all = await this.store.listBy(C.changeRequests, 'profileId', profileId);
    return all.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  /** The elder approves (the change is applied as the requester) or rejects a request. */
  async decideChangeRequest(actor, profileId, requestId, approve) {
    if (actor.role !== 'elder') throw forbidden('Only the elder can approve or reject changes');
    const req = ownedBy(profileId, await this.store.get(C.changeRequests, requestId), 'Change request');
    if (req.status !== 'pending') throw badRequest('This request was already decided');

    const medication = approve
      ? await this.applyMedicationChange(req.requestedBy, profileId, req.action, req.payload, req.medId)
      : null;
    const status = approve ? 'approved' : 'rejected';
    await this.store.update(C.changeRequests, requestId, { status, decidedAt: nowIso() });
    await this.logActivity(
      profileId,
      actor,
      `change.${status}`,
      `${approve ? 'Approved' : 'Rejected'} ${req.requestedBy.name}'s request to ${req.action} ${req.medName || 'a medication'}`,
    );
    return { status, medication };
  },

  /** A plain-language explanation of one medicine (Gemini when configured). */
  async explainMedication(profileId, medId, lang = 'en') {
    const med = await this.getMedication(profileId, medId);
    return this.ai.explainMedication(med, lang);
  },
};
