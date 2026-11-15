'use strict';

/**
 * Passcode hashing and session tokens.
 *  - Passcodes are hashed with scrypt (memory-hard KDF) and a per-profile salt.
 *  - Comparisons are constant-time to avoid timing attacks.
 *  - Sessions are short-lived signed JWTs scoped to ONE care circle.
 */

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const jwt = require('jsonwebtoken');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPasscode(passcode) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(passcode, salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPasscode(passcode, stored) {
  if (typeof stored !== 'string' || typeof passcode !== 'string') return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(passcode, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_OPTS);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function signSession({ memberId, profileId, role }, { secret, ttl }) {
  return jwt.sign({ sub: memberId, pid: profileId, role }, secret, {
    algorithm: 'HS256',
    expiresIn: ttl,
    issuer: 'carecircle',
  });
}

function verifySession(token, { secret }) {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'carecircle' });
  return { memberId: payload.sub, profileId: payload.pid, role: payload.role };
}

/** Constant-time comparison for shared secrets such as the cron key. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

module.exports = { hashPasscode, verifyPasscode, signSession, verifySession, safeEqual };
