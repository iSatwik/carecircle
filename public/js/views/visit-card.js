/** The doctor-visit card used on both the Today and Doctor visits views. */
import { locale, t } from '../core.js';
import { el } from '../dom.js';
import { localDate, localDateTimeLabel } from '../format.js';

/** A tear-off calendar leaf showing the visit's month and day. */
export function dateLeaf(local) {
  const d = localDate(local);
  return el('div', { class: 'date-leaf', 'aria-hidden': 'true' },
    el('span', { class: 'm', text: d.toLocaleDateString(locale(), { month: 'short' }) }),
    el('span', { class: 'd', text: String(d.getDate()) }));
}

const externalLink = (href, label) => el('a', { class: 'btn quiet small', href, target: '_blank', rel: 'noopener noreferrer' }, label);

/**
 * Visit details plus Google Calendar and Google Maps links (in a `.actions` row).
 * @param {object} a appointment from the API
 * @param {{ compact?: boolean }} [options] compact hides the notes
 */
export function visitBody(a, { compact = false } = {}) {
  return el('div', {},
    el('h3', { text: `${a.doctor}${a.specialty ? `, ${a.specialty}` : ''}` }),
    el('p', { text: localDateTimeLabel(a.datetime) }),
    a.location ? el('p', { text: a.location }) : null,
    !compact && a.notes ? el('p', { text: `${t('Notes')}: ${a.notes}` }) : null,
    el('div', { class: 'actions' },
      externalLink(a.calendarUrl, t('Add to Google Calendar')),
      a.mapsUrl ? externalLink(a.mapsUrl, t('Directions in Google Maps')) : null));
}
