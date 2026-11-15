/** Formatting for times, dates, names and statuses in the current language. */
import { locale, t } from './core.js';

/** "08:30" → "8:30 am" in the current locale. */
export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

/** An ISO timestamp as a short weekday, date and time. */
export const fmtDateTime = (iso) => new Date(iso).toLocaleString(locale(), {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

/** The date part of a local "YYYY-MM-DDTHH:mm" value, as a local Date. */
export const localDate = (local) => new Date(`${local.split('T')[0]}T00:00:00`);

/** A local "YYYY-MM-DDTHH:mm" value as "Monday, 3 March, 10:30 am". */
export function localDateTimeLabel(local) {
  const day = localDate(local).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return `${day}, ${fmtTime(local.split('T')[1])}`;
}

/** Up to two initials for an avatar ("Lakshmi Rao (Amma)" → "LR"). */
export function initials(name) {
  const words = name.replace(/\(.*?\)/g, '').split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export const firstName = (name) => name.split(/\s+/)[0];

const STATUS = { taken: 'Taken', skipped: 'Skipped', missed: 'Missed', overdue: 'Not taken yet', due: 'Take now', upcoming: 'Later' };
const ROLE = { elder: 'elder', caretaker: 'caretaker', family: 'family' };

export const statusLabel = (s) => t(STATUS[s] || s);
export const roleLabel = (r) => t(ROLE[r] || r);

/** Short weekday name for ISO day numbers 1 (Monday) … 7 (Sunday). */
export const dayName = (n) => new Date(2024, 0, n).toLocaleDateString(locale(), { weekday: 'short' }); // 1 Jan 2024 was a Monday

/** Pill-box compartments. `to` may pass 24 so that night wraps past midnight. */
export const SLOTS = Object.freeze([
  { key: 'morning', label: 'Morning', range: '4 AM – noon', icon: 'sun', from: 4, to: 12 },
  { key: 'afternoon', label: 'Afternoon', range: 'noon – 5 PM', icon: 'noon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', range: '5 – 9 PM', icon: 'dusk', from: 17, to: 21 },
  { key: 'night', label: 'Night', range: '9 PM – 4 AM', icon: 'moon', from: 21, to: 28 },
]);

/** The compartment a "HH:mm" dose time belongs to. */
export function slotOf(hhmm) {
  let h = Number(hhmm.split(':')[0]);
  if (h < 4) h += 24;
  return SLOTS.find((s) => h >= s.from && h < s.to) || SLOTS[0];
}

/** "BP 130/85, sugar 110 mg/dL" from a check-in's readings. */
export function vitalsText(v) {
  return [
    v.systolic ? t('BP {a}/{b}', { a: v.systolic, b: v.diastolic }) : '',
    v.sugar ? t('sugar {n} mg/dL', { n: v.sugar }) : '',
  ].filter(Boolean).join(', ');
}
