'use strict';

// Must be required before anything that loads src/config.js.
process.env.NODE_ENV = 'test';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.ENABLE_INTERNAL_SCHEDULER = 'false';

const request = require('supertest');
const { createApp } = require('../src/app');
const { MemoryStore } = require('../src/db/memoryStore');

function buildApp(configOverrides = {}) {
  return createApp({ store: new MemoryStore(), config: { cronSecret: 'test-cron-secret', ...configOverrides } });
}

/** Creates a circle and returns { ctx, code, token } for an elder by default. */
async function createCircle(ctx, { role = 'elder', requireElderApproval = false, passcode = 'secret123' } = {}) {
  const res = await request(ctx.app)
    .post('/api/circles')
    .send({
      elderName: 'Kamala Devi',
      elderEmail: 'kamala@example.com',
      timezone: 'Asia/Kolkata',
      passcode,
      requireElderApproval,
      member: { name: role === 'elder' ? 'Kamala Devi' : 'Asha', email: role === 'elder' ? 'kamala@example.com' : 'asha@example.com', role },
    });
  if (res.status !== 201) throw new Error(`createCircle failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { code: res.body.profile.id, token: res.body.token, member: res.body.member };
}

async function join(ctx, code, { role = 'family', name = 'Ravi', email = 'ravi@example.com', passcode = 'secret123' } = {}) {
  return request(ctx.app).post('/api/circles/join').send({ circleCode: code, passcode, member: { name, email, role } });
}

module.exports = { request, buildApp, createCircle, join };
