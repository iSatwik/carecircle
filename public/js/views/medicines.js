/** Medicines: the list, the add/edit form and the plain-language explanation. */
import { $, $$, state, t } from '../core.js';
import { el, icon } from '../dom.js';
import { api, formData, submitForm, withBusy } from '../api.js';
import { askConfirm, toast } from '../feedback.js';
import { dayName, firstName, fmtTime, slotOf } from '../format.js';
import { speak } from '../voice.js';

const MAX_TIMES = 8;
const DEFAULT_REFILL_AT = 5;
const WEEK = [1, 2, 3, 4, 5, 6, 7];

/** Remaining-doses bar; turns into a refill warning at the threshold. */
function stockMeter(m) {
  if (typeof m.pillsRemaining !== 'number') return null;
  const low = m.pillsRemaining <= (m.refillThreshold ?? DEFAULT_REFILL_AT);
  const bar = el('span', {});
  bar.style.width = `${Math.min(100, Math.round((m.pillsRemaining / Math.max(30, m.pillsRemaining)) * 100))}%`;
  return el('div', { class: `stock${low ? ' low' : ''}` },
    el('span', { class: 'stock-bar', 'aria-hidden': 'true' }, bar),
    low ? t('{n} doses left, time to refill', { n: m.pillsRemaining }) : t('{n} doses left', { n: m.pillsRemaining }));
}

function medItem(m) {
  const days = m.daysOfWeek?.length ? m.daysOfWeek.map(dayName).join(', ') : t('Every day');
  return el('li', { class: `med ${slotOf(m.times[0]).key}` },
    el('span', { class: 'med-swatch' }, icon('pill')),
    el('div', {},
      el('h3', { text: `${m.name}${m.dosage ? `, ${m.dosage}` : ''}` }),
      el('div', { class: 'time-chips' },
        m.times.map((time) => el('span', { class: 'time-chip', text: fmtTime(time) })),
        el('span', { class: 'muted small', text: days })),
      m.instructions ? el('p', { text: m.instructions }) : null,
      stockMeter(m)),
    el('div', { class: 'item-actions' },
      el('button', { type: 'button', class: 'btn quiet small', onclick: (e) => explain(e.currentTarget, m) }, t('Explain simply')),
      el('button', { type: 'button', class: 'btn quiet small', onclick: () => openMedForm(m), 'aria-label': `${t('Edit')}: ${m.name}` }, t('Edit')),
      el('button', { type: 'button', class: 'btn danger small', onclick: (e) => deleteMed(e.currentTarget, m), 'aria-label': `${t('Remove')}: ${m.name}` }, t('Remove'))));
}

/** Fetches and renders the medicine list. */
export async function load() {
  const meds = await api('/circle/medications');
  $('#med-list').replaceChildren(...(meds.length
    ? meds.map(medItem)
    : [el('li', { class: 'empty', text: t('No medicines yet. Add the first one to fill the pill box.') })]));
}

/** One "time of day" input with its Remove button (at least one always stays). */
function timeInput(value = '') {
  const idx = $$('#m-times .time-item').length + 1;
  const wrap = el('div', { class: 'time-item' });
  const remove = () => { if ($$('#m-times .time-item').length > 1) wrap.remove(); };
  wrap.append(
    el('input', { type: 'time', name: 'time', value, required: true, 'aria-label': t('Time {n}', { n: idx }) }),
    el('button', { type: 'button', class: 'link-btn', 'aria-label': t('Remove time {n}', { n: idx }), onclick: remove }, t('Remove')));
  return wrap;
}

/** Opens the form empty (add) or filled in (edit). */
function openMedForm(med) {
  const form = $('#form-med');
  form.reset();
  form.hidden = false;
  $('#med-form-title').textContent = med ? `${t('Edit')}: ${med.name}` : t('Add medicine');
  form.elements.id.value = med?.id || '';
  const set = (name, v) => { if (v !== undefined && v !== null) form.elements[name].value = v; };
  set('name', med?.name);
  set('dosage', med?.dosage);
  set('instructions', med?.instructions);
  set('pillsRemaining', med?.pillsRemaining);
  set('refillThreshold', med?.refillThreshold ?? DEFAULT_REFILL_AT);
  set('endDate', med?.endDate);
  $('#m-times').replaceChildren(...(med?.times?.length ? med.times : ['08:00']).map((time) => timeInput(time)));
  $$('#m-days input').forEach((cb) => { cb.checked = Boolean(med?.daysOfWeek?.includes(Number(cb.value))); });
  form.scrollIntoView({ block: 'start' });
  form.elements.name.focus({ preventScroll: true });
}

/** The medicine as the API expects it; empty optional fields are left out. */
function medPayload(form) {
  const raw = formData(form);
  return {
    name: raw.name,
    dosage: raw.dosage || undefined,
    instructions: raw.instructions || undefined,
    times: $$('#m-times input').map((i) => i.value).filter(Boolean),
    daysOfWeek: $$('#m-days input:checked').map((cb) => Number(cb.value)),
    pillsRemaining: raw.pillsRemaining,
    refillThreshold: raw.refillThreshold,
    endDate: raw.endDate || undefined,
  };
}

const sentForApproval = () => t('Sent to {name} for approval.', { name: firstName(state.profile.elderName) });

async function submitMed(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const body = medPayload(form);
  const id = form.elements.id.value;
  await submitForm(form, async () => {
    const res = await api(id ? `/circle/medications/${id}` : '/circle/medications', { method: id ? 'PATCH' : 'POST', body });
    toast(res.pending ? sentForApproval() : t('{name} saved.', { name: body.name }));
    form.hidden = true;
    await load();
  });
}

async function deleteMed(button, med) {
  if (!(await askConfirm(t('Remove {name} from the medicine list?', { name: med.name }), t('Remove')))) return;
  await withBusy(button, async () => {
    const res = await api(`/circle/medications/${med.id}`, { method: 'DELETE' });
    toast(res.pending ? sentForApproval() : t('{name} removed.', { name: med.name }));
    await load();
  });
}

/** Shows (and speaks) a simple explanation of a medicine, from Gemini when available. */
async function explain(button, med) {
  await withBusy(button, async () => {
    const res = await api(`/circle/medications/${med.id}/explain?lang=${state.lang}`);
    $('#explain-title').textContent = t('About {name}', { name: med.name });
    $('#explain-body').textContent = res.text;
    $('#explain-disclaimer').textContent = `${res.source === 'gemini' ? `${t('Explained by Google Gemini.')} ` : ''}${t(res.disclaimer)}`;
    $('#dialog-explain').showModal();
    speak(res.text.replace(/^- /gm, ''));
  });
}

/** Weekday checkboxes, re-labelled whenever the language changes (keeps ticks). */
function renderDays() {
  const checked = new Set($$('#m-days input:checked').map((cb) => cb.value));
  $('#m-days').replaceChildren(...WEEK.map((n) => el('label', { class: 'choice' },
    el('input', { type: 'checkbox', value: String(n), checked: checked.has(String(n)) }),
    el('span', { text: dayName(n) }))));
}

/** Attaches the Medicines view's event handlers (once, at start-up). */
export function wire() {
  renderDays();
  $('#lang-select').addEventListener('change', renderDays);
  $('#btn-add-med').addEventListener('click', () => openMedForm(null));
  $('#btn-cancel-med').addEventListener('click', () => { $('#form-med').hidden = true; });
  $('#btn-add-time').addEventListener('click', () => {
    if ($$('#m-times .time-item').length < MAX_TIMES) $('#m-times').append(timeInput());
  });
  $('#form-med').addEventListener('submit', submitMed);
}
