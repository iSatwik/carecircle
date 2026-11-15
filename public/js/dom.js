/**
 * DOM helpers. Text is always set through textContent, never innerHTML, so
 * user-entered data can't inject markup.
 */
import { $ } from './core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TOAST_MS = 4800;

/**
 * Creates an element.
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs] `class`, `text`, `on<event>` handlers or plain attributes
 * @param {...(Node | string | null | false | Array<Node | string>)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

/**
 * A decorative icon from the inline SVG sprite in index.html.
 * @param {string} name sprite id without the `i-` prefix
 * @param {string} [cls]
 */
export function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

let toastTimer;

/** Shows a short message in the live region (announced by screen readers). */
export function showToast(message, isError = false) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), TOAST_MS);
}
