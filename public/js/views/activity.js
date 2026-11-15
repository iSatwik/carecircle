/** Activity: everything that happened in the circle, plus the emails it sent. */
import { $, state, t } from '../core.js';
import { el } from '../dom.js';
import { api } from '../api.js';
import { fmtDateTime } from '../format.js';

const ALERT_ACTIONS = new Set(['dose.missed', 'sos']);
const URGENT_EMAILS = new Set(['sos', 'health-alert', 'escalation']);

const DELIVERED = 'These emails were delivered to each person’s inbox.';
const EMAIL_MODE_TEXT = {
  smtp: DELIVERED,
  brevo: DELIVERED,
  demo: 'In this preview, emails are listed here instead of being sent.',
};
const EMAIL_NOT_SET_UP = 'Email sending is not set up on this server yet, so emails are listed here.';

const sentenceCase = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
const emptyItem = (text) => el('li', { class: 'muted', text });

function activityItem(a) {
  return el('li', { class: ALERT_ACTIONS.has(a.action) ? 'alert' : '' },
    el('p', {}, el('strong', { text: a.actor.name }), ` ${sentenceCase(a.summary)}`),
    el('time', { datetime: a.at, text: fmtDateTime(a.at) }));
}

function emailItem(n) {
  return el('li', { class: URGENT_EMAILS.has(n.type) ? 'alert' : '' },
    el('p', {}, el('strong', { text: n.subject })),
    el('p', { class: 'muted small', text: t('To {n} people', { n: n.to.length }) }),
    el('time', { datetime: n.createdAt, text: fmtDateTime(n.createdAt) }));
}

/** Fetches and renders the activity log and email outbox. */
export async function load() {
  const [items, outbox] = await Promise.all([api('/circle/activity'), api('/circle/notifications')]);
  $('#activity-list').replaceChildren(...(items.length ? items.map(activityItem) : [emptyItem(t('Nothing has happened yet.'))]));
  $('#email-mode').textContent = t(EMAIL_MODE_TEXT[state.config?.emailMode] || EMAIL_NOT_SET_UP);
  $('#outbox-list').replaceChildren(...(outbox.length ? outbox.map(emailItem) : [emptyItem(t('No emails yet.'))]));
}
