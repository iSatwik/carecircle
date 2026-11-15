/** Display preferences: text size and high contrast, remembered on this device. */
import { $, KEYS, storage, t } from './core.js';
import { toast } from './feedback.js';

const MIN_SCALE = 0.9;
const MAX_SCALE = 1.6;

const currentScale = () => Number(storage.pref(KEYS.scale)) || 1;

/** Applies the saved text size and contrast to the page. */
export function applyPrefs() {
  document.documentElement.style.setProperty('--scale', String(currentScale()));
  const contrast = storage.pref(KEYS.contrast) === '1';
  document.documentElement.classList.toggle('contrast', contrast);
  $('#btn-contrast').setAttribute('aria-pressed', String(contrast));
}

/** Grows or shrinks all text by `delta` (e.g. 0.1 = 10%), within sensible limits. */
export function changeScale(delta) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale() + delta));
  storage.pref(KEYS.scale, next.toFixed(2));
  applyPrefs();
  toast(t('Text size {n}%', { n: Math.round(next * 100) }));
}

/** Switches high-contrast mode on or off. */
export function toggleContrast() {
  storage.pref(KEYS.contrast, storage.pref(KEYS.contrast) === '1' ? '0' : '1');
  applyPrefs();
}
