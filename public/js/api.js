/** JSON API client and form helpers. */
import { $$, state, t } from './core.js';
import { toast } from './feedback.js';

/** Fired on window when the server rejects the sign-in token, so the app can sign out. */
export const UNAUTHORIZED_EVENT = 'cc:unauthorized';

/**
 * Calls the CareCircle API.
 * @param {string} path path after `/api`
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>} parsed JSON, or null for 204 responses
 * @throws {Error} with a translated message and optional `details` for invalid fields
 */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const err = new Error(t(data.error || 'That did not work. Please try again.'));
    err.details = data.details;
    throw err;
  }
  return data;
}

/**
 * Runs an action while a button shows as busy; any error becomes a toast.
 * @template T
 * @param {HTMLButtonElement | null} button
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | undefined>}
 */
export async function withBusy(button, fn) {
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    return undefined;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

/** Reads a form into a plain object: checkboxes → booleans, numbers → numbers, text trimmed. */
export function formData(form) {
  const out = {};
  for (const input of $$('input, textarea, select', form)) {
    if (!input.name || (input.type === 'radio' && !input.checked)) continue;
    if (input.type === 'checkbox') out[input.name] = input.checked;
    else if (input.type === 'number') {
      if (input.value !== '') out[input.name] = Number(input.value);
    } else out[input.name] = input.value.trim();
  }
  return out;
}

/** Marks the fields named in a validation error as invalid (and clears the rest). */
export function markInvalid(form, details) {
  $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
  for (const d of details || []) {
    const name = d.field.split('.').pop();
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
}

/**
 * Submits a form through `send`, highlighting invalid fields on a validation error.
 * @param {HTMLFormElement} form
 * @param {() => Promise<void>} send
 */
export function submitForm(form, send) {
  return withBusy(form.querySelector('[type=submit]'), async () => {
    try {
      await send();
      markInvalid(form, []);
    } catch (err) {
      markInvalid(form, err.details);
      throw err;
    }
  });
}
