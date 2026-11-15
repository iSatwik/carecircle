'use strict';

/**
 * Minimal structured logger. Emits one JSON object per line using the
 * `severity` field understood by Google Cloud Logging, so logs from Cloud Run
 * are automatically parsed, filterable and coloured by level.
 */

const LEVELS = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 };
const minLevel = process.env.NODE_ENV === 'test' ? LEVELS.ERROR : LEVELS.INFO;

function write(severity, message, fields = {}) {
  if (LEVELS[severity] < minLevel) return;
  const entry = { severity, message, time: new Date().toISOString(), ...fields };
  const line = JSON.stringify(entry);
  if (LEVELS[severity] >= LEVELS.ERROR) process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: (msg, fields) => write('DEBUG', msg, fields),
  info: (msg, fields) => write('INFO', msg, fields),
  warn: (msg, fields) => write('WARNING', msg, fields),
  error: (msg, fields) => write('ERROR', msg, fields),
};
