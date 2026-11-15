/**
 * Natural speech: Google Cloud Text-to-Speech (Chirp 3 HD) through our API when the
 * server has it, otherwise the most natural voice this browser offers.
 */
import { $, KEYS, LOCALE, state, storage, t } from './core.js';
import { showToast } from './dom.js';

const MAX_SERVER_CHARS = 1200;
const MAX_UTTERANCE_CHARS = 180;

const voice = {
  enabled: storage.pref(KEYS.voice) !== 'off',
  audio: null,
  /** Bumped on every new request so stale audio never plays over newer speech. */
  seq: 0,
  browserVoices: [],
  warnedMissing: {},
};

function loadVoices() {
  try {
    voice.browserVoices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  } catch {
    voice.browserVoices = [];
  }
}
if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

const normalise = (lang) => lang.toLowerCase().replace('_', '-');

/** Scores an installed voice: neural and network voices sound far less robotic. */
function voiceScore(v, wantedLocale) {
  const n = v.name.toLowerCase();
  let score = 0;
  if (/natural|neural|online/.test(n)) score += 6; // Edge / Windows neural voices
  if (/google/.test(n)) score += 4; // Chrome's network voices
  if (/premium|enhanced|siri/.test(n)) score += 4; // Apple high-quality voices
  if (normalise(v.lang) === wantedLocale) score += 2;
  if (/female|swara|neerja|heera|shruti|kalpana|lekha|aditi|veena|mohan|madhur|prabhat/.test(n)) score += 1;
  if (/compact|espeak/.test(n)) score -= 5;
  return score;
}

/** Picks the most natural-sounding installed voice for a language, or null. */
function bestBrowserVoice(lang) {
  const wanted = LOCALE[lang].toLowerCase();
  const candidates = voice.browserVoices.filter((v) => v.lang && normalise(v.lang).startsWith(lang));
  return candidates.sort((a, b) => voiceScore(b, wanted) - voiceScore(a, wanted))[0] || null;
}

/** Splits text into sentence groups short enough that Chrome won't cut them off. */
function chunkSentences(text) {
  const parts = [];
  for (const piece of text.split(/(?<=[.!?।])\s+/)) {
    const last = parts.length - 1;
    if (last >= 0 && parts[last].length + piece.length < MAX_UTTERANCE_CHARS) parts[last] += ` ${piece}`;
    else parts.push(piece);
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

function speakWithBrowser(text, lang, seq) {
  if (!window.speechSynthesis) return;
  const v = bestBrowserVoice(lang);
  if (!v && lang !== 'en') {
    if (!voice.warnedMissing[lang]) {
      voice.warnedMissing[lang] = true;
      showToast(t('This device has no voice for this language. The text is shown on screen instead.'), true);
    }
    return;
  }
  for (const part of chunkSentences(text)) {
    if (seq !== voice.seq) return;
    const u = new SpeechSynthesisUtterance(part);
    if (v) u.voice = v;
    u.lang = v ? v.lang : LOCALE[lang];
    u.rate = 0.95;
    u.pitch = 1.02;
    speechSynthesis.speak(u);
  }
}

/** Plays server-generated speech. Resolves true when it played. */
async function speakWithServer(text, lang, seq) {
  const res = await fetch('/api/circle/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ text: text.slice(0, MAX_SERVER_CHARS), lang }),
  });
  if (res.status !== 200) return false;
  const { audio, mime } = await res.json();
  if (seq !== voice.seq) return true;
  const bytes = Uint8Array.from(atob(audio), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  voice.audio = new Audio(url);
  voice.audio.addEventListener('ended', () => URL.revokeObjectURL(url));
  await voice.audio.play();
  return true;
}

/** Stops anything currently being spoken. */
export function stopSpeaking() {
  voice.seq += 1;
  if (voice.audio) {
    voice.audio.pause();
    voice.audio = null;
  }
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

/**
 * Speaks text in the current language.
 * @param {string} text
 * @param {{ force?: boolean }} [options] `force` ignores the voice switch (used by "Read my day")
 */
export async function speak(text, { force = false } = {}) {
  if (!text || (!voice.enabled && !force)) return;
  stopSpeaking();
  const seq = voice.seq;
  const lang = state.lang;
  if (state.config?.ttsEnabled && state.token) {
    try {
      if (await speakWithServer(text, lang, seq)) return;
    } catch { /* fall back to the browser voice */ }
  }
  if (seq === voice.seq) speakWithBrowser(text, lang, seq);
}

/** Updates the voice on/off button to match the current setting and language. */
export function renderVoiceButton() {
  const b = $('#btn-voice');
  b.setAttribute('aria-pressed', String(voice.enabled));
  b.querySelector('span').textContent = voice.enabled ? t('Voice on') : t('Voice off');
  b.setAttribute('aria-label', voice.enabled ? t('Spoken updates are on') : t('Spoken updates are off'));
}

/** Turns spoken updates on or off and remembers the choice. */
export function toggleVoice() {
  voice.enabled = !voice.enabled;
  storage.pref(KEYS.voice, voice.enabled ? 'on' : 'off');
  renderVoiceButton();
  if (voice.enabled) speak(t('Spoken updates are on'));
  else {
    stopSpeaking();
    showToast(t('Spoken updates are off'));
  }
}
