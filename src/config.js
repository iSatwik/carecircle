'use strict';

/**
 * Centralised, validated runtime configuration.
 * Every value comes from environment variables so that secrets are never
 * committed to the repository (see .env.example).
 */

const crypto = require('node:crypto');

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    // Fail closed: never run production with a guessable signing key.
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  // Ephemeral key for local development / tests only.
  jwtSecret = crypto.randomBytes(32).toString('hex');
}

const config = Object.freeze({
  isProduction,
  isTest,
  port: int(env.PORT, 8080),
  appName: 'CareCircle',
  publicUrl: env.PUBLIC_URL || '',
  defaultTimezone: env.DEFAULT_TIMEZONE || 'Asia/Kolkata',

  // Storage: "memory" (default, zero-setup) or "firestore" (Cloud Run).
  store: (env.STORE || 'memory').toLowerCase(),
  gcpProjectId: env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || undefined,

  // Auth
  jwtSecret,
  tokenTtl: env.TOKEN_TTL || '12h',
  minPasscodeLength: 6,

  // Reminders
  cronSecret: env.CRON_SECRET || '',
  enableInternalScheduler: bool(env.ENABLE_INTERNAL_SCHEDULER, !isTest),
  schedulerIntervalMs: int(env.SCHEDULER_INTERVAL_MS, 60_000),
  upcomingWindowMin: int(env.UPCOMING_WINDOW_MIN, 15),
  missedGraceMin: int(env.MISSED_GRACE_MIN, 30),
  escalateAfterMin: int(env.ESCALATE_AFTER_MIN, 90),

  // Email: Brevo HTTPS API (BREVO_API_KEY) or SMTP. If neither is set, emails go to the in-app outbox + logs.
  smtp: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 465),
    secure: bool(env.SMTP_SECURE, true),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || env.SMTP_USER || 'CareCircle <no-reply@carecircle.local>',
    brevoApiKey: env.BREVO_API_KEY || '',
  },

  // Google Cloud Text-to-Speech (natural voices). On by default on Cloud Run
  // (uses the service account); elsewhere it needs TTS_API_KEY.
  tts: {
    enabled: bool(env.TTS_ENABLED, Boolean(env.TTS_API_KEY || env.K_SERVICE)) && !isTest,
    apiKey: env.TTS_API_KEY || '',
    voiceName: env.TTS_VOICE || 'Aoede',
    timeoutMs: int(env.TTS_TIMEOUT_MS, 12_000),
  },

  // Gemini (Google AI). Optional – graceful fallback when absent.
  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-2.5-flash',
    timeoutMs: int(env.GEMINI_TIMEOUT_MS, 15_000),
  },
});

module.exports = config;
