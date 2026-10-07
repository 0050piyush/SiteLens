// Clean URL scheme, shared by the browser app, the prerenderer and the server.
// Every page lives at <site root><view>/<arg>/ with a trailing slash, for
// example /pricing/ or /site/github.com/. Old links used "#/view/arg".

const ALIASES = { top: 'rankings', api: 'api-docs' };
const WITH_ARG = new Set(['site', 'compare', 'rankings']);
export const VIEWS = new Set(['', 'site', 'compare', 'rankings', 'api-docs', 'pricing', 'login', 'account', 'forgot', 'reset', 'verify',
  'about', 'faq', 'contact', 'privacy', 'terms', 'sitemap', 'methodology']);

/** "#/site/github.com?x=1" or "/site/github.com" → "site/github.com/?x=1" (relative to the site root). */
export function toPath(href) {
  const s = String(href).replace(/^#?\/*/, '');
  const qi = s.indexOf('?');
  const query = qi >= 0 ? s.slice(qi) : '';
  const path = (qi >= 0 ? s.slice(0, qi) : s).replace(/\/+$/, '');
  if (!path) return query;
  const [view, ...rest] = path.split('/');
  return `${[ALIASES[view] || view, ...rest].join('/')}/${query}`;
}

/** "site/github.com/" → { view: "site", arg: "github.com" }, or null when it isn't an app page. */
export function parsePath(rel) {
  const clean = String(rel).replace(/^\/+|\/+$/g, '');
  if (!clean) return { view: '', arg: '' };
  const i = clean.indexOf('/');
  const raw = i < 0 ? clean : clean.slice(0, i);
  const view = ALIASES[raw] || raw;
  const arg = i < 0 ? '' : clean.slice(i + 1);
  if (!VIEWS.has(view) || (arg && !WITH_ARG.has(view))) return null;
  return { view, arg };
}
