/* CareCircle front end – dependency-free, CSP-safe (no inline scripts, no innerHTML with data). */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ------------------------------------------------------------ storage (may be unavailable)
  const storage = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, v) { try { sessionStorage.setItem(key, v); } catch { /* private mode */ } },
    del(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
    pref(key, v) {
      try { if (v === undefined) return localStorage.getItem(key); localStorage.setItem(key, v); } catch { /* ignore */ }
      return null;
    },
  };

  const state = { token: storage.get('cc_token'), me: null, profile: null, config: null, today: null, mood: null, healthCard: null, view: 'welcome' };

  // ------------------------------------------------------------ language
  const LANGS = ['en', 'hi', 'te'];
  const LOCALE = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };
  const browserLang = (navigator.language || 'en').slice(0, 2);
  state.lang = LANGS.includes(storage.pref('cc_lang')) ? storage.pref('cc_lang') : (LANGS.includes(browserLang) ? browserLang : 'en');
  const DICT = window.CC_I18N || {};
  /** Translate an English source string; {name} placeholders are filled from vars. */
  function t(source, vars = {}) {
    const table = DICT[state.lang] || {};
    const text = (state.lang !== 'en' && table[source]) || source;
    return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
  }
  const locale = () => LOCALE[state.lang];

  /** Static page text is translated in place; the English original is remembered. */
  const staticText = [];
  const staticAttrs = [];
  function collectStatic() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data.trim() && !n.parentElement.closest('script, style, select, .sprite') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) staticText.push({ node: n, en: n.data.trim(), raw: n.data });
    for (const elx of document.querySelectorAll('[placeholder], [aria-label]')) {
      for (const attr of ['placeholder', 'aria-label']) if (elx.hasAttribute(attr)) staticAttrs.push({ elx, attr, en: elx.getAttribute(attr) });
    }
  }
  function applyLanguage() {
    document.documentElement.lang = state.lang;
    for (const item of staticText) {
      const translated = t(item.en);
      item.node.data = item.raw.replace(item.en, translated);
    }
    for (const { elx, attr, en } of staticAttrs) elx.setAttribute(attr, t(en));
    $('#lang-select').value = state.lang;
    renderVoiceButton();
  }

  // ------------------------------------------------------------ voice
  /**
   * Natural speech: Google Cloud Text-to-Speech (Chirp 3 HD) through our API when the
   * server has it, otherwise the most natural voice this browser offers.
   */
  const voice = {
    enabled: storage.pref('cc_voice') !== 'off',
    audio: null,
    seq: 0,
    browserVoices: [],
    warnedMissing: {},
  };
  function loadVoices() { try { voice.browserVoices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch { voice.browserVoices = []; } }
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }

  /** Picks the most natural-sounding installed voice for a language. */
  function bestBrowserVoice(lang) {
    const want = LOCALE[lang].toLowerCase();
    const prefix = lang;
    const candidates = voice.browserVoices.filter((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
    const score = (v) => {
      const n = v.name.toLowerCase();
      let sc = 0;
      if (/natural|neural|online/.test(n)) sc += 6; // Edge / Windows neural voices
      if (/google/.test(n)) sc += 4; // Chrome's network voices
      if (/premium|enhanced|siri/.test(n)) sc += 4; // Apple high-quality voices
      if (v.lang.toLowerCase().replace('_', '-') === want) sc += 2;
      if (/female|swara|neerja|heera|shruti|kalpana|lekha|aditi|veena|mohan|madhur|prabhat/.test(n)) sc += 1;
      if (/compact|espeak/.test(n)) sc -= 5;
      return sc;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  }

  function stopSpeaking() {
    voice.seq += 1;
    if (voice.audio) { voice.audio.pause(); voice.audio = null; }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }

  function speakWithBrowser(text, lang, seq) {
    if (!window.speechSynthesis) return;
    const v = bestBrowserVoice(lang);
    if (!v && lang !== 'en') {
      if (!voice.warnedMissing[lang]) { voice.warnedMissing[lang] = true; showToast(t('This device has no voice for this language. The text is shown on screen instead.'), true); }
      return;
    }
    // Speak sentence by sentence: sounds more natural and avoids Chrome cutting long speech.
    const sentences = text.split(/(?<=[.!?।])\s+/);
    const parts = [];
    for (const piece of sentences) {
      const last = parts.length - 1;
      if (last >= 0 && parts[last].length + piece.length < 180) parts[last] += ` ${piece}`;
      else parts.push(piece);
    }
    for (const part of parts) {
      if (seq !== voice.seq || !part.trim()) continue;
      const u = new SpeechSynthesisUtterance(part.trim());
      if (v) u.voice = v;
      u.lang = v ? v.lang : LOCALE[lang];
      u.rate = 0.95;
      u.pitch = 1.02;
      speechSynthesis.speak(u);
    }
  }

  /** Speaks text in the current language. `force` ignores the voice switch (Read my day). */
  async function speak(text, { force = false } = {}) {
    if (!text || (!voice.enabled && !force)) return;
    stopSpeaking();
    const seq = voice.seq;
    const lang = state.lang;
    if (state.config?.ttsEnabled && state.token) {
      try {
        const res = await fetch('/api/circle/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ text: text.slice(0, 1200), lang }),
        });
        if (res.status === 200) {
          const { audio, mime } = await res.json();
          if (seq !== voice.seq) return;
          const bytes = Uint8Array.from(atob(audio), (ch) => ch.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          voice.audio = new Audio(url);
          voice.audio.addEventListener('ended', () => URL.revokeObjectURL(url));
          await voice.audio.play();
          return;
        }
      } catch { /* fall through to the browser voice */ }
    }
    if (seq === voice.seq) speakWithBrowser(text, lang, seq);
  }

  function renderVoiceButton() {
    const b = $('#btn-voice');
    b.setAttribute('aria-pressed', String(voice.enabled));
    b.querySelector('span').textContent = voice.enabled ? t('Voice on') : t('Voice off');
    b.setAttribute('aria-label', voice.enabled ? t('Spoken updates are on') : t('Spoken updates are off'));
  }

  // ------------------------------------------------------------ DOM helpers
  /** Creates an element; text always goes through textContent (XSS-safe). */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
    return node;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  // ------------------------------------------------------------ feedback
  let toastTimer;
  function showToast(message, isError = false) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.toggle('error', isError);
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 4800);
  }
  /** Shows a message and, when the voice is on, says it out loud. */
  function toast(message, isError = false) {
    showToast(message, isError);
    speak(message);
  }

  /** Accessible in-page confirmation (native confirm() is blocked in sandboxed frames). */
  function askConfirm(message, yesLabel = t('Yes')) {
    const dlg = $('#dialog-confirm');
    $('#confirm-title').textContent = t('Are you sure?');
    $('#confirm-text').textContent = message;
    $('#confirm-yes').textContent = yesLabel;
    return new Promise((resolve) => {
      const done = (value) => {
        $('#confirm-yes').removeEventListener('click', onYes);
        $('#confirm-no').removeEventListener('click', onNo);
        dlg.removeEventListener('cancel', onNo);
        if (dlg.open) dlg.close();
        resolve(value);
      };
      const onYes = () => done(true);
      const onNo = () => done(false);
      $('#confirm-yes').addEventListener('click', onYes);
      $('#confirm-no').addEventListener('click', onNo);
      dlg.addEventListener('cancel', onNo);
      dlg.showModal();
      $('#confirm-no').focus();
    });
  }

  async function copyText(text, okMessage) {
    try { await navigator.clipboard.writeText(text); toast(okMessage); } catch { toast(t('Copying is blocked here. Select the text and copy it instead.'), true); }
  }

  // ------------------------------------------------------------ API
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) signOut();
    if (!res.ok) {
      const err = new Error(t(data.error || 'That did not work. Please try again.'));
      err.details = data.details;
      throw err;
    }
    return data;
  }

  async function withBusy(button, fn) {
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try { return await fn(); } catch (err) { toast(err.message, true); return undefined; } finally {
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  function formData(form) {
    const out = {};
    for (const input of $$('input, textarea, select', form)) {
      if (!input.name || (input.type === 'radio' && !input.checked)) continue;
      if (input.type === 'checkbox') out[input.name] = input.checked;
      else if (input.type === 'number') { if (input.value !== '') out[input.name] = Number(input.value); }
      else out[input.name] = input.value.trim();
    }
    return out;
  }

  function markInvalid(form, details) {
    $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
    (details || []).forEach((d) => {
      const name = d.field.split('.').pop();
      const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
      if (input) input.setAttribute('aria-invalid', 'true');
    });
  }

  // ------------------------------------------------------------ formatting
  const fmtTime = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
  };
  const fmtDateTime = (iso) => new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const localDate = (local) => new Date(`${local.split('T')[0]}T00:00:00`);
  const localDateTimeLabel = (local) => `${localDate(local).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmtTime(local.split('T')[1])}`;
  const initials = (name) => name.replace(/\(.*?\)/g, '').split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const firstName = (name) => name.split(/\s+/)[0];
  const STATUS = { taken: 'Taken', skipped: 'Skipped', missed: 'Missed', overdue: 'Not taken yet', due: 'Take now', upcoming: 'Later' };
  const statusLabel = (s) => t(STATUS[s] || s);
  const ROLE = { elder: 'elder', caretaker: 'caretaker', family: 'family' };
  const roleLabel = (r) => t(ROLE[r] || r);
  const dayName = (n) => new Date(2024, 0, n).toLocaleDateString(locale(), { weekday: 'short' }); // 2024-01-01 is a Monday
  const SLOTS = [
    { key: 'morning', label: 'Morning', range: '4 AM – noon', icon: 'sun', from: 4, to: 12 },
    { key: 'afternoon', label: 'Afternoon', range: 'noon – 5 PM', icon: 'noon', from: 12, to: 17 },
    { key: 'evening', label: 'Evening', range: '5 – 9 PM', icon: 'dusk', from: 17, to: 21 },
    { key: 'night', label: 'Night', range: '9 PM – 4 AM', icon: 'moon', from: 21, to: 28 },
  ];
  const slotOf = (hhmm) => {
    let h = Number(hhmm.split(':')[0]);
    if (h < 4) h += 24;
    return SLOTS.find((s) => h >= s.from && h < s.to) || SLOTS[0];
  };
  const isElder = () => state.me?.role === 'elder';

  // ------------------------------------------------------------ display prefs
  function applyPrefs() {
    const scale = Number(storage.pref('cc_scale')) || 1;
    document.documentElement.style.setProperty('--scale', String(scale));
    const contrast = storage.pref('cc_contrast') === '1';
    document.documentElement.classList.toggle('contrast', contrast);
    $('#btn-contrast').setAttribute('aria-pressed', String(contrast));
  }
  function changeScale(delta) {
    const next = Math.min(1.6, Math.max(0.9, (Number(storage.pref('cc_scale')) || 1) + delta));
    storage.pref('cc_scale', next.toFixed(2));
    applyPrefs();
    toast(t('Text size {n}%', { n: Math.round(next * 100) }));
  }

  // ------------------------------------------------------------ navigation
  const VIEWS = ['today', 'medicines', 'appointments', 'circle', 'activity'];
  const TITLES = { welcome: 'Welcome', today: 'Today', medicines: 'Medicines', appointments: 'Doctor visits', circle: 'Care circle', activity: 'Activity' };
  const loaders = {};

  function show(view, { focus = true } = {}) {
    if (!state.token) view = 'welcome';
    else if (!VIEWS.includes(view)) view = 'today';
    $$('.view').forEach((s) => { s.hidden = s.id !== `view-${view}`; });
    $$('#tabs a').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const signedIn = Boolean(state.token);
    $('#tabs').hidden = !signedIn;
    $('#session-bar').hidden = !signedIn;
    document.body.classList.toggle('signed-in', signedIn);
    state.view = view;
    document.title = `${t(TITLES[view])} – CareCircle`;
    if (loaders[view]) loaders[view]().catch((e) => toast(e.message, true));
    if (focus) {
      const heading = $(`#view-${view} h1`);
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
      window.scrollTo({ top: 0 });
    }
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // ------------------------------------------------------------ session
  function setSession(data) {
    state.token = data.token;
    storage.set('cc_token', data.token);
    state.me = data.member;
    state.profile = data.profile;
    renderSession();
  }
  function signOut() {
    state.token = null; state.me = null; state.profile = null;
    storage.del('cc_token');
    location.hash = '';
    show('welcome');
  }
  function renderSession() {
    if (!state.me || !state.profile) return;
    $('#session-elder').textContent = t("{name}'s circle", { name: state.profile.elderName });
    $('#session-code').textContent = state.profile.id;
    $('#session-avatar').textContent = initials(state.me.name);
    $('#session-me').textContent = `${state.me.name} (${roleLabel(state.me.role)})`;
    $$('.elder-only').forEach((n) => { n.hidden = !isElder(); });
  }
  async function refreshMe() {
    const data = await api('/me');
    state.me = data.member;
    state.profile = data.profile;
    renderSession();
  }

  // ============================================================ TODAY
  loaders.today = async () => {
    const [today, adherence, appts, changes, checkins] = await Promise.all([
      api('/circle/today'), api('/circle/adherence?days=7'), api('/circle/appointments'), api('/circle/changes'), api('/circle/checkins'),
    ]);
    state.today = today;
    renderGreeting();
    renderOrganizer(today);
    renderWeek(adherence);
    renderNextAppt(appts[0]);
    renderApprovalBanner(changes);
    renderCheckinLatest(checkins);
  };

  function renderGreeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning, {name}' : h < 17 ? 'Good afternoon, {name}' : 'Good evening, {name}';
    $('#today-title').textContent = isElder() ? t(part, { name: firstName(state.me.name) }) : t("{name}'s day", { name: firstName(state.profile.elderName) });
    $('#today-date').textContent = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function renderOrganizer(today) {
    const box = $('#organizer');
    box.replaceChildren();
    const total = today.doses.length;
    const taken = today.doses.filter((d) => d.status === 'taken').length;
    $('#dose-progress').textContent = total ? t('{taken} of {total} taken', { taken, total }) : t('No medicines today');
    $('#dose-progress-bar').style.width = total ? `${Math.round((taken / total) * 100)}%` : '0%';

    for (const slot of SLOTS) {
      const doses = today.doses.filter((d) => slotOf(d.time).key === slot.key);
      const allDone = doses.length > 0 && doses.every((d) => d.status === 'taken' || d.status === 'skipped');
      const list = el('ul', { class: 'slot-body' });
      if (!doses.length) list.append(el('li', { class: 'slot-empty', text: t('Nothing in this compartment.') }));
      for (const d of doses) list.append(doseCard(d));
      box.append(el('section', { class: `slot ${slot.key}${allDone ? ' done' : ''}`, 'aria-label': t(slot.label) },
        el('div', { class: 'slot-lid' },
          el('h3', {}, icon(allDone ? 'check' : slot.icon), t(slot.label)),
          el('span', { class: 'slot-range', text: allDone ? t('All done') : t(slot.range) })),
        list));
    }
  }

  function doseCard(d) {
    const open = !['taken', 'skipped'].includes(d.status);
    const canLog = d.canLog !== false;
    const takeLabel = t(d.status === 'upcoming' ? 'Taken early' : d.status === 'missed' ? 'I took it late' : 'I took it');
    return el('li', { class: `dose ${d.status}` },
      el('div', { class: 'dose-top' },
        el('p', { class: 'dose-name', text: d.name }),
        el('span', { class: 'dose-time', text: fmtTime(d.time) })),
      (d.dosage || d.instructions) ? el('p', { class: 'dose-meta', text: [d.dosage, d.instructions].filter(Boolean).join(', ') }) : null,
      el('div', { class: 'dose-actions' },
        el('span', { class: `chip ${d.status}` }, d.status === 'taken' ? icon('check') : null, statusLabel(d.status)),
        d.recordedBy ? el('span', { class: 'muted small', text: t('by {name}', { name: d.recordedBy }) }) : null,
        open && !canLog ? el('span', { class: 'muted small', text: t('You can mark it from 2 hours before') }) : null),
      open && canLog ? el('div', { class: 'dose-actions' },
        el('button', {
          type: 'button',
          class: d.status === 'upcoming' ? 'btn quiet small' : 'btn ok small',
          onclick: (e) => logDose(e.currentTarget, d, 'taken'),
          'aria-label': `${takeLabel}: ${d.name}, ${fmtTime(d.time)}`,
        }, icon('check'), takeLabel),
        d.status !== 'missed' ? el('button', {
          type: 'button', class: 'btn quiet small',
          onclick: (e) => logDose(e.currentTarget, d, 'skipped'),
          'aria-label': `${t('Skip')}: ${d.name}, ${fmtTime(d.time)}`,
        }, t('Skip')) : null) : null);
  }

  async function logDose(button, dose, status) {
    await withBusy(button, async () => {
      await api(`/circle/doses/${encodeURIComponent(dose.id)}`, { method: 'POST', body: { status } });
      toast(status === 'taken' ? t('{name} marked as taken. Well done!', { name: dose.name }) : t('{name} skipped.', { name: dose.name }));
      await loaders.today();
    });
  }

  function renderWeek(rep) {
    const streak = rep.streak || 0;
    $('#streak-count').textContent = String(streak);
    $('#streak-label').textContent = streak === 1 ? t('day with every dose taken') : t('days in a row with every dose taken');
    $('#adherence-overall').textContent = rep.overall.percent === null ? t('No doses recorded yet this week.') : t("{n}% of this week's doses taken.", { n: rep.overall.percent });
    const list = $('#week-dots');
    list.replaceChildren();
    rep.daily.forEach((day, i) => {
      const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(locale(), { weekday: 'short' });
      const cls = day.percent === null ? '' : day.percent === 100 ? 'full' : day.percent >= 60 ? 'part' : 'low';
      const spoken = day.percent === null ? t('no doses') : t('{n}% taken', { n: day.percent });
      list.append(el('li', { class: `${cls}${i === rep.daily.length - 1 ? ' today-dot' : ''}`, 'aria-label': `${label}: ${spoken}` },
        el('span', { class: 'dot' }, day.percent === 100 ? icon('check') : null),
        el('span', { 'aria-hidden': 'true', text: i === rep.daily.length - 1 ? t('Today') : label })));
    });
  }

  function dateLeaf(local) {
    const d = localDate(local);
    return el('div', { class: 'date-leaf', 'aria-hidden': 'true' },
      el('span', { class: 'm', text: d.toLocaleDateString(locale(), { month: 'short' }) }),
      el('span', { class: 'd', text: String(d.getDate()) }));
  }

  function visitBody(a, { compact = false } = {}) {
    return el('div', {},
      el('h3', { text: `${a.doctor}${a.specialty ? `, ${a.specialty}` : ''}` }),
      el('p', { text: localDateTimeLabel(a.datetime) }),
      a.location ? el('p', { text: a.location }) : null,
      !compact && a.notes ? el('p', { text: `${t('Notes')}: ${a.notes}` }) : null,
      el('div', { class: 'actions' },
        el('a', { class: 'btn quiet small', href: a.calendarUrl, target: '_blank', rel: 'noopener noreferrer' }, t('Add to Google Calendar')),
        a.mapsUrl ? el('a', { class: 'btn quiet small', href: a.mapsUrl, target: '_blank', rel: 'noopener noreferrer' }, t('Directions in Google Maps')) : null));
  }

  function renderNextAppt(appt) {
    const box = $('#next-appt');
    box.replaceChildren();
    if (!appt) {
      box.append(el('p', { class: 'muted', text: t('No visits booked.') }), el('a', { class: 'btn quiet small', href: '#appointments' }, t('Add a visit')));
      return;
    }
    const body = visitBody(appt, { compact: true });
    const actions = body.querySelector('.actions');
    actions.remove();
    box.append(el('div', { class: 'visit-card compact' }, dateLeaf(appt.datetime), body, actions));
  }

  function renderApprovalBanner(changes) {
    const banner = $('#approval-banner');
    const badge = $('#badge-approvals');
    badge.hidden = changes.length === 0;
    badge.textContent = String(changes.length);
    badge.setAttribute('aria-label', t('{n} waiting for approval', { n: changes.length }));
    banner.hidden = changes.length === 0;
    banner.replaceChildren();
    if (!changes.length) return;
    const n = changes.length;
    banner.append(
      el('p', { text: isElder() ? t('{n} medicine change(s) need your approval.', { n }) : t("{n} change(s) waiting for {name}'s approval.", { n, name: firstName(state.profile.elderName) }) }),
      el('a', { class: 'btn quiet small', href: '#circle' }, isElder() ? t('Review changes') : t('See requests')));
  }

  // ---- check-in
  const MOOD_WORD = { good: 'good', okay: 'okay', unwell: 'not well' };
  const moodWord = (m) => t(MOOD_WORD[m] || m);
  function renderCheckinLatest(checkins) {
    const latest = checkins[0];
    const out = $('#checkin-latest');
    const isToday = latest && new Date(latest.at).toDateString() === new Date().toDateString();
    if (!isToday) { out.textContent = isElder() ? t('A quick tap helps your family know you are fine.') : t("{name} hasn't checked in yet today.", { name: firstName(state.profile.elderName) }); return; }
    const bits = [t('Feeling {mood}', { mood: moodWord(latest.mood) })];
    if (latest.systolic) bits.push(t('BP {a}/{b}', { a: latest.systolic, b: latest.diastolic }));
    if (latest.sugar) bits.push(t('sugar {n} mg/dL', { n: latest.sugar }));
    const time = new Date(latest.at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
    out.textContent = t('Last check-in at {time} by {name}: {details}.', { time, name: latest.by.name, details: bits.join(', ') });
  }

  function selectMood(mood) {
    state.mood = mood;
    $$('.mood').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mood === mood)));
  }

  async function submitCheckin(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!state.mood) { toast(t('Choose how you are feeling first.'), true); $('.mood').focus(); return; }
    const body = { mood: state.mood, ...formData(form) };
    if (!body.note) delete body.note;
    await withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const res = await api('/circle/checkins', { method: 'POST', body });
        markInvalid(form, []);
        form.reset();
        selectMood(null);
        $('.readings').open = false;
        toast(res.alerted ? t('Saved. Your family has been told so they can check on you.') : t('Check-in saved. Thank you!'));
        renderCheckinLatest(await api('/circle/checkins'));
      } catch (err) { markInvalid(form, err.details); throw err; }
    });
  }

  // ---- help / SOS
  function openSos() {
    $('#sos-text').textContent = t("Everyone in {name}'s circle will get an urgent email right away.", { name: state.profile.elderName });
    $('#form-sos').reset();
    $('#dialog-sos').showModal();
  }
  async function submitSos(e) {
    e.preventDefault();
    const form = e.currentTarget;
    await withBusy(form.querySelector('[type=submit]'), async () => {
      const res = await api('/circle/sos', { method: 'POST', body: formData(form) });
      $('#dialog-sos').close();
      if (res.recipients === 0) toast(t('No one else in the circle has an email yet. Please call 108 or a family member now.'), true);
      else if (res.sent) toast(t('Alert sent to {n} people. Help is on the way.', { n: res.recipients }));
      else toast(t('An alert was sent a moment ago. Your family already knows.'));
    });
  }

  /** Reads the latest schedule aloud (always fetched fresh, so it reflects every change). */
  async function readAloud(button) {
    await withBusy(button, async () => {
      const [today, appts] = await Promise.all([api('/circle/today'), api('/circle/appointments')]);
      state.today = today;
      renderOrganizer(today);
      const doses = today.doses;
      const taken = doses.filter((d) => d.status === 'taken').length;
      const parts = [t('Hello {name}. Here is your day.', { name: firstName(state.profile.elderName) })];
      if (!doses.length) parts.push(t('You have no medicines today.'));
      else parts.push(t('You have taken {taken} of {total} medicines so far.', { taken, total: doses.length }));
      for (const d of doses) {
        parts.push(t('At {time}, {name}{dose}. {status}.', { time: fmtTime(d.time), name: d.name, dose: d.dosage ? `, ${d.dosage}` : '', status: statusLabel(d.status) }) + (d.instructions ? ` ${d.instructions}.` : ''));
      }
      if (appts[0]) parts.push(t('Your next doctor visit is with {doctor} on {when}.', { doctor: appts[0].doctor, when: localDateTimeLabel(appts[0].datetime) }));
      parts.push(t('Take care.'));
      await speak(parts.join(' '), { force: true });
    });
  }

  // ============================================================ MEDICINES
  loaders.medicines = async () => {
    const meds = await api('/circle/medications');
    const list = $('#med-list');
    list.replaceChildren();
    if (!meds.length) { list.append(el('li', { class: 'empty', text: t('No medicines yet. Add the first one to fill the pill box.') })); return; }
    for (const m of meds) {
      const slot = slotOf(m.times[0]);
      const days = m.daysOfWeek?.length ? m.daysOfWeek.map(dayName).join(', ') : t('Every day');
      let stock = null;
      if (typeof m.pillsRemaining === 'number') {
        const low = m.pillsRemaining <= (m.refillThreshold ?? 5);
        const bar = el('span', {});
        bar.style.width = `${Math.min(100, Math.round((m.pillsRemaining / Math.max(30, m.pillsRemaining)) * 100))}%`;
        stock = el('div', { class: `stock${low ? ' low' : ''}` }, el('span', { class: 'stock-bar', 'aria-hidden': 'true' }, bar), low ? t('{n} doses left, time to refill', { n: m.pillsRemaining }) : t('{n} doses left', { n: m.pillsRemaining }));
      }
      list.append(el('li', { class: `med ${slot.key}` },
        el('span', { class: 'med-swatch' }, icon('pill')),
        el('div', {},
          el('h3', { text: `${m.name}${m.dosage ? `, ${m.dosage}` : ''}` }),
          el('div', { class: 'time-chips' }, m.times.map((t) => el('span', { class: 'time-chip', text: fmtTime(t) })), el('span', { class: 'muted small', text: days })),
          m.instructions ? el('p', { text: m.instructions }) : null,
          stock),
        el('div', { class: 'item-actions' },
          el('button', { type: 'button', class: 'btn quiet small', onclick: (e) => explain(e.currentTarget, m) }, t('Explain simply')),
          el('button', { type: 'button', class: 'btn quiet small', onclick: () => openMedForm(m), 'aria-label': `${t('Edit')}: ${m.name}` }, t('Edit')),
          el('button', { type: 'button', class: 'btn danger small', onclick: (e) => deleteMed(e.currentTarget, m), 'aria-label': `${t('Remove')}: ${m.name}` }, t('Remove')))));
    }
  };

  function timeInput(value = '') {
    const idx = $$('#m-times .time-item').length + 1;
    const wrap = el('div', { class: 'time-item' });
    wrap.append(
      el('input', { type: 'time', name: 'time', value, required: true, 'aria-label': t('Time {n}', { n: idx }) }),
      el('button', { type: 'button', class: 'link-btn', 'aria-label': t('Remove time {n}', { n: idx }), onclick: () => { if ($$('#m-times .time-item').length > 1) wrap.remove(); } }, t('Remove')));
    return wrap;
  }

  function openMedForm(med) {
    const form = $('#form-med');
    form.reset();
    form.hidden = false;
    $('#med-form-title').textContent = med ? `${t('Edit')}: ${med.name}` : t('Add medicine');
    form.elements.id.value = med?.id || '';
    const set = (name, v) => { if (v !== undefined && v !== null) form.elements[name].value = v; };
    set('name', med?.name); set('dosage', med?.dosage); set('instructions', med?.instructions);
    set('pillsRemaining', med?.pillsRemaining); set('refillThreshold', med?.refillThreshold ?? 5); set('endDate', med?.endDate);
    $('#m-times').replaceChildren(...(med?.times?.length ? med.times : ['08:00']).map((t) => timeInput(t)));
    $$('#m-days input').forEach((cb) => { cb.checked = Boolean(med?.daysOfWeek?.includes(Number(cb.value))); });
    form.scrollIntoView({ block: 'start' });
    form.elements.name.focus({ preventScroll: true });
  }

  async function submitMed(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = formData(form);
    const body = {
      name: raw.name,
      dosage: raw.dosage || undefined,
      instructions: raw.instructions || undefined,
      times: $$('#m-times input').map((i) => i.value).filter(Boolean),
      daysOfWeek: $$('#m-days input:checked').map((cb) => Number(cb.value)),
      pillsRemaining: raw.pillsRemaining,
      refillThreshold: raw.refillThreshold,
      endDate: raw.endDate || undefined,
    };
    const id = form.elements.id.value;
    await withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const res = await api(id ? `/circle/medications/${id}` : '/circle/medications', { method: id ? 'PATCH' : 'POST', body });
        markInvalid(form, []);
        toast(res.pending ? t('Sent to {name} for approval.', { name: firstName(state.profile.elderName) }) : t('{name} saved.', { name: body.name }));
        form.hidden = true;
        await loaders.medicines();
      } catch (err) { markInvalid(form, err.details); throw err; }
    });
  }

  async function deleteMed(button, med) {
    if (!(await askConfirm(t('Remove {name} from the medicine list?', { name: med.name }), t('Remove')))) return;
    await withBusy(button, async () => {
      const res = await api(`/circle/medications/${med.id}`, { method: 'DELETE' });
      toast(res.pending ? t('Sent to {name} for approval.', { name: firstName(state.profile.elderName) }) : t('{name} removed.', { name: med.name }));
      await loaders.medicines();
    });
  }

  async function explain(button, med) {
    await withBusy(button, async () => {
      const res = await api(`/circle/medications/${med.id}/explain?lang=${state.lang}`);
      $('#explain-title').textContent = t('About {name}', { name: med.name });
      $('#explain-body').textContent = res.text;
      $('#explain-disclaimer').textContent = `${res.source === 'gemini' ? `${t('Explained by Google Gemini.')} ` : ''}${t(res.disclaimer)}`;
      $('#dialog-explain').showModal();
      speak(res.text.replace(/^- /gm, ''));
    });
  }

  // ============================================================ VISITS
  loaders.appointments = async () => {
    const appts = await api('/circle/appointments');
    const list = $('#appt-list');
    list.replaceChildren();
    if (!appts.length) { list.append(el('li', { class: 'empty', text: t('No visits booked. Add one and everyone gets a reminder a day before.') })); return; }
    for (const a of appts) {
      const body = visitBody(a);
      body.querySelector('.actions').append(
        el('button', { type: 'button', class: 'btn quiet small', onclick: () => openApptForm(a), 'aria-label': `${t('Edit')}: ${a.doctor}` }, t('Edit')),
        el('button', { type: 'button', class: 'btn danger small', onclick: (e) => deleteAppt(e.currentTarget, a), 'aria-label': `${t('Cancel visit')}: ${a.doctor}` }, t('Cancel visit')));
      list.append(el('li', {}, el('div', { class: 'visit-card' }, dateLeaf(a.datetime), body)));
    }
  };

  function openApptForm(appt) {
    const form = $('#form-appt');
    form.reset();
    form.hidden = false;
    $('#appt-form-title').textContent = appt ? t('Edit visit') : t('Add visit');
    form.elements.id.value = appt?.id || '';
    for (const k of ['doctor', 'specialty', 'datetime', 'location', 'notes']) if (appt?.[k]) form.elements[k].value = appt[k];
    form.scrollIntoView({ block: 'start' });
    form.elements.doctor.focus({ preventScroll: true });
  }

  async function submitAppt(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = formData(form);
    const id = raw.id;
    delete raw.id;
    for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];
    if (raw.datetime) raw.datetime = raw.datetime.slice(0, 16);
    await withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        await api(id ? `/circle/appointments/${id}` : '/circle/appointments', { method: id ? 'PATCH' : 'POST', body: raw });
        markInvalid(form, []);
        toast(t('Visit with {doctor} saved. Everyone gets a reminder a day before.', { doctor: raw.doctor || '' }));
        form.hidden = true;
        await loaders.appointments();
      } catch (err) { markInvalid(form, err.details); throw err; }
    });
  }

  async function deleteAppt(button, appt) {
    if (!(await askConfirm(t('Cancel the visit with {doctor}?', { doctor: appt.doctor }), t('Cancel visit')))) return;
    await withBusy(button, async () => {
      await api(`/circle/appointments/${appt.id}`, { method: 'DELETE' });
      toast(t('Visit with {doctor} cancelled.', { doctor: appt.doctor }));
      await loaders.appointments();
    });
  }

  // ============================================================ CIRCLE
  loaders.circle = async () => {
    await refreshMe();
    const [members, changes, card] = await Promise.all([api('/circle/members'), api('/circle/changes'), api('/circle/health-card')]);
    renderApprovals(changes);
    renderApprovalBanner(changes);
    renderHealthCard(card);

    const list = $('#member-list');
    list.replaceChildren();
    for (const m of members) {
      const self = m.id === state.me.id;
      const canRemove = isElder() ? !self : self;
      list.append(el('li', { class: `person ${m.role}` },
        el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(m.name) }),
        el('div', { class: 'person-main' },
          el('h3', {}, `${m.name}${self ? ` (${t('you')})` : ''}`, el('span', { class: 'role-tag', text: roleLabel(m.role) })),
          m.email ? el('p', { text: m.email }) : null),
        canRemove ? el('button', { type: 'button', class: 'btn danger small', onclick: (e) => removeMember(e.currentTarget, m), 'aria-label': self ? t('Leave this circle') : `${t('Remove')}: ${m.name}` }, self ? t('Leave') : t('Remove')) : null));
    }

    const pf = $('#form-profile');
    pf.elements.conditions.value = state.profile.conditions || '';
    pf.elements.allergies.value = state.profile.allergies || '';
    pf.elements.emergencyContact.value = state.profile.emergencyContact || '';
    pf.elements.requireElderApproval.checked = Boolean(state.profile.requireElderApproval);
    const nf = $('#form-notify');
    for (const k of ['upcoming', 'missed', 'escalation', 'appointments', 'refill']) nf.elements[k].checked = Boolean(state.me.notify?.[k]);
  };

  function renderApprovals(changes) {
    const list = $('#approval-list');
    list.replaceChildren();
    if (!changes.length) { list.append(el('li', { class: 'muted', text: t('Nothing is waiting.') })); return; }
    for (const c of changes) {
      const p = c.payload || {};
      const detail = c.action === 'delete' ? t('Remove this medicine') : [p.dosage, p.times?.map(fmtTime).join(', '), p.instructions].filter(Boolean).join(', ');
      const ACTION = { create: '{who} wants to add {med}', update: '{who} wants to change {med}', delete: '{who} wants to remove {med}' };
      list.append(el('li', {},
        el('div', {},
          el('h3', { text: t(ACTION[c.action], { who: c.requestedBy.name, med: c.medName || t('a medicine') }) }),
          el('p', { text: detail || t('Update details') })),
        isElder() ? el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn ok small', onclick: (e) => decide(e.currentTarget, c, true) }, icon('check'), t('Approve')),
          el('button', { type: 'button', class: 'btn danger small', onclick: (e) => decide(e.currentTarget, c, false) }, t('Reject')))
          : el('span', { class: 'muted', text: t('Waiting for {name}', { name: firstName(state.profile.elderName) }) })));
    }
  }

  function vitalsText(v) {
    return [v.systolic ? t('BP {a}/{b}', { a: v.systolic, b: v.diastolic }) : '', v.sugar ? t('sugar {n} mg/dL', { n: v.sugar }) : ''].filter(Boolean).join(', ');
  }

  function healthCardText(c) {
    const lines = [`${t('Health card')}: ${c.elderName}`, ''];
    lines.push(`${t('Conditions')}: ${c.conditions || t('Not recorded')}`);
    lines.push(`${t('Allergies')}: ${c.allergies || t('None recorded')}`);
    lines.push(`${t('Emergency contact')}: ${c.emergencyContact || t('Not recorded')}`, '', `${t('Medicines')}:`);
    for (const m of c.medications) lines.push(`- ${m.name}${m.dosage ? ` ${m.dosage}` : ''}, ${m.times.map(fmtTime).join(', ')}${m.instructions ? ` (${m.instructions})` : ''}`);
    if (!c.medications.length) lines.push(`- ${t('None')}`);
    lines.push('', `${t('Last 30 days')}: ${c.adherence30 === null ? t('No doses recorded yet') : t('{n}% of doses taken', { n: c.adherence30 })}`);
    if (c.latestVitals) lines.push(`${t('Latest reading')}: ${vitalsText(c.latestVitals)} (${fmtDateTime(c.latestVitals.at)})`);
    if (c.nextAppointment) lines.push(`${t('Next doctor visit')}: ${c.nextAppointment.doctor}, ${localDateTimeLabel(c.nextAppointment.datetime)}`);
    lines.push('', 'CareCircle');
    return lines.join('\n');
  }

  function renderHealthCard(c) {
    state.healthCard = c;
    const row = (label, value) => el('div', { class: 'hc-row' }, el('dt', { text: t(label) }), el('dd', {}, value));
    $('#health-card').replaceChildren(el('dl', { class: 'hc' },
      row('Name', c.elderName),
      row('Conditions', c.conditions || t('Not recorded')),
      row('Allergies', c.allergies || t('None recorded')),
      row('Emergency contact', c.emergencyContact || t('Not recorded')),
      row('Medicines', c.medications.length
        ? el('ul', {}, c.medications.map((m) => el('li', { text: `${m.name}${m.dosage ? ` ${m.dosage}` : ''}, ${m.times.map(fmtTime).join(', ')}` })))
        : t('None')),
      row('Last 30 days', c.adherence30 === null ? t('No doses recorded yet') : t('{n}% of doses taken', { n: c.adherence30 })),
      row('Latest reading', c.latestVitals ? vitalsText(c.latestVitals) : t('No readings yet'))));
  }

  async function decide(button, change, approve) {
    await withBusy(button, async () => {
      await api(`/circle/changes/${change.id}/decision`, { method: 'POST', body: { approve } });
      toast(approve ? t('Approved. The pill box is updated.') : t('Rejected. Nothing was changed.'));
      await loaders.circle();
    });
  }

  async function removeMember(button, m) {
    const self = m.id === state.me.id;
    if (!(await askConfirm(self ? t('Leave this care circle? You will stop getting emails.') : t('Remove {name} from the circle?', { name: m.name }), self ? t('Leave') : t('Remove')))) return;
    await withBusy(button, async () => {
      await api(`/circle/members/${m.id}`, { method: 'DELETE' });
      if (self) { signOut(); return; }
      toast(t('{name} removed.', { name: m.name }));
      await loaders.circle();
    });
  }

  // ============================================================ ACTIVITY
  loaders.activity = async () => {
    const [items, outbox] = await Promise.all([api('/circle/activity'), api('/circle/notifications')]);
    const alertActions = new Set(['dose.missed', 'sos']);
    $('#activity-list').replaceChildren(...(items.length ? items.map((a) => el('li', { class: alertActions.has(a.action) ? 'alert' : '' },
      el('p', {}, el('strong', { text: a.actor.name }), ` ${a.summary.charAt(0).toLowerCase()}${a.summary.slice(1)}`),
      el('time', { datetime: a.at, text: fmtDateTime(a.at) }))) : [el('li', { class: 'muted', text: t('Nothing has happened yet.') })]));

    const mode = state.config?.emailMode;
    $('#email-mode').textContent = t(mode === 'smtp' ? 'These emails were delivered to each person’s inbox.'
      : mode === 'demo' ? 'In this preview, emails are listed here instead of being sent.'
        : 'Email sending is not set up on this server yet, so emails are listed here.');
    const urgent = new Set(['sos', 'health-alert', 'escalation']);
    $('#outbox-list').replaceChildren(...(outbox.length ? outbox.map((n) => el('li', { class: urgent.has(n.type) ? 'alert' : '' },
      el('p', {}, el('strong', { text: n.subject })),
      el('p', { class: 'muted small', text: t('To {n} people', { n: n.to.length }) }),
      el('time', { datetime: n.createdAt, text: fmtDateTime(n.createdAt) }))) : [el('li', { class: 'muted', text: t('No emails yet.') })]));
  };

  // ============================================================ wiring
  function selectEntryTab(which) {
    const join = which === 'join';
    $('#tab-join').setAttribute('aria-selected', String(join));
    $('#tab-create').setAttribute('aria-selected', String(!join));
    $('#tab-join').tabIndex = join ? 0 : -1;
    $('#tab-create').tabIndex = join ? -1 : 0;
    $('#form-join').hidden = !join;
    $('#form-create').hidden = join;
  }

  function wire() {
    $('#btn-text-larger').addEventListener('click', () => changeScale(0.1));
    $('#btn-text-smaller').addEventListener('click', () => changeScale(-0.1));
    $('#btn-contrast').addEventListener('click', () => { storage.pref('cc_contrast', storage.pref('cc_contrast') === '1' ? '0' : '1'); applyPrefs(); });
    $('#btn-signout').addEventListener('click', signOut);
    $('#btn-copy-code').addEventListener('click', () => copyText(state.profile.id, t('Circle code copied.')));
    $('#btn-read-aloud').addEventListener('click', (e) => readAloud(e.currentTarget));
    $('#btn-voice').addEventListener('click', () => {
      voice.enabled = !voice.enabled;
      storage.pref('cc_voice', voice.enabled ? 'on' : 'off');
      renderVoiceButton();
      if (voice.enabled) speak(t('Spoken updates are on'));
      else { stopSpeaking(); showToast(t('Spoken updates are off')); }
    });
    $('#lang-select').addEventListener('change', (e) => {
      state.lang = LANGS.includes(e.target.value) ? e.target.value : 'en';
      storage.pref('cc_lang', state.lang);
      stopSpeaking();
      applyLanguage();
      renderSession();
      $('#summary-out').replaceChildren();
      show(state.view, { focus: false });
      speak(t('Language changed to English'));
    });

    // Entry tabs (with arrow-key support)
    $('#tab-join').addEventListener('click', () => selectEntryTab('join'));
    $('#tab-create').addEventListener('click', () => selectEntryTab('create'));
    $('.segmented').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const next = $('#tab-join').getAttribute('aria-selected') === 'true' ? 'create' : 'join';
      selectEntryTab(next);
      $(`#tab-${next}`).focus();
    });

    $('#form-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const d = formData(form);
      const body = {
        elderName: d.elderName, elderEmail: d.elderEmail || '', passcode: d.passcode,
        requireElderApproval: d.requireElderApproval,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        member: { name: d.name, email: d.email || '', role: d.role },
      };
      await withBusy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await api('/circles', { method: 'POST', body });
          setSession(res);
          toast(t('Circle created. Share the code and passcode with family.'));
          location.hash = '#today';
          show('today');
        } catch (err) { markInvalid(form, err.details); throw err; }
      });
    });

    $('#form-join').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const d = formData(form);
      const body = { circleCode: d.circleCode.toUpperCase(), passcode: d.passcode, member: { name: d.name, email: d.email || '', role: d.role } };
      await withBusy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await api('/circles/join', { method: 'POST', body });
          setSession(res);
          toast(t("Welcome to {name}'s circle.", { name: res.profile.elderName }));
          location.hash = '#today';
          show('today');
        } catch (err) { markInvalid(form, err.details); throw err; }
      });
    });

    // Today
    $$('.mood').forEach((b) => b.addEventListener('click', () => selectMood(b.dataset.mood)));
    $('.moods').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const moods = $$('.mood');
      const i = Math.max(0, moods.findIndex((b) => b.dataset.mood === state.mood));
      const next = moods[(i + (e.key === 'ArrowRight' ? 1 : moods.length - 1)) % moods.length];
      selectMood(next.dataset.mood);
      next.focus();
    });
    $('#form-checkin').addEventListener('submit', submitCheckin);
    $('#btn-sos').addEventListener('click', openSos);
    $('#form-sos').addEventListener('submit', submitSos);
    $('#sos-cancel').addEventListener('click', () => $('#dialog-sos').close());
    $('#btn-summary').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const res = await api(`/circle/summary?lang=${state.lang}`);
      $('#summary-out').replaceChildren(el('span', { text: res.text }), el('span', { class: 'ai-note', text: `${res.source === 'gemini' ? `${t('Written by Google Gemini.')} ` : ''}${t(res.disclaimer)}` }));
      speak(res.text);
    }));

    // Medicines
    const daysBox = $('#m-days');
    const renderDays = () => {
      const checked = new Set($$('#m-days input:checked').map((cb) => cb.value));
      daysBox.replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((n) => el('label', { class: 'choice' },
        el('input', { type: 'checkbox', value: String(n), checked: checked.has(String(n)) }), el('span', { text: dayName(n) }))));
    };
    renderDays();
    $('#lang-select').addEventListener('change', renderDays);
    $('#btn-add-med').addEventListener('click', () => openMedForm(null));
    $('#btn-cancel-med').addEventListener('click', () => { $('#form-med').hidden = true; });
    $('#btn-add-time').addEventListener('click', () => { if ($$('#m-times .time-item').length < 8) $('#m-times').append(timeInput()); });
    $('#form-med').addEventListener('submit', submitMed);

    // Visits
    $('#btn-add-appt').addEventListener('click', () => openApptForm(null));
    $('#btn-cancel-appt').addEventListener('click', () => { $('#form-appt').hidden = true; });
    $('#form-appt').addEventListener('submit', submitAppt);

    // Circle
    $('#btn-copy-card').addEventListener('click', () => state.healthCard && copyText(healthCardText(state.healthCard), t('Health card copied.')));
    $('#btn-print-card').addEventListener('click', () => { try { window.print(); } catch { toast(t('Printing is not available here. Use Copy instead.'), true); } });

    $('#form-profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.currentTarget);
      if (!isElder()) delete d.requireElderApproval;
      await withBusy(e.currentTarget.querySelector('[type=submit]'), async () => {
        state.profile = await api('/circle', { method: 'PATCH', body: d });
        toast(t('Health details saved.'));
        renderHealthCard(await api('/circle/health-card'));
      });
    });
    $('#form-notify').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.currentTarget);
      await withBusy(e.currentTarget.querySelector('[type=submit]'), async () => {
        state.me = await api('/me/notify', { method: 'PATCH', body: d });
        toast(t('Email settings saved.'));
      });
    });
    $('#form-passcode').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      await withBusy(form.querySelector('[type=submit]'), async () => {
        await api('/circle/passcode', { method: 'POST', body: formData(form) });
        form.reset();
        toast(t('Passcode changed. Share the new one only with people you trust.'));
      });
    });
  }

  async function init() {
    collectStatic();
    applyPrefs();
    wire();
    applyLanguage();
    try { state.config = await api('/config'); } catch { state.config = {}; }
    if (state.token) {
      try { await refreshMe(); } catch { /* signOut runs on 401 */ }
    }
    show(location.hash.slice(1) || 'today', { focus: false });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
