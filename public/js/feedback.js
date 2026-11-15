/** User feedback: spoken toasts, an accessible confirm dialog and copy-to-clipboard. */
import { $, t } from './core.js';
import { showToast } from './dom.js';
import { speak } from './voice.js';

/** Shows a message and, when the voice is on, says it out loud. */
export function toast(message, isError = false) {
  showToast(message, isError);
  speak(message);
}

/**
 * Accessible in-page confirmation (native confirm() is blocked in sandboxed frames).
 * @param {string} message
 * @param {string} [yesLabel]
 * @returns {Promise<boolean>}
 */
export function askConfirm(message, yesLabel = t('Yes')) {
  const dlg = $('#dialog-confirm');
  const yes = $('#confirm-yes');
  const no = $('#confirm-no');
  $('#confirm-title').textContent = t('Are you sure?');
  $('#confirm-text').textContent = message;
  yes.textContent = yesLabel;
  return new Promise((resolve) => {
    const done = (value) => {
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      dlg.removeEventListener('cancel', onNo);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    dlg.addEventListener('cancel', onNo);
    dlg.showModal();
    no.focus();
  });
}

/** Copies text and confirms, or explains how to copy by hand when the clipboard is blocked. */
export async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    toast(t('Copying is blocked here. Select the text and copy it instead.'), true);
  }
}
