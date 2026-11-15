'use strict';

/**
 * Express application factory. Dependencies are injected so tests can build an
 * isolated app with an in-memory store and fake clock.
 */

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');

const defaultConfig = require('./config');
const { createStore } = require('./db');
const { CareService } = require('./services/careService');
const { EmailService } = require('./services/email');
const { AiService } = require('./services/ai');
const { TtsService } = require('./services/tts');
const { ReminderEngine } = require('./services/reminders');
const { buildRouter } = require('./routes');
const { errorHandler } = require('./middleware');

function createApp(overrides = {}) {
  const config = { ...defaultConfig, ...(overrides.config || {}) };
  const store = overrides.store || createStore(config);
  const ai = overrides.ai || new AiService(config.gemini);
  const tts = overrides.tts || new TtsService(config.tts);
  const email = overrides.email || new EmailService({ store, smtp: config.smtp });
  const care = overrides.care || new CareService({ store, config, ai, email });
  const reminders = new ReminderEngine({ store, care, email, config });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run sits behind Google's front end

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'media-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '20kb' }));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', buildRouter({ care, reminders, email, ai, tts, config }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use(errorHandler);

  return { app, store, care, reminders, email, ai, tts, config };
}

module.exports = { createApp };
