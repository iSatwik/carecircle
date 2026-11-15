'use strict';

/**
 * Request schemas (zod). Every write endpoint validates its body against one of
 * these, which strips unknown fields and bounds string lengths.
 */

const { z } = require('zod');
const { DateTime, IANAZone } = require('luxon');

const text = (max) => z.string().trim().max(max);
const requiredText = (max) => z.string().trim().min(1, 'Required').max(max);
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const optionalEmail = z.union([email, z.literal('')]).optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const role = z.enum(['elder', 'caretaker', 'family']);
const timezone = z.string().refine((tz) => IANAZone.isValidZone(tz), 'Unknown timezone');
const passcode = z.string().min(6, 'Passcode must be at least 6 characters').max(64);
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use YYYY-MM-DDTHH:MM')
  .refine((v) => DateTime.fromISO(v).isValid, 'Invalid date/time');

const member = z.object({
  name: requiredText(80),
  email: optionalEmail,
  role,
});

const createCircle = z.object({
  elderName: requiredText(80),
  elderEmail: optionalEmail,
  timezone: timezone.optional(),
  passcode,
  requireElderApproval: z.boolean().optional(),
  member,
});

const joinCircle = z.object({
  circleCode: z.string().trim().toUpperCase().regex(/^CC-[A-Z0-9]{6}$/, 'Circle code looks like CC-XXXXXX'),
  passcode,
  member,
});

const medicationBase = z.object({
  name: requiredText(100),
  dosage: text(60).optional(),
  instructions: text(300).optional(),
  times: z.array(time).min(1, 'Add at least one time').max(8).transform((t) => [...new Set(t)].sort()),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  pillsRemaining: z.number().int().min(0).max(10000).optional(),
  pillsPerDose: z.number().int().min(1).max(20).optional(),
  refillThreshold: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});

const createMedication = medicationBase.refine(
  (m) => !m.startDate || !m.endDate || m.startDate <= m.endDate,
  { message: 'End date must be after start date', path: ['endDate'] },
);
const updateMedication = medicationBase.partial().refine((m) => Object.keys(m).length > 0, 'Nothing to update');

const logDose = z.object({
  status: z.enum(['taken', 'skipped']),
  note: text(200).optional(),
});

const appointmentBase = z.object({
  doctor: requiredText(100),
  specialty: text(60).optional(),
  datetime: localDateTime,
  durationMin: z.number().int().min(5).max(480).optional(),
  location: text(200).optional(),
  notes: text(500).optional(),
});
const updateAppointment = appointmentBase.partial().refine((a) => Object.keys(a).length > 0, 'Nothing to update');

const updateProfile = z
  .object({
    elderName: requiredText(80).optional(),
    elderEmail: optionalEmail,
    timezone: timezone.optional(),
    requireElderApproval: z.boolean().optional(),
    conditions: text(500).optional(),
    allergies: text(300).optional(),
    emergencyContact: text(200).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update');

const changePasscode = z.object({ currentPasscode: passcode, newPasscode: passcode });

const notify = z.object({
  upcoming: z.boolean().optional(),
  missed: z.boolean().optional(),
  escalation: z.boolean().optional(),
  appointments: z.boolean().optional(),
  refill: z.boolean().optional(),
});

const decision = z.object({ approve: z.boolean() });

const checkin = z
  .object({
    mood: z.enum(['good', 'okay', 'unwell']),
    systolic: z.number().int().min(50).max(260).optional(),
    diastolic: z.number().int().min(30).max(160).optional(),
    sugar: z.number().int().min(20).max(600).optional(),
    note: text(300).optional(),
  })
  .refine((c) => (c.systolic === undefined) === (c.diastolic === undefined), {
    message: 'Enter both blood pressure numbers',
    path: ['diastolic'],
  });

const sos = z.object({ message: text(200).optional() });

const lang = z.enum(['en', 'hi', 'te']);
const speak = z.object({ text: z.string().trim().min(1).max(1200), lang: lang.default('en') });

module.exports = {
  createCircle,
  joinCircle,
  createMedication,
  updateMedication,
  logDose,
  appointment: appointmentBase,
  updateAppointment,
  updateProfile,
  changePasscode,
  notify,
  decision,
  checkin,
  sos,
  speak,
  lang,
};
