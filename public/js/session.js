/** The signed-in member, their circle and the session bar. */
import { $, $$, KEYS, isElder, state, storage, t } from './core.js';
import { api } from './api.js';
import { initials, roleLabel } from './format.js';
import { show } from './router.js';

/** Stores a fresh sign-in returned by create/join. */
export function setSession({ token, member, profile }) {
  state.token = token;
  storage.set(KEYS.token, token);
  state.me = member;
  state.profile = profile;
  renderSession();
}

/** Forgets the sign-in and returns to the welcome view. */
export function signOut() {
  state.token = null;
  state.me = null;
  state.profile = null;
  storage.del(KEYS.token);
  location.hash = '';
  show('welcome');
}

/** Fills in the session bar and shows or hides elder-only controls. */
export function renderSession() {
  if (!state.me || !state.profile) return;
  $('#session-elder').textContent = t("{name}'s circle", { name: state.profile.elderName });
  $('#session-code').textContent = state.profile.id;
  $('#session-avatar').textContent = initials(state.me.name);
  $('#session-me').textContent = `${state.me.name} (${roleLabel(state.me.role)})`;
  $$('.elder-only').forEach((n) => { n.hidden = !isElder(); });
}

/** Reloads the member and circle from the server. */
export async function refreshMe() {
  const data = await api('/me');
  state.me = data.member;
  state.profile = data.profile;
  renderSession();
}
