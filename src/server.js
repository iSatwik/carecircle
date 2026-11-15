'use strict';

const { createApp } = require('./app');
const logger = require('./utils/logger');

const { app, reminders, config, email, ai } = createApp();

const server = app.listen(config.port, () => {
  logger.info('server.started', {
    port: config.port,
    store: config.store,
    email: email.mode,
    gemini: ai.enabled ? config.gemini.model : 'disabled',
  });
  if (config.enableInternalScheduler) reminders.start();
});

function shutdown(signal) {
  logger.info('server.shutdown', { signal });
  reminders.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // Cloud Run sends SIGTERM before stopping
process.on('SIGINT', () => shutdown('SIGINT'));
