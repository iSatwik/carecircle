/** Welcome view: join an existing circle or start a new one. */
import { $, t } from '../core.js';
import { api, formData, submitForm } from '../api.js';
import { toast } from '../feedback.js';
import { show } from '../router.js';
import { setSession } from '../session.js';

/** Switches between the Join and Start tabs (an ARIA tab list). */
function selectEntryTab(which) {
  const join = which === 'join';
  $('#tab-join').setAttribute('aria-selected', String(join));
  $('#tab-create').setAttribute('aria-selected', String(!join));
  $('#tab-join').tabIndex = join ? 0 : -1;
  $('#tab-create').tabIndex = join ? -1 : 0;
  $('#form-join').hidden = !join;
  $('#form-create').hidden = join;
}

function onTabKeys(e) {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const next = $('#tab-join').getAttribute('aria-selected') === 'true' ? 'create' : 'join';
  selectEntryTab(next);
  $(`#tab-${next}`).focus();
}

function enter(session, message) {
  setSession(session);
  toast(message);
  location.hash = '#today';
  show('today');
}

const memberFrom = (d) => ({ name: d.name, email: d.email || '', role: d.role });

async function createCircle(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const d = formData(form);
  const body = {
    elderName: d.elderName,
    elderEmail: d.elderEmail || '',
    passcode: d.passcode,
    requireElderApproval: d.requireElderApproval,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    member: memberFrom(d),
  };
  await submitForm(form, async () => {
    enter(await api('/circles', { method: 'POST', body }), t('Circle created. Share the code and passcode with family.'));
  });
}

async function joinCircle(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const d = formData(form);
  const body = { circleCode: d.circleCode.toUpperCase(), passcode: d.passcode, member: memberFrom(d) };
  await submitForm(form, async () => {
    const res = await api('/circles/join', { method: 'POST', body });
    enter(res, t("Welcome to {name}'s circle.", { name: res.profile.elderName }));
  });
}

/** Attaches the welcome view's event handlers (once, at start-up). */
export function wire() {
  $('#tab-join').addEventListener('click', () => selectEntryTab('join'));
  $('#tab-create').addEventListener('click', () => selectEntryTab('create'));
  $('.segmented').addEventListener('keydown', onTabKeys);
  $('#form-create').addEventListener('submit', createCircle);
  $('#form-join').addEventListener('submit', joinCircle);
}
