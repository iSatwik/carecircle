'use strict';

/**
 * In-memory implementation of the storage interface.
 * Used for local development, tests and zero-config demos.
 * Every document is deep-cloned on the way in and out so callers can never
 * mutate stored state by accident.
 */

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

class MemoryStore {
  constructor() {
    /** @type {Map<string, Map<string, object>>} */
    this.collections = new Map();
  }

  col(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  async create(collection, doc) {
    if (!doc.id) throw new Error('Document id is required');
    this.col(collection).set(doc.id, clone(doc));
    return clone(doc);
  }

  /** Insert only if absent. Returns true when the document was created. */
  async createIfAbsent(collection, doc) {
    const col = this.col(collection);
    if (col.has(doc.id)) return false;
    col.set(doc.id, clone(doc));
    return true;
  }

  async get(collection, id) {
    return clone(this.col(collection).get(id)) || null;
  }

  async update(collection, id, patch) {
    const col = this.col(collection);
    const existing = col.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...clone(patch), id };
    col.set(id, updated);
    return clone(updated);
  }

  async delete(collection, id) {
    return this.col(collection).delete(id);
  }

  async listBy(collection, field, value) {
    const out = [];
    for (const doc of this.col(collection).values()) {
      if (doc[field] === value) out.push(clone(doc));
    }
    return out;
  }

  async listAll(collection) {
    return [...this.col(collection).values()].map(clone);
  }
}

module.exports = { MemoryStore };
