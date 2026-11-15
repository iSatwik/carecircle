'use strict';

/** The circle's shared activity log and its email outbox. Every change is logged so everyone can see it. */

const { newId } = require('../../utils/ids');
const { C, LIMITS, newestFirst, nowIso } = require('./shared');

module.exports = {
  async logActivity(profileId, actor, action, summary) {
    await this.store.create(C.activity, { id: newId('ac_'), profileId, actor, action, summary, at: nowIso() });
  },

  async listActivity(profileId, limit = LIMITS.activity) {
    return newestFirst(await this.store.listBy(C.activity, 'profileId', profileId), 'at', limit);
  },

  async listNotifications(profileId, limit = LIMITS.notifications) {
    return newestFirst(await this.store.listBy(C.notifications, 'profileId', profileId), 'createdAt', limit);
  },
};
