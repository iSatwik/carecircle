'use strict';

const { verifySession } = require('./services/auth');
const { HttpError, badRequest, unauthorized } = require('./utils/errors');
const logger = require('./utils/logger');

/** Validates req.body with a zod schema and replaces it with the parsed value. */
const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(badRequest(details[0]?.message || 'Invalid input', details));
  }
  req.body = result.data;
  return next();
};

/**
 * Authenticates the bearer token and confirms the member still exists.
 * Sets req.actor = { memberId, name, role } and req.profileId.
 */
const authenticate = (care, config) => async (req, _res, next) => {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let session;
    try {
      session = verifySession(token, { secret: config.jwtSecret });
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }
    const member = await care.getMember(session.memberId);
    if (!member || member.profileId !== session.profileId) throw unauthorized('Your access was removed');
    req.actor = { memberId: member.id, name: member.name, role: member.role };
    req.profileId = member.profileId;
    return next();
  } catch (err) {
    return next(err);
  }
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  logger.error('request.failed', { path: req.path, method: req.method, error: err?.message, stack: err?.stack });
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

module.exports = { validate, authenticate, errorHandler };
