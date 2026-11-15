'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/services/auth');

test('passcodes are salted scrypt hashes and verify correctly', async () => {
  const a = await auth.hashPasscode('secret123');
  const b = await auth.hashPasscode('secret123');
  assert.match(a, /^scrypt\$/);
  assert.notEqual(a, b, 'salt must make hashes unique');
  assert.equal(await auth.verifyPasscode('secret123', a), true);
  assert.equal(await auth.verifyPasscode('wrong-pass', a), false);
  assert.equal(await auth.verifyPasscode('secret123', 'garbage'), false);
  assert.equal(await auth.verifyPasscode(undefined, a), false);
});

test('session tokens round-trip and reject tampering / wrong secret', () => {
  const opts = { secret: 'x'.repeat(32), ttl: '1h' };
  const token = auth.signSession({ memberId: 'm1', profileId: 'CC-ABCDEF', role: 'family' }, opts);
  assert.deepEqual(auth.verifySession(token, opts), { memberId: 'm1', profileId: 'CC-ABCDEF', role: 'family' });
  assert.throws(() => auth.verifySession(token, { secret: 'y'.repeat(32) }));
  assert.throws(() => auth.verifySession(`${token}x`, opts));
});

test('safeEqual compares in constant time and handles length mismatch', () => {
  assert.equal(auth.safeEqual('abc', 'abc'), true);
  assert.equal(auth.safeEqual('abc', 'abd'), false);
  assert.equal(auth.safeEqual('abc', 'abcd'), false);
});
