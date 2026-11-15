'use strict';

/**
 * Natural-sounding speech with Google Cloud Text-to-Speech (Chirp 3: HD voices).
 *
 * Auth: an API key (TTS_API_KEY) or, on Cloud Run, the service account through
 * Application Default Credentials. When TTS is not available the API answers 204
 * and the browser falls back to its best built-in voice.
 */

const logger = require('../utils/logger');

const LANGS = Object.freeze({
  en: { languageCode: 'en-IN' },
  hi: { languageCode: 'hi-IN' },
  te: { languageCode: 'te-IN' },
});

class TtsService {
  /**
   * @param {{enabled:boolean, apiKey:string, voiceName:string, timeoutMs:number}} opts
   * @param {{fetchImpl?:Function, getToken?:Function}} deps injectable for tests
   */
  constructor(opts, deps = {}) {
    this.opts = opts;
    this.fetch = deps.fetchImpl || globalThis.fetch;
    this.getToken = deps.getToken || (opts.apiKey ? null : TtsService.adcTokenGetter());
    this.cache = new Map(); // small LRU of recent phrases → audio
    this.pausedUntil = 0; // back off after auth/permission errors
  }

  static adcTokenGetter() {
    let auth;
    return async () => {
      if (!auth) {
        const { GoogleAuth } = require('google-auth-library');
        auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      }
      return auth.getAccessToken();
    };
  }

  get enabled() {
    return Boolean(this.opts.enabled) && Date.now() >= this.pausedUntil;
  }

  voiceFor(lang) {
    const { languageCode } = LANGS[lang] || LANGS.en;
    return { languageCode, name: `${languageCode}-Chirp3-HD-${this.opts.voiceName || 'Aoede'}` };
  }

  async headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) h['x-goog-api-key'] = this.opts.apiKey;
    else {
      const token = await this.getToken();
      if (!token) throw new Error('No Google credentials available');
      h.Authorization = `Bearer ${token}`;
    }
    return h;
  }

  async request(text, voice) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs || 12_000);
    try {
      const res = await this.fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: 'MP3' } }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`Text-to-Speech HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      return data.audioContent || null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @returns {Promise<{audio:string, mime:string}|null>} base64 MP3, or null when unavailable */
  async synthesize(text, lang = 'en') {
    if (!this.enabled || !text) return null;
    const key = `${lang}:${text}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, hit); // refresh LRU position
      return hit;
    }
    const voice = this.voiceFor(lang);
    try {
      let audio;
      try {
        audio = await this.request(text, voice);
      } catch (err) {
        // Unknown voice name in this region/project: let Google pick the language's default voice.
        if (err.status !== 400) throw err;
        audio = await this.request(text, { languageCode: voice.languageCode });
      }
      if (!audio) return null;
      const result = { audio, mime: 'audio/mpeg' };
      this.cache.set(key, result);
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      return result;
    } catch (err) {
      if ([401, 403].includes(err.status) || /credentials/i.test(err.message)) {
        this.pausedUntil = Date.now() + 10 * 60 * 1000; // avoid hammering a disabled API
      }
      logger.warn('tts.failed', { error: err.message });
      return null;
    }
  }
}

module.exports = { TtsService, LANGS };
