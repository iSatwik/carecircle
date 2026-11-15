/**
 * Today: the pill-box organizer, weekly streak, next visit, daily check-in,
 * "I need help", the AI weekly summary and "Read my day".
 */
import { $, $$, isElder, locale, state, t } from '../core.js';
import { el, icon } from '../dom.js';
import { api, formData, submitForm, withBusy } from '../api.js';
import { toast } from '../feedback.js';
import { SLOTS, firstName, fmtTime, localDateTimeLabel, slotOf, statusLabel } from '../format.js';
import { speak } from '../voice.js';
import { dateLeaf, visitBody } from './visit-card.js';

const DONE = new Set(['taken', 'skipped']);
const MOOD_WORD = { good: 'good', okay: 'okay', unwell: 'not well' };
const moodWord = (m) => t(MOOD_WORD[m] || m);

/** Fetches and renders everything on the Today view. */
export async function load() {
  const [today, adherence, appts, changes, checkins] = await Promise.all([
    api('/circle/today'),
    api('/circle/adherence?days=7'),
    api('/circle/appointments'),
    api('/circle/changes'),
    api('/circle/checkins'),
  ]);
  state.today = today;
  renderGreeting();
  renderOrganizer(today);
  renderWeek(adherence);
  renderNextAppt(appts[0]);
  renderApprovalBanner(changes);
  renderCheckinLatest(checkins);
}

function renderGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning, {name}' : h < 17 ? 'Good afternoon, {name}' : 'Good evening, {name}';
  $('#today-title').textContent = isElder()
    ? t(part, { name: firstName(state.me.name) })
    : t("{name}'s day", { name: firstName(state.profile.elderName) });
  $('#today-date').textContent = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderProgress(doses) {
  const total = doses.length;
  const taken = doses.filter((d) => d.status === 'taken').length;
  $('#dose-progress').textContent = total ? t('{taken} of {total} taken', { taken, total }) : t('No medicines today');
  $('#dose-progress-bar').style.width = total ? `${Math.round((taken / total) * 100)}%` : '0%';
}

/** Draws the four pill-box compartments with today's doses. */
function renderOrganizer(today) {
  renderProgress(today.doses);
  const compartments = SLOTS.map((slot) => {
    const doses = today.doses.filter((d) => slotOf(d.time).key === slot.key);
    const allDone = doses.length > 0 && doses.every((d) => DONE.has(d.status));
    const list = el('ul', { class: 'slot-body' },
      doses.length ? doses.map(doseCard) : el('li', { class: 'slot-empty', text: t('Nothing in this compartment.') }));
    return el('section', { class: `slot ${slot.key}${allDone ? ' done' : ''}`, 'aria-label': t(slot.label) },
      el('div', { class: 'slot-lid' },
        el('h3', {}, icon(allDone ? 'check' : slot.icon), t(slot.label)),
        el('span', { class: 'slot-range', text: allDone ? t('All done') : t(slot.range) })),
      list);
  });
  $('#organizer').replaceChildren(...compartments);
}

function takeLabel(status) {
  if (status === 'upcoming') return t('Taken early');
  if (status === 'missed') return t('I took it late');
  return t('I took it');
}

function doseButtons(d) {
  const label = takeLabel(d.status);
  const when = `${d.name}, ${fmtTime(d.time)}`;
  return el('div', { class: 'dose-actions' },
    el('button', {
      type: 'button',
      class: d.status === 'upcoming' ? 'btn quiet small' : 'btn ok small',
      onclick: (e) => logDose(e.currentTarget, d, 'taken'),
      'aria-label': `${label}: ${when}`,
    }, icon('check'), label),
    d.status !== 'missed'
      ? el('button', { type: 'button', class: 'btn quiet small', onclick: (e) => logDose(e.currentTarget, d, 'skipped'), 'aria-label': `${t('Skip')}: ${when}` }, t('Skip'))
      : null);
}

/** One dose in a compartment, with "I took it" / "Skip" when it can still be recorded. */
function doseCard(d) {
  const open = !DONE.has(d.status);
  const canLog = d.canLog !== false;
  return el('li', { class: `dose ${d.status}` },
    el('div', { class: 'dose-top' },
      el('p', { class: 'dose-name', text: d.name }),
      el('span', { class: 'dose-time', text: fmtTime(d.time) })),
    (d.dosage || d.instructions) ? el('p', { class: 'dose-meta', text: [d.dosage, d.instructions].filter(Boolean).join(', ') }) : null,
    el('div', { class: 'dose-actions' },
      el('span', { class: `chip ${d.status}` }, d.status === 'taken' ? icon('check') : null, statusLabel(d.status)),
      d.recordedBy ? el('span', { class: 'muted small', text: t('by {name}', { name: d.recordedBy }) }) : null,
      open && !canLog ? el('span', { class: 'muted small', text: t('You can mark it from 2 hours before') }) : null),
    open && canLog ? doseButtons(d) : null);
}

async function logDose(button, dose, status) {
  await withBusy(button, async () => {
    await api(`/circle/doses/${encodeURIComponent(dose.id)}`, { method: 'POST', body: { status } });
    toast(status === 'taken' ? t('{name} marked as taken. Well done!', { name: dose.name }) : t('{name} skipped.', { name: dose.name }));
    await load();
  });
}

function weekDotClass(percent) {
  if (percent === null) return '';
  if (percent === 100) return 'full';
  return percent >= 60 ? 'part' : 'low';
}

/** The streak counter and the last seven days as dots. */
function renderWeek(rep) {
  const streak = rep.streak || 0;
  $('#streak-count').textContent = String(streak);
  $('#streak-label').textContent = streak === 1 ? t('day with every dose taken') : t('days in a row with every dose taken');
  $('#adherence-overall').textContent = rep.overall.percent === null
    ? t('No doses recorded yet this week.')
    : t("{n}% of this week's doses taken.", { n: rep.overall.percent });
  const lastIndex = rep.daily.length - 1;
  $('#week-dots').replaceChildren(...rep.daily.map((day, i) => {
    const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(locale(), { weekday: 'short' });
    const spoken = day.percent === null ? t('no doses') : t('{n}% taken', { n: day.percent });
    return el('li', { class: `${weekDotClass(day.percent)}${i === lastIndex ? ' today-dot' : ''}`, 'aria-label': `${label}: ${spoken}` },
      el('span', { class: 'dot' }, day.percent === 100 ? icon('check') : null),
      el('span', { 'aria-hidden': 'true', text: i === lastIndex ? t('Today') : label }));
  }));
}

function renderNextAppt(appt) {
  const box = $('#next-appt');
  if (!appt) {
    box.replaceChildren(el('p', { class: 'muted', text: t('No visits booked.') }), el('a', { class: 'btn quiet small', href: '#appointments' }, t('Add a visit')));
    return;
  }
  const body = visitBody(appt, { compact: true });
  const actions = body.querySelector('.actions');
  actions.remove();
  box.replaceChildren(el('div', { class: 'visit-card compact' }, dateLeaf(appt.datetime), body, actions));
}

/** The badge on the Circle tab and the banner about medicine changes waiting for the elder. */
export function renderApprovalBanner(changes) {
  const n = changes.length;
  const badge = $('#badge-approvals');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  badge.setAttribute('aria-label', t('{n} waiting for approval', { n }));
  const banner = $('#approval-banner');
  banner.hidden = n === 0;
  banner.replaceChildren();
  if (!n) return;
  banner.append(
    el('p', {
      text: isElder()
        ? t('{n} medicine change(s) need your approval.', { n })
        : t("{n} change(s) waiting for {name}'s approval.", { n, name: firstName(state.profile.elderName) }),
    }),
    el('a', { class: 'btn quiet small', href: '#circle' }, isElder() ? t('Review changes') : t('See requests')));
}

// ------------------------------------------------------------------ check-in

function renderCheckinLatest(checkins) {
  const latest = checkins[0];
  const out = $('#checkin-latest');
  const isToday = latest && new Date(latest.at).toDateString() === new Date().toDateString();
  if (!isToday) {
    out.textContent = isElder()
      ? t('A quick tap helps your family know you are fine.')
      : t("{name} hasn't checked in yet today.", { name: firstName(state.profile.elderName) });
    return;
  }
  const bits = [t('Feeling {mood}', { mood: moodWord(latest.mood) })];
  if (latest.systolic) bits.push(t('BP {a}/{b}', { a: latest.systolic, b: latest.diastolic }));
  if (latest.sugar) bits.push(t('sugar {n} mg/dL', { n: latest.sugar }));
  const time = new Date(latest.at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
  out.textContent = t('Last check-in at {time} by {name}: {details}.', { time, name: latest.by.name, details: bits.join(', ') });
}

function selectMood(mood) {
  state.mood = mood;
  $$('.mood').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mood === mood)));
}

/** Arrow keys move between the mood options (radio-group behaviour). */
function onMoodKeys(e) {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const moods = $$('.mood');
  const i = Math.max(0, moods.findIndex((b) => b.dataset.mood === state.mood));
  const next = moods[(i + (e.key === 'ArrowRight' ? 1 : moods.length - 1)) % moods.length];
  selectMood(next.dataset.mood);
  next.focus();
}

async function submitCheckin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (!state.mood) {
    toast(t('Choose how you are feeling first.'), true);
    $('.mood').focus();
    return;
  }
  const body = { mood: state.mood, ...formData(form) };
  if (!body.note) delete body.note;
  await submitForm(form, async () => {
    const res = await api('/circle/checkins', { method: 'POST', body });
    form.reset();
    selectMood(null);
    $('.readings').open = false;
    toast(res.alerted ? t('Saved. Your family has been told so they can check on you.') : t('Check-in saved. Thank you!'));
    renderCheckinLatest(await api('/circle/checkins'));
  });
}

// ------------------------------------------------------------------ help / SOS

function openSos() {
  $('#sos-text').textContent = t("Everyone in {name}'s circle will get an urgent email right away.", { name: state.profile.elderName });
  $('#form-sos').reset();
  $('#dialog-sos').showModal();
}

async function submitSos(e) {
  e.preventDefault();
  const form = e.currentTarget;
  await withBusy(form.querySelector('[type=submit]'), async () => {
    const res = await api('/circle/sos', { method: 'POST', body: formData(form) });
    $('#dialog-sos').close();
    if (res.recipients === 0) toast(t('No one else in the circle has an email yet. Please call 108 or a family member now.'), true);
    else if (res.sent) toast(t('Alert sent to {n} people. Help is on the way.', { n: res.recipients }));
    else toast(t('An alert was sent a moment ago. Your family already knows.'));
  });
}

// ------------------------------------------------------------------ AI summary and read-aloud

async function showSummary(button) {
  await withBusy(button, async () => {
    const res = await api(`/circle/summary?lang=${state.lang}`);
    const note = `${res.source === 'gemini' ? `${t('Written by Google Gemini.')} ` : ''}${t(res.disclaimer)}`;
    $('#summary-out').replaceChildren(el('span', { text: res.text }), el('span', { class: 'ai-note', text: note }));
    speak(res.text);
  });
}

/** Builds the spoken description of the day. */
function daySpeech(doses, nextAppt) {
  const taken = doses.filter((d) => d.status === 'taken').length;
  const parts = [t('Hello {name}. Here is your day.', { name: firstName(state.profile.elderName) })];
  parts.push(doses.length
    ? t('You have taken {taken} of {total} medicines so far.', { taken, total: doses.length })
    : t('You have no medicines today.'));
  for (const d of doses) {
    const line = t('At {time}, {name}{dose}. {status}.', { time: fmtTime(d.time), name: d.name, dose: d.dosage ? `, ${d.dosage}` : '', status: statusLabel(d.status) });
    parts.push(line + (d.instructions ? ` ${d.instructions}.` : ''));
  }
  if (nextAppt) parts.push(t('Your next doctor visit is with {doctor} on {when}.', { doctor: nextAppt.doctor, when: localDateTimeLabel(nextAppt.datetime) }));
  parts.push(t('Take care.'));
  return parts.join(' ');
}

/** Reads the latest schedule aloud (always fetched fresh, so it reflects every change). */
async function readAloud(button) {
  await withBusy(button, async () => {
    const [today, appts] = await Promise.all([api('/circle/today'), api('/circle/appointments')]);
    state.today = today;
    renderOrganizer(today);
    await speak(daySpeech(today.doses, appts[0]), { force: true });
  });
}

/** Attaches the Today view's event handlers (once, at start-up). */
export function wire() {
  $$('.mood').forEach((b) => b.addEventListener('click', () => selectMood(b.dataset.mood)));
  $('.moods').addEventListener('keydown', onMoodKeys);
  $('#form-checkin').addEventListener('submit', submitCheckin);
  $('#btn-sos').addEventListener('click', openSos);
  $('#form-sos').addEventListener('submit', submitSos);
  $('#sos-cancel').addEventListener('click', () => $('#dialog-sos').close());
  $('#btn-summary').addEventListener('click', (e) => showSummary(e.currentTarget));
  $('#btn-read-aloud').addEventListener('click', (e) => readAloud(e.currentTarget));
}
