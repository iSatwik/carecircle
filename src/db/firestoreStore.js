'use strict';

/**
 * Google Cloud Firestore implementation of the storage interface.
 * On Cloud Run, credentials come automatically from the service account,
 * so no key file is needed.
 */

class FirestoreStore {
  constructor({ projectId } = {}) {
    // Lazy require keeps tests and memory-mode startup fast.
    const { Firestore } = require('@google-cloud/firestore');
    this.db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  }

  async create(collection, doc) {
    await this.db.collection(collection).doc(doc.id).set(doc);
    return doc;
  }

  async createIfAbsent(collection, doc) {
    try {
      // .create() fails atomically if the document already exists.
      await this.db.collection(collection).doc(doc.id).create(doc);
      return true;
    } catch (err) {
      if (err && (err.code === 6 || /already exists/i.test(err.message))) return false;
      throw err;
    }
  }

  async get(collection, id) {
    const snap = await this.db.collection(collection).doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  async update(collection, id, patch) {
    const ref = this.db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set({ ...patch, id }, { merge: true });
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() };
  }

  async delete(collection, id) {
    await this.db.collection(collection).doc(id).delete();
    return true;
  }

  async listBy(collection, field, value) {
    const snap = await this.db.collection(collection).where(field, '==', value).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async listAll(collection) {
    const snap = await this.db.collection(collection).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

module.exports = { FirestoreStore };
