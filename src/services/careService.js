'use strict';

/**
 * Core domain logic for a care circle (one elder plus their caretakers and family).
 *
 * Elder-centred rules enforced here:
 *  - The elder can switch on "my approval required": medicine changes made by
 *    others become change requests that only the elder can approve or reject.
 *  - Only the elder can change circle settings, the passcode or remove members.
 *  - Every action is written to an activity log everyone in the circle can read.
 *
 * The methods live in one module per area under ./care/ and are mixed into this
 * class, so they share the injected store, config, AI and email services.
 */

const { DateTime } = require('luxon');
const { DEFAULT_NOTIFY, publicProfile } = require('./care/shared');

const AREAS = [
  require('./care/circles'),
  require('./care/medications'),
  require('./care/doses'),
  require('./care/appointments'),
  require('./care/wellbeing'),
  require('./care/activity'),
];

class CareService {
  /**
   * @param {object} deps
   * @param {object} deps.store  data store (memory or Firestore)
   * @param {object} deps.config app configuration
   * @param {object} deps.ai     Gemini-backed explanations and summaries
   * @param {object} [deps.email] email sender; alerts are skipped without it
   */
  constructor({ store, config, ai, email }) {
    this.store = store;
    this.config = config;
    this.ai = ai;
    this.email = email;
  }

  /** Current time in UTC (tests override this to control the clock). */
  now() {
    return DateTime.utc();
  }
}

for (const area of AREAS) {
  for (const [name, fn] of Object.entries(area)) {
    if (name in CareService.prototype) throw new Error(`CareService method defined twice: ${name}`);
    Object.defineProperty(CareService.prototype, name, { value: fn, writable: true, configurable: true });
  }
}

module.exports = { CareService, DEFAULT_NOTIFY, publicProfile };
