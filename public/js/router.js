/** Hash-based navigation between the app's views. */
import { $, $$, state, t } from './core.js';
import { toast } from './feedback.js';

const VIEWS = ['today', 'medicines', 'appointments', 'circle', 'activity'];
const TITLES = { welcome: 'Welcome', today: 'Today', medicines: 'Medicines', appointments: 'Doctor visits', circle: 'Care circle', activity: 'Activity' };

/** @type {Record<string, () => Promise<void>>} */
const loaders = {};

/** Registers the function that fetches and renders a view's data each time it is shown. */
export function registerView(name, load) {
  loaders[name] = load;
}

/** Signed-out visitors always get the welcome view; unknown views fall back to Today. */
function resolveView(requested) {
  if (!state.token) return 'welcome';
  return VIEWS.includes(requested) ? requested : 'today';
}

/**
 * Shows a view. Signed-out visitors always see the welcome view.
 * Focus moves to the view's heading so screen-reader users hear where they are.
 */
export function show(requested, { focus = true } = {}) {
  const view = resolveView(requested);
  $$('.view').forEach((s) => { s.hidden = s.id !== `view-${view}`; });
  $$('#tabs a').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const signedIn = Boolean(state.token);
  $('#tabs').hidden = !signedIn;
  $('#session-bar').hidden = !signedIn;
  document.body.classList.toggle('signed-in', signedIn);
  state.view = view;
  document.title = `${t(TITLES[view])} – CareCircle`;
  loaders[view]?.().catch((e) => toast(e.message, true));
  if (focus) {
    const heading = $(`#view-${view} h1`);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }
}

/** Shows the view named in the URL hash, now and whenever it changes. */
export function startRouter() {
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 'today', { focus: false });
}
