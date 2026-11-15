'use strict';

const crypto = require('node:crypto');

/** Cryptographically random, URL-safe identifier. */
const newId = (prefix = '') => `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;

/**
 * Short, human-shareable Care Circle code (e.g. "CC-7K3M9Q").
 * Ambiguous characters (0/O, 1/I/L) are excluded so elders can read it aloud.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newCircleCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return `CC-${code}`;
}

module.exports = { newId, newCircleCode };
