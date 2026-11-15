'use strict';

/**
 * HTTP API. Every /api/circle/* route is scoped to the caller's own circle via
 * their session token – there is no way to address another circle's data.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const schemas = require('./validation');
const { validate, authenticate } = require('./middleware');
const { signSession, safeEqual } = require('./services/auth');
const { asyncHandler: h, unauthorized, badRequest } = require('./utils/errors');

function buildRouter({ care, reminders, email, ai, tts, config }) {
  const router = express.Router();
  const limiterOpts = { standardHeaders: 'draft-7', legacyHeaders: false };
  const authLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 20 });
  const aiLimiter = rateLimit({ ...limiterOpts, windowMs: 60 * 1000, limit: config.isTest ? 1000 : 10 });
  const sosLimiter = rateLimit({ ...limiterOpts, windowMs: 10 * 60 * 1000, limit: config.isTest ? 1000 : 5 });
  const speakLimiter = rateLimit({ ...limiterOpts, windowMs: 60 * 1000, limit: config.isTest ? 1000 : 40 });
  const langOf = (req) => (schemas.lang.safeParse(req.query.lang).success ? req.query.lang : 'en');
  const apiLimiter = rateLimit({ ...limiterOpts, windowMs: 60 * 1000, limit: config.isTest ? 5000 : 300 });

  const session = (member) => ({
    token: signSession(
      { memberId: member.id, profileId: member.profileId, role: member.role },
      { secret: config.jwtSecret, ttl: config.tokenTtl },
    ),
  });

  // ---------------------------------------------------------------- public
  router.get('/config', (_req, res) => {
    res.json({ aiEnabled: ai.enabled, ttsEnabled: tts.enabled, emailMode: email.mode, defaultTimezone: config.defaultTimezone, languages: ['en', 'hi', 'te'] });
  });

  router.post('/circles', authLimiter, validate(schemas.createCircle), h(async (req, res) => {
    const { profile, member } = await care.createCircle(req.body);
    res.status(201).json({ profile, member, ...session(member) });
  }));

  router.post('/circles/join', authLimiter, validate(schemas.joinCircle), h(async (req, res) => {
    const { circleCode, passcode, member: m } = req.body;
    const { profile, member } = await care.joinCircle(circleCode, passcode, m);
    res.json({ profile, member, ...session(member) });
  }));

  // Triggered by Google Cloud Scheduler. Protected by a shared secret header.
  router.post('/cron/tick', h(async (req, res) => {
    const provided = req.get('x-cron-secret') || '';
    if (!config.cronSecret || !safeEqual(provided, config.cronSecret)) throw unauthorized('Invalid cron secret');
    res.json(await reminders.tick());
  }));

  // ---------------------------------------------------------- authenticated
  const auth = authenticate(care, config);
  router.use(['/me', '/circle'], apiLimiter, auth);

  router.get('/me', h(async (req, res) => {
    const [member, profile] = await Promise.all([care.getMember(req.actor.memberId), care.getProfile(req.profileId)]);
    res.json({ member, profile });
  }));

  router.patch('/me/notify', validate(schemas.notify), h(async (req, res) => {
    res.json(await care.updateNotify(req.actor, req.body));
  }));

  router.get('/circle', h(async (req, res) => res.json(await care.getProfile(req.profileId))));

  router.patch('/circle', validate(schemas.updateProfile), h(async (req, res) => {
    res.json(await care.updateProfile(req.actor, req.profileId, req.body));
  }));

  router.post('/circle/passcode', authLimiter, validate(schemas.changePasscode), h(async (req, res) => {
    await care.changePasscode(req.actor, req.profileId, req.body.currentPasscode, req.body.newPasscode);
    res.status(204).end();
  }));

  router.get('/circle/members', h(async (req, res) => res.json(await care.listMembers(req.profileId))));

  router.delete('/circle/members/:memberId', h(async (req, res) => {
    await care.removeMember(req.actor, req.profileId, req.params.memberId);
    res.status(204).end();
  }));

  // Medications
  router.get('/circle/medications', h(async (req, res) => res.json(await care.listMedications(req.profileId))));

  router.post('/circle/medications', validate(schemas.createMedication), h(async (req, res) => {
    const result = await care.requestMedicationChange(req.actor, req.profileId, 'create', req.body);
    res.status(result.pending ? 202 : 201).json(result);
  }));

  router.patch('/circle/medications/:id', validate(schemas.updateMedication), h(async (req, res) => {
    const result = await care.requestMedicationChange(req.actor, req.profileId, 'update', req.body, req.params.id);
    res.status(result.pending ? 202 : 200).json(result);
  }));

  router.delete('/circle/medications/:id', h(async (req, res) => {
    const result = await care.requestMedicationChange(req.actor, req.profileId, 'delete', null, req.params.id);
    res.status(result.pending ? 202 : 200).json(result);
  }));

  router.get('/circle/medications/:id/explain', aiLimiter, h(async (req, res) => {
    res.json(await care.explainMedication(req.profileId, req.params.id, langOf(req)));
  }));

  // Elder approval queue
  router.get('/circle/changes', h(async (req, res) => res.json(await care.listChangeRequests(req.profileId))));

  router.post('/circle/changes/:id/decision', validate(schemas.decision), h(async (req, res) => {
    res.json(await care.decideChangeRequest(req.actor, req.profileId, req.params.id, req.body.approve));
  }));

  // Doses & adherence
  router.get('/circle/today', h(async (req, res) => res.json(await care.todaySchedule(req.profileId))));

  router.post('/circle/doses/:doseId', validate(schemas.logDose), h(async (req, res) => {
    res.json(await care.logDose(req.actor, req.profileId, req.params.doseId, req.body.status, req.body.note));
  }));

  router.get('/circle/adherence', h(async (req, res) => {
    const days = Number.parseInt(req.query.days, 10) || 7;
    if (days < 1 || days > 31) throw badRequest('days must be between 1 and 31');
    res.json(await care.adherenceReport(req.profileId, days));
  }));

  router.get('/circle/summary', aiLimiter, h(async (req, res) => res.json(await care.weeklySummary(req.profileId, langOf(req)))));

  // Natural speech (Google Cloud Text-to-Speech). 204 = use the browser voice instead.
  router.post('/circle/speak', speakLimiter, validate(schemas.speak), h(async (req, res) => {
    const result = await tts.synthesize(req.body.text, req.body.lang);
    if (!result) return res.status(204).end();
    return res.json(result);
  }));

  // Appointments
  router.get('/circle/appointments', h(async (req, res) => {
    res.json(await care.listAppointments(req.profileId, { includePast: req.query.past === '1' }));
  }));

  router.post('/circle/appointments', validate(schemas.appointment), h(async (req, res) => {
    res.status(201).json(await care.createAppointment(req.actor, req.profileId, req.body));
  }));

  router.patch('/circle/appointments/:id', validate(schemas.updateAppointment), h(async (req, res) => {
    res.json(await care.updateAppointment(req.actor, req.profileId, req.params.id, req.body));
  }));

  router.delete('/circle/appointments/:id', h(async (req, res) => {
    await care.deleteAppointment(req.actor, req.profileId, req.params.id);
    res.status(204).end();
  }));

  // Daily check-ins, help button, health card
  router.get('/circle/checkins', h(async (req, res) => res.json(await care.listCheckins(req.profileId))));

  router.post('/circle/checkins', validate(schemas.checkin), h(async (req, res) => {
    res.status(201).json(await care.addCheckin(req.actor, req.profileId, req.body));
  }));

  router.post('/circle/sos', sosLimiter, validate(schemas.sos), h(async (req, res) => {
    res.json(await care.sendSos(req.actor, req.profileId, req.body.message));
  }));

  router.get('/circle/health-card', h(async (req, res) => res.json(await care.healthCard(req.profileId))));

  // Transparency
  router.get('/circle/activity', h(async (req, res) => res.json(await care.listActivity(req.profileId))));
  router.get('/circle/notifications', h(async (req, res) => res.json(await care.listNotifications(req.profileId))));

  return router;
}

module.exports = { buildRouter };
