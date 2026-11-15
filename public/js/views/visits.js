/** Doctor visits: the list and the add/edit form. */
import { $, t } from '../core.js';
import { el } from '../dom.js';
import { api, formData, submitForm, withBusy } from '../api.js';
import { askConfirm, toast } from '../feedback.js';
import { dateLeaf, visitBody } from './visit-card.js';

const FIELDS = ['doctor', 'specialty', 'datetime', 'location', 'notes'];

function visitItem(a) {
  const body = visitBody(a);
  body.querySelector('.actions').append(
    el('button', { type: 'button', class: 'btn quiet small', onclick: () => openApptForm(a), 'aria-label': `${t('Edit')}: ${a.doctor}` }, t('Edit')),
    el('button', { type: 'button', class: 'btn danger small', onclick: (e) => deleteAppt(e.currentTarget, a), 'aria-label': `${t('Cancel visit')}: ${a.doctor}` }, t('Cancel visit')));
  return el('li', {}, el('div', { class: 'visit-card' }, dateLeaf(a.datetime), body));
}

/** Fetches and renders upcoming visits. */
export async function load() {
  const appts = await api('/circle/appointments');
  $('#appt-list').replaceChildren(...(appts.length
    ? appts.map(visitItem)
    : [el('li', { class: 'empty', text: t('No visits booked. Add one and everyone gets a reminder a day before.') })]));
}

function openApptForm(appt) {
  const form = $('#form-appt');
  form.reset();
  form.hidden = false;
  $('#appt-form-title').textContent = appt ? t('Edit visit') : t('Add visit');
  form.elements.id.value = appt?.id || '';
  for (const k of FIELDS) if (appt?.[k]) form.elements[k].value = appt[k];
  form.scrollIntoView({ block: 'start' });
  form.elements.doctor.focus({ preventScroll: true });
}

async function submitAppt(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const { id, ...raw } = formData(form);
  for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];
  if (raw.datetime) raw.datetime = raw.datetime.slice(0, 16); // drop seconds: the API takes YYYY-MM-DDTHH:mm
  await submitForm(form, async () => {
    await api(id ? `/circle/appointments/${id}` : '/circle/appointments', { method: id ? 'PATCH' : 'POST', body: raw });
    toast(t('Visit with {doctor} saved. Everyone gets a reminder a day before.', { doctor: raw.doctor || '' }));
    form.hidden = true;
    await load();
  });
}

async function deleteAppt(button, appt) {
  if (!(await askConfirm(t('Cancel the visit with {doctor}?', { doctor: appt.doctor }), t('Cancel visit')))) return;
  await withBusy(button, async () => {
    await api(`/circle/appointments/${appt.id}`, { method: 'DELETE' });
    toast(t('Visit with {doctor} cancelled.', { doctor: appt.doctor }));
    await load();
  });
}

/** Attaches the Doctor visits view's event handlers (once, at start-up). */
export function wire() {
  $('#btn-add-appt').addEventListener('click', () => openApptForm(null));
  $('#btn-cancel-appt').addEventListener('click', () => { $('#form-appt').hidden = true; });
  $('#form-appt').addEventListener('submit', submitAppt);
}
