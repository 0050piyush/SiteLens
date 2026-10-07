// DOM helpers shared by the app's modules. All text goes through textContent.

import { toPath } from './shared/routes.js';

// The site's root path ("/" on a custom domain, "/SiteLens/" on GitHub Pages),
// worked out from where this file is served. The prerenderer sets it explicitly.
let ROOT = '/';
try { ROOT = new URL('./', import.meta.url).pathname; } catch { /* keep "/" */ }
export const setRoot = (r) => { ROOT = r; };
export const siteRoot = () => ROOT;
/** App link ("#/pricing", "/site/x") → real URL path ("/SiteLens/pricing/"). */
export const appHref = (href) => ROOT + toPath(href);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'href' || k === 'src') { const u = safeUrl(k === 'href' && String(v).startsWith('#/') ? appHref(v) : v); if (u) el.setAttribute(k, u); }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function safeUrl(u) {
  const s = String(u);
  if (s.startsWith('#') || s.startsWith('/')) return s;
  try {
    const p = new URL(s);
    return ['http:', 'https:', 'mailto:'].includes(p.protocol) ? p.href : null;
  } catch { return null; }
}
export const ext = (href, ...children) => h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, ...children);
