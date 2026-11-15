'use strict';

const { MemoryStore } = require('./memoryStore');

/** Collection names in one place to avoid typos across the codebase. */
const COLLECTIONS = Object.freeze({
  profiles: 'profiles',
  members: 'members',
  medications: 'medications',
  doses: 'doseLogs',
  appointments: 'appointments',
  activity: 'activity',
  changeRequests: 'changeRequests',
  notifications: 'notifications',
  checkins: 'checkins',
});

/**
 * Builds the configured store. Firestore is used on Cloud Run;
 * an in-memory store is used locally and in tests.
 */
function createStore(config) {
  if (config.store === 'firestore') {
    const { FirestoreStore } = require('./firestoreStore');
    return new FirestoreStore({ projectId: config.gcpProjectId });
  }
  return new MemoryStore();
}

module.exports = { createStore, COLLECTIONS };
