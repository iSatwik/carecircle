'use strict';

/**
 * Email delivery with built-in de-duplication.
 *
 * Every notification has a deterministic key (e.g. "missed:<doseId>"), stored
 * with `createIfAbsent`, so a reminder is sent at most once even if several
 * Cloud Run instances or scheduler ticks race each other.
 *
 * When SMTP (e.g. Gmail with an App Password) is not configured, messages are
 * still recorded in the in-app outbox so the reminder flow stays demonstrable.
 */

const nodemailer = require('nodemailer');
const { COLLECTIONS } = require('../db');
const logger = require('../utils/logger');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderHtml({ heading, lines, ctaUrl, ctaLabel }) {
  const body = lines.map((l) => `<p style="font-size:18px;line-height:1.5;margin:0 0 12px">${escapeHtml(l)}</p>`).join('');
  const cta = ctaUrl
    ? `<p><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#0b5cad;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:18px">${escapeHtml(ctaLabel || 'Open CareCircle')}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:560px;margin:auto;padding:16px">
<h1 style="font-size:24px;color:#0b5cad">${escapeHtml(heading)}</h1>${body}${cta}
<p style="font-size:14px;color:#555">Sent by CareCircle on behalf of your care circle.</p></body></html>`;
}

class EmailService {
  constructor({ store, smtp }) {
    this.store = store;
    this.smtp = smtp;
    this.transport = smtp.host && smtp.user && smtp.pass
      ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
      })
      : null;
  }

  get mode() {
    return this.transport ? 'smtp' : 'outbox';
  }

  /**
   * Sends once per key. Returns false when the key was already used.
   * @param {{key:string, profileId:string, type:string, to:string[], subject:string, heading:string, lines:string[], ctaUrl?:string}} msg
   */
  async sendOnce(msg) {
    const recipients = [...new Set((msg.to || []).filter(Boolean))];
    if (recipients.length === 0) return false;

    const record = {
      id: msg.key,
      profileId: msg.profileId,
      type: msg.type,
      to: recipients,
      subject: msg.subject,
      text: msg.lines.join('\n'),
      createdAt: new Date().toISOString(),
      delivery: this.mode,
      status: 'pending',
    };
    const fresh = await this.store.createIfAbsent(COLLECTIONS.notifications, record);
    if (!fresh) return false;

    if (!this.transport) {
      await this.store.update(COLLECTIONS.notifications, record.id, { status: 'recorded' });
      logger.info('email.outbox', { type: msg.type, profileId: msg.profileId, recipients: recipients.length });
      return true;
    }

    try {
      await this.transport.sendMail({
        from: this.smtp.from,
        to: recipients.join(', '),
        subject: msg.subject,
        text: record.text,
        html: renderHtml(msg),
      });
      await this.store.update(COLLECTIONS.notifications, record.id, { status: 'sent' });
      logger.info('email.sent', { type: msg.type, profileId: msg.profileId, recipients: recipients.length });
    } catch (err) {
      await this.store.update(COLLECTIONS.notifications, record.id, { status: 'failed', error: err.message });
      logger.error('email.failed', { type: msg.type, error: err.message });
    }
    return true;
  }
}

module.exports = { EmailService, escapeHtml, renderHtml };
