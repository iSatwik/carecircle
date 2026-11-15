/** Translates the static page text in place; the English original of each string is remembered. */
import { $, KEYS, LANGS, state, storage, t } from './core.js';
import { renderVoiceButton } from './voice.js';

const TRANSLATABLE_ATTRS = ['placeholder', 'aria-label'];
const staticText = [];
const staticAttrs = [];

/** Records every visible text node and translatable attribute once, before the first translation. */
export function collectStatic() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.data.trim() && !n.parentElement.closest('script, style, select, .sprite')
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) staticText.push({ node: n, en: n.data.trim(), raw: n.data });
  for (const node of document.querySelectorAll('[placeholder], [aria-label]')) {
    for (const attr of TRANSLATABLE_ATTRS) {
      if (node.hasAttribute(attr)) staticAttrs.push({ node, attr, en: node.getAttribute(attr) });
    }
  }
}

/** Re-renders all static text in the current language. */
export function applyLanguage() {
  document.documentElement.lang = state.lang;
  for (const item of staticText) item.node.data = item.raw.replace(item.en, t(item.en));
  for (const { node, attr, en } of staticAttrs) node.setAttribute(attr, t(en));
  $('#lang-select').value = state.lang;
  renderVoiceButton();
}

/** Switches language (falls back to English for unknown codes) and remembers it. */
export function setLanguage(lang) {
  state.lang = LANGS.includes(lang) ? lang : 'en';
  storage.pref(KEYS.lang, state.lang);
  applyLanguage();
}
