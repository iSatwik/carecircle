'use strict';

/**
 * Deep links into Google services that need no extra API keys:
 *  - Google Calendar "add event" template for appointments
 *  - Google Maps search for the clinic / hospital location
 */

const { DateTime } = require('luxon');

const fmt = (dt) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

function calendarLink(appt, timezone) {
  const start = DateTime.fromISO(appt.datetime, { zone: timezone });
  const end = start.plus({ minutes: appt.durationMin || 30 });
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Doctor visit: ${appt.doctor}${appt.specialty ? ` (${appt.specialty})` : ''}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: appt.notes || 'Added from CareCircle',
    location: appt.location || '',
    ctz: timezone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function mapsLink(location) {
  if (!location) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

module.exports = { calendarLink, mapsLink };
