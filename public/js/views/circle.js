/**
 * Care circle: members, medicine changes waiting for the elder, the health card
 * and the circle's settings.
 */
import { $, isElder, state, t } from '../core.js';
import { el, icon } from '../dom.js';
import { api, formData, withBusy } from '../api.js';
import { askConfirm, copyText, toast } from '../feedback.js';
import { firstName, fmtDateTime, fmtTime, initials, localDateTimeLabel, roleLabel, vitalsText } from '../format.js';
import { refreshMe, signOut } from '../session.js';
import { renderApprovalBanner } from './today.js';

const NOTIFY_KEYS = ['upcoming', 'missed', 'escalation', 'appointments', 'refill'];
const ACTION = { create: '{who} wants to add {med}', update: '{who} wants to change {med}', delete: '{who} wants to remove {med}' };

/** Fetches and renders the members, approvals, health card and settings. */
export async function load() {
  await refreshMe();
  const [members, changes, card] = await Promise.all([api('/circle/members'), api('/circle/changes'), api('/circle/health-card')]);
  renderApprovals(changes);
  renderApprovalBanner(changes);
  renderHealthCard(card);
  $('#member-list').replaceChildren(...members.map(memberItem));
  fillSettings();
}

function memberItem(m) {
  const self = m.id === state.me.id;
  // The elder can remove others; everyone else can only leave.
  const canRemove = isElder() ? !self : self;
  return el('li', { class: `person ${m.role}` },
    el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(m.name) }),
    el('div', { class: 'person-main' },
      el('h3', {}, `${m.name}${self ? ` (${t('you')})` : ''}`, el('span', { class: 'role-tag', text: roleLabel(m.role) })),
      m.email ? el('p', { text: m.email }) : null),
    canRemove
      ? el('button', {
        type: 'button',
        class: 'btn danger small',
        onclick: (e) => removeMember(e.currentTarget, m),
        'aria-label': self ? t('Leave this circle') : `${t('Remove')}: ${m.name}`,
      }, self ? t('Leave') : t('Remove'))
      : null);
}

function fillSettings() {
  const pf = $('#form-profile');
  pf.elements.conditions.value = state.profile.conditions || '';
  pf.elements.allergies.value = state.profile.allergies || '';
  pf.elements.emergencyContact.value = state.profile.emergencyContact || '';
  pf.elements.requireElderApproval.checked = Boolean(state.profile.requireElderApproval);
  const nf = $('#form-notify');
  for (const k of NOTIFY_KEYS) nf.elements[k].checked = Boolean(state.me.notify?.[k]);
}

function changeDetail(c) {
  if (c.action === 'delete') return t('Remove this medicine');
  const p = c.payload || {};
  return [p.dosage, p.times?.map(fmtTime).join(', '), p.instructions].filter(Boolean).join(', ');
}

/** Pending medicine changes: the elder gets Approve/Reject, others see who it waits on. */
function renderApprovals(changes) {
  const list = $('#approval-list');
  if (!changes.length) {
    list.replaceChildren(el('li', { class: 'muted', text: t('Nothing is waiting.') }));
    return;
  }
  list.replaceChildren(...changes.map((c) => el('li', {},
    el('div', {},
      el('h3', { text: t(ACTION[c.action], { who: c.requestedBy.name, med: c.medName || t('a medicine') }) }),
      el('p', { text: changeDetail(c) || t('Update details') })),
    isElder()
      ? el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn ok small', onclick: (e) => decide(e.currentTarget, c, true) }, icon('check'), t('Approve')),
        el('button', { type: 'button', class: 'btn danger small', onclick: (e) => decide(e.currentTarget, c, false) }, t('Reject')))
      : el('span', { class: 'muted', text: t('Waiting for {name}', { name: firstName(state.profile.elderName) }) }))));
}

const adherenceText = (c) => (c.adherence30 === null ? t('No doses recorded yet') : t('{n}% of doses taken', { n: c.adherence30 }));
const medLine = (m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}, ${m.times.map(fmtTime).join(', ')}`;

/** The health card as plain text, for copying into a message. */
function healthCardText(c) {
  const lines = [
    `${t('Health card')}: ${c.elderName}`,
    '',
    `${t('Conditions')}: ${c.conditions || t('Not recorded')}`,
    `${t('Allergies')}: ${c.allergies || t('None recorded')}`,
    `${t('Emergency contact')}: ${c.emergencyContact || t('Not recorded')}`,
    '',
    `${t('Medicines')}:`,
    ...(c.medications.length
      ? c.medications.map((m) => `- ${medLine(m)}${m.instructions ? ` (${m.instructions})` : ''}`)
      : [`- ${t('None')}`]),
    '',
    `${t('Last 30 days')}: ${adherenceText(c)}`,
  ];
  if (c.latestVitals) lines.push(`${t('Latest reading')}: ${vitalsText(c.latestVitals)} (${fmtDateTime(c.latestVitals.at)})`);
  if (c.nextAppointment) lines.push(`${t('Next doctor visit')}: ${c.nextAppointment.doctor}, ${localDateTimeLabel(c.nextAppointment.datetime)}`);
  lines.push('', 'CareCircle');
  return lines.join('\n');
}

function renderHealthCard(c) {
  state.healthCard = c;
  const row = (label, value) => el('div', { class: 'hc-row' }, el('dt', { text: t(label) }), el('dd', {}, value));
  $('#health-card').replaceChildren(el('dl', { class: 'hc' },
    row('Name', c.elderName),
    row('Conditions', c.conditions || t('Not recorded')),
    row('Allergies', c.allergies || t('None recorded')),
    row('Emergency contact', c.emergencyContact || t('Not recorded')),
    row('Medicines', c.medications.length ? el('ul', {}, c.medications.map((m) => el('li', { text: medLine(m) }))) : t('None')),
    row('Last 30 days', adherenceText(c)),
    row('Latest reading', c.latestVitals ? vitalsText(c.latestVitals) : t('No readings yet'))));
}

async function decide(button, change, approve) {
  await withBusy(button, async () => {
    await api(`/circle/changes/${change.id}/decision`, { method: 'POST', body: { approve } });
    toast(approve ? t('Approved. The pill box is updated.') : t('Rejected. Nothing was changed.'));
    await load();
  });
}

async function removeMember(button, m) {
  const self = m.id === state.me.id;
  const question = self ? t('Leave this care circle? You will stop getting emails.') : t('Remove {name} from the circle?', { name: m.name });
  if (!(await askConfirm(question, self ? t('Leave') : t('Remove')))) return;
  await withBusy(button, async () => {
    await api(`/circle/members/${m.id}`, { method: 'DELETE' });
    if (self) {
      signOut();
      return;
    }
    toast(t('{name} removed.', { name: m.name }));
    await load();
  });
}

function printCard() {
  try {
    window.print();
  } catch {
    toast(t('Printing is not available here. Use Copy instead.'), true);
  }
}

async function saveProfile(e) {
  e.preventDefault();
  const d = formData(e.currentTarget);
  if (!isElder()) delete d.requireElderApproval;
  await withBusy(e.currentTarget.querySelector('[type=submit]'), async () => {
    state.profile = await api('/circle', { method: 'PATCH', body: d });
    toast(t('Health details saved.'));
    renderHealthCard(await api('/circle/health-card'));
  });
}

async function saveNotify(e) {
  e.preventDefault();
  const d = formData(e.currentTarget);
  await withBusy(e.currentTarget.querySelector('[type=submit]'), async () => {
    state.me = await api('/me/notify', { method: 'PATCH', body: d });
    toast(t('Email settings saved.'));
  });
}

async function changePasscode(e) {
  e.preventDefault();
  const form = e.currentTarget;
  await withBusy(form.querySelector('[type=submit]'), async () => {
    await api('/circle/passcode', { method: 'POST', body: formData(form) });
    form.reset();
    toast(t('Passcode changed. Share the new one only with people you trust.'));
  });
}

/** Attaches the Care circle view's event handlers (once, at start-up). */
export function wire() {
  $('#btn-copy-card').addEventListener('click', () => state.healthCard && copyText(healthCardText(state.healthCard), t('Health card copied.')));
  $('#btn-print-card').addEventListener('click', printCard);
  $('#form-profile').addEventListener('submit', saveProfile);
  $('#form-notify').addEventListener('submit', saveNotify);
  $('#form-passcode').addEventListener('submit', changePasscode);
}
