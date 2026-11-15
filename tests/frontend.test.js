'use strict';

/**
 * Static checks for the front end: translations, accessibility markup and
 * colour contrast. These run without a browser so they stay fast in CI.
 */

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const html = read('index.html');
const appJs = read('app.js');
const css = read('styles.css');

function loadDictionaries() {
  const sandbox = { window: {} };
  vm.runInNewContext(read('i18n.js'), sandbox);
  return sandbox.window.CC_I18N;
}
const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');

test('Hindi and Telugu translate exactly the same set of strings', () => {
  const { hi, te } = loadDictionaries();
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(te).sort());
  assert.ok(Object.keys(hi).length > 200);
});

test('every translation keeps the same {placeholders} as its English source', () => {
  const dicts = loadDictionaries();
  for (const [lang, table] of Object.entries(dicts)) {
    for (const [source, translated] of Object.entries(table)) {
      assert.equal(placeholders(translated), placeholders(source), `${lang}: "${source}"`);
      assert.ok(translated.trim().length > 0, `${lang}: empty translation for "${source}"`);
    }
  }
});

test('every t("...") string used in app.js has a Hindi and Telugu translation', () => {
  const { hi, te } = loadDictionaries();
  const used = [...appJs.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g), ...appJs.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1].replace(/\\'/g, "'"));
  assert.ok(used.length > 80);
  const missing = used.filter((k) => !(k in hi) || !(k in te));
  assert.deepEqual([...new Set(missing)], []);
});

test('page declares a language, viewport and a skip link to main content', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/, 'zoom must not be disabled');
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(html, /<main id="main"/);
});

test('every visible form control has an accessible name', () => {
  const labelFor = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  const wrapped = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1]).join('\n');
  const controls = [...html.matchAll(/<(input|textarea|select)\b([^>]*)>/g)];
  assert.ok(controls.length > 30);
  for (const [tag, , attrs] of controls) {
    if (/type="hidden"/.test(attrs)) continue;
    const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
    const named = /aria-label="/.test(attrs) || (id && labelFor.has(id)) || wrapped.includes(tag);
    assert.ok(named, `unlabelled control: ${tag}`);
  }
});

test('every button has visible text or an aria-label', () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.ok(buttons.length > 20);
  for (const [whole, attrs, inner] of buttons) {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    assert.ok(text || /aria-label="/.test(attrs), `button without a name: ${whole.slice(0, 80)}`);
  }
});

test('dialogs are labelled and each view has a heading', () => {
  for (const [, attrs] of html.matchAll(/<dialog\b([^>]*)>/g)) assert.match(attrs, /aria-labelledby="/);
  const views = [...html.matchAll(/<section id="view-[a-z]+"[^>]*aria-labelledby="([^"]+)"/g)];
  assert.equal(views.length, 6);
  for (const [, id] of views) assert.match(html, new RegExp(`id="${id}"`));
});

test('styles respect reduced motion and show a visible focus ring', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*4px/);
  assert.match(css, /html\.contrast\s*\{/);
});

// WCAG 2.1 relative luminance / contrast ratio
function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('core colour pairs meet WCAG AA contrast (4.5:1)', () => {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)[1];
  const v = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const pairs = [
    ['ink', 'paper'], ['ink', 'surface'], ['ink-soft', 'surface'], ['ink-soft', 'paper'],
    ['teal', 'surface'], ['alert', 'surface'], ['ok', 'surface'], ['warn', 'warn-wash'],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(v[fg], v[bg]);
    assert.ok(ratio >= 4.5, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
  }
  assert.ok(contrast('#ffffff', v.teal) >= 4.5, 'white text on teal buttons');
  assert.ok(contrast('#ffffff', v.alert) >= 4.5, 'white text on the help button');
});

test('front end never injects data with innerHTML or eval', () => {
  assert.doesNotMatch(appJs, /\.innerHTML\s*=/);
  assert.doesNotMatch(appJs, /\beval\(|new Function\(/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/, 'no inline scripts (CSP)');
  assert.doesNotMatch(html, /\sstyle="/, 'no inline styles (CSP)');
});
