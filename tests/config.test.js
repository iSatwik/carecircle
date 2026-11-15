'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { request, buildApp } = require('./helpers');

const root = path.join(__dirname, '..');
const runConfig = (env) =>
  spawnSync(process.execPath, ['-e', "require('./src/config')"], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('production refuses to start without a JWT secret (fails closed)', () => {
  const res = runConfig({ NODE_ENV: 'production' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /JWT_SECRET must be set/);
});

test('production starts when a JWT secret is provided', () => {
  const res = runConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(64) });
  assert.equal(res.status, 0, res.stderr);
});

test('CSP forbids inline scripts and framing; static assets are compressed', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).get('/app.js').set('Accept-Encoding', 'gzip');
  const csp = res.headers['content-security-policy'];
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(res.headers['content-encoding'], 'gzip');
});

test('oversized JSON bodies are rejected', async () => {
  const ctx = buildApp();
  const res = await request(ctx.app).post('/api/circles').set('Content-Type', 'application/json').send(JSON.stringify({ elderName: 'x'.repeat(30_000) }));
  assert.equal(res.status, 413);
});
