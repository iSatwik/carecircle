/**
 * CareCircle front end: entry point.
 * Dependency-free ES modules, CSP-safe (no inline scripts, no innerHTML with data).
 */
import { $, state, t } from './core.js';
import { api, UNAUTHORIZED_EVENT } from './api.js';
import { copyText } from './feedback.js';
import { applyLanguage, collectStatic, setLanguage } from './language.js';
import { applyPrefs, changeScale, toggleContrast } from './prefs.js';
import { registerView, show, startRouter } from './router.js';
import { refreshMe, renderSession, signOut } from './session.js';
import { speak, stopSpeaking, toggleVoice } from './voice.js';
import * as activity from './views/activity.js';
import * as circle from './views/circle.js';
import * as entry from './views/entry.js';
import * as medicines from './views/medicines.js';
import * as today from './views/today.js';
import * as visits from './views/visits.js';

const TEXT_STEP = 0.1;

function onLanguageChange(e) {
  stopSpeaking();
  setLanguage(e.target.value);
  renderSession();
  $('#summary-out').replaceChildren();
  show(state.view, { focus: false });
  speak(t('Language changed to English'));
}

/** Header controls shared by every view. */
function wireHeader() {
  $('#btn-text-larger').addEventListener('click', () => changeScale(TEXT_STEP));
  $('#btn-text-smaller').addEventListener('click', () => changeScale(-TEXT_STEP));
  $('#btn-contrast').addEventListener('click', toggleContrast);
  $('#btn-voice').addEventListener('click', toggleVoice);
  $('#lang-select').addEventListener('change', onLanguageChange);
  $('#btn-signout').addEventListener('click', signOut);
  $('#btn-copy-code').addEventListener('click', () => copyText(state.profile.id, t('Circle code copied.')));
  window.addEventListener(UNAUTHORIZED_EVENT, signOut);
}

async function init() {
  collectStatic();
  applyPrefs();
  wireHeader();
  for (const view of [entry, today, medicines, visits, circle]) view.wire();
  registerView('today', today.load);
  registerView('medicines', medicines.load);
  registerView('appointments', visits.load);
  registerView('circle', circle.load);
  registerView('activity', activity.load);
  applyLanguage();
  try {
    state.config = await api('/config');
  } catch {
    state.config = {};
  }
  if (state.token) {
    try { await refreshMe(); } catch { /* an expired sign-in triggers UNAUTHORIZED_EVENT → signOut */ }
  }
  startRouter();
}

init();
