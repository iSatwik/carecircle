/**
 * Shared front-end state, storage and translation.
 * Every other module imports from here; this module imports nothing.
 */

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement | null} */
export const $ = (sel, root = document) => root.querySelector(sel);

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement[]} */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Storage keys used by the app, in one place. */
export const KEYS = Object.freeze({
  token: 'cc_token',
  lang: 'cc_lang',
  voice: 'cc_voice',
  scale: 'cc_scale',
  contrast: 'cc_contrast',
});

/**
 * Web storage that never throws (it can be unavailable in private mode or sandboxed frames).
 * `get/set/del` use sessionStorage (the sign-in token); `pref` uses localStorage (display choices).
 */
export const storage = {
  get(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* private mode */ }
  },
  del(key) {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  },
  /** Reads a preference when `value` is omitted, otherwise stores it. */
  pref(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch { /* ignore */ }
    return null;
  },
};

export const LANGS = Object.freeze(['en', 'hi', 'te']);
export const LOCALE = Object.freeze({ en: 'en-IN', hi: 'hi-IN', te: 'te-IN' });

/** Picks the saved language, else the browser's language when supported, else English. */
function initialLanguage() {
  const saved = storage.pref(KEYS.lang);
  if (LANGS.includes(saved)) return saved;
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGS.includes(browser) ? browser : 'en';
}

/** The single mutable app state. */
export const state = {
  token: storage.get(KEYS.token),
  me: null,
  profile: null,
  config: null,
  today: null,
  mood: null,
  healthCard: null,
  view: 'welcome',
  lang: initialLanguage(),
};

/**
 * Translates an English source string into the current language.
 * `{name}` placeholders are filled from `vars`; unknown strings fall back to English.
 * @param {string} source
 * @param {Record<string, string | number>} [vars]
 */
export function t(source, vars = {}) {
  const table = (window.CC_I18N || {})[state.lang] || {};
  const text = (state.lang !== 'en' && table[source]) || source;
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

/** BCP 47 locale for dates and numbers in the current language. */
export const locale = () => LOCALE[state.lang];

/** True when the signed-in member is the elder. */
export const isElder = () => state.me?.role === 'elder';
