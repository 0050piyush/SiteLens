import { lineChart, ring, barList, seriesColor, statusOf, hideTooltip } from './charts.js';
import { API_BASE } from './config.js';
import { analyzeLite } from './lite.js';

const main = document.getElementById('main');

// ---- DOM helpers (all text goes through textContent) ------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'href' || k === 'src') { const u = safeUrl(v); if (u) el.setAttribute(k, u); }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function safeUrl(u) {
  const s = String(u);
  if (s.startsWith('#') || s.startsWith('/')) return s;
  try {
    const p = new URL(s);
    return ['http:', 'https:', 'mailto:'].includes(p.protocol) ? p.href : null;
  } catch { return null; }
}
const ext = (href, ...children) => h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, ...children);

// ---- formatting --------------------------------------------------------------

const nf = new Intl.NumberFormat('en');
const cf = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => (n == null ? '—' : nf.format(n));
const compact = (n) => (n == null ? '—' : cf.format(n));
const rankStr = (r) => (r ? `#${nf.format(r)}` : 'Unranked');
const date = (d) => (d ? new Date(d).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function cleanDomain(input) {
  return String(input || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
}

// ---- API ---------------------------------------------------------------------

const apiUrl = (path) => `${API_BASE}${path}`;

// Full mode needs a SiteLens API server; without one (e.g. GitHub Pages) the
// app falls back to browser-only checks.
let backendPromise;
function hasBackend() {
  backendPromise ||= fetch(apiUrl('/api/v1/status'), { headers: { accept: 'application/json' } })
    .then((r) => r.ok && /json/.test(r.headers.get('content-type') || ''))
    .catch(() => false);
  return backendPromise;
}

function liteNotice() {
  return h('div', { class: 'callout', style: { marginTop: '16px' } },
    h('b', null, 'Lite mode. '),
    'This copy runs entirely in your browser, so it shows DNS, hosting, email, rank, registration and archive data. ',
    'Tech stack, SEO, performance and security-header audits need the SiteLens API server. ',
    h('a', { href: 'https://github.com/0050piyush/SiteLens#run-it', target: '_blank', rel: 'noopener' }, 'How to run it →'));
}

async function api(path) {
  const res = await fetch(apiUrl(path), { headers: { accept: 'application/json' } });
  let body;
  try { body = await res.json(); } catch { body = { error: `HTTP ${res.status}` }; }
  // An unreachable site still yields a report (with reachable: false).
  if (!res.ok && !(body && 'reachable' in body)) {
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  }
  return body;
}

// ---- recent searches & saved reports (this browser only) ----------------------

const HISTORY_KEY = 'sitelens-searches';
const HISTORY_MAX = 5;
const CACHE_KEY = 'sitelens-reports-v1';
const CACHE_TTL = 24 * 3600 * 1000;
const CACHE_MAX = 15;

const recentSearches = () => store.get(HISTORY_KEY, []);
function addSearch(domain) {
  store.set(HISTORY_KEY, [domain, ...recentSearches().filter((d) => d !== domain)].slice(0, HISTORY_MAX));
  refreshSuggestions();
}
function clearSearches() {
  store.set(HISTORY_KEY, []);
  refreshSuggestions();
}
// Feeds the <datalist> that the search and compare inputs use for suggestions.
function refreshSuggestions() {
  const list = document.getElementById('recent-domains');
  if (list) list.replaceChildren(...recentSearches().map((d) => h('option', { value: d })));
}

// Reports are kept in memory and in localStorage so revisiting a site or
// adding it to a comparison is instant. "Re-run" bypasses the cache.
let memCache = null;
function cacheAll() {
  if (!memCache) {
    const raw = store.get(CACHE_KEY, {});
    memCache = new Map(Object.entries(raw && typeof raw === 'object' ? raw : {}));
  }
  return memCache;
}
function persistCache() {
  const entries = [...cacheAll()].sort((a, b) => b[1].at - a[1].at);
  // Drop the oldest entries until it fits in localStorage.
  for (let keep = Math.min(entries.length, CACHE_MAX); keep >= 0; keep = keep > 4 ? Math.floor(keep / 2) : keep - 1) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, keep))));
      return;
    } catch { /* quota exceeded or storage unavailable: try with fewer */ }
  }
}
function readCached(key) {
  const hit = cacheAll().get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cacheAll().delete(key);
    persistCache();
    return null;
  }
  return hit;
}
function writeCached(key, report) {
  const all = cacheAll();
  all.delete(key);
  all.set(key, { at: Date.now(), report });
  const sorted = [...all].sort((a, b) => b[1].at - a[1].at);
  for (const [k] of sorted.slice(CACHE_MAX)) all.delete(k);
  persistCache();
}
function clearCachedReports() {
  cacheAll().clear();
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
const cachedCount = () => cacheAll().size;

/** One report per domain: from the cache when possible, otherwise analyzed (full or lite). */
async function getReport(domain, { fresh = false } = {}) {
  const full = await hasBackend();
  const key = `${full ? 'full' : 'lite'}:${domain}`;
  if (!fresh) {
    const hit = readCached(key);
    if (hit) return { report: hit.report, cachedAt: hit.at };
  }
  const report = full
    ? await api(`/api/v1/analyze/${encodeURIComponent(domain)}${fresh ? '?fresh=1' : ''}`)
    : await analyzeLite(domain);
  if (report.reachable) writeCached(key, report);
  return { report, cachedAt: null };
}

function recentSearchesRow({ onPick } = {}) {
  const items = recentSearches();
  if (!items.length) return null;
  const row = h('div', { class: 'chips recent-row' },
    h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Recent:'),
    items.map((d) => (onPick
      ? h('button', { class: 'chip', type: 'button', onclick: () => onPick(d) }, cachedFor(d) ? '⚡ ' : '', d)
      : h('a', { class: 'chip', href: `#/site/${d}`, title: cachedFor(d) ? 'Saved: opens instantly' : null }, cachedFor(d) ? '⚡ ' : '', d))),
    h('button', {
      class: 'chip clear-chip', type: 'button', 'aria-label': 'Clear recent searches',
      onclick: () => { clearSearches(); row.remove(); },
    }, '✕ Clear'));
  return row;
}
const cachedFor = (d) => [...cacheAll().keys()].some((k) => k.endsWith(`:${d}`) && readCached(k));

// ---- local watchlist ---------------------------------------------------------

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};
const watchlist = () => store.get('sitelens-watch', []);
const isWatched = (d) => watchlist().some((w) => w.domain === d);
function snapshot(r) {
  return { domain: r.domain, title: r.site?.title || null, icon: r.site?.icon || null, rank: r.rank?.rank ?? null, scores: r.scores, visits: r.traffic?.monthlyVisits ?? null, at: r.meta.analyzedAt };
}
function toggleWatch(r) {
  const list = watchlist();
  const i = list.findIndex((w) => w.domain === r.domain);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(snapshot(r));
  store.set('sitelens-watch', list.slice(0, 50));
  return i < 0;
}

// ---- shared bits ---------------------------------------------------------------

function favicon(icon, domain, size = '') {
  const box = h('span', { class: `fav ${size}`, 'aria-hidden': 'true' });
  const letter = () => { box.replaceChildren(document.createTextNode((domain || '?')[0].toUpperCase())); };
  if (icon && safeUrl(icon)) {
    const img = h('img', { src: icon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', letter);
    box.append(img);
  } else letter();
  return box;
}

function siteTile(s) {
  return h('a', { class: 'site-tile', href: `#/site/${s.domain}` },
    favicon(s.icon, s.domain),
    h('div', { class: 't' },
      h('b', null, s.domain),
      h('span', null, [s.rank ? rankStr(s.rank) : null, s.category, s.scores ? `Score ${s.scores.overall}` : null].filter(Boolean).join(' · '))));
}

function searchForm({ big = false } = {}) {
  const input = h('input', { name: 'q', type: 'text', placeholder: 'Enter any website, e.g. stripe.com', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Website to analyze', autofocus: big || null, list: 'recent-domains' });
  const form = h('form', { class: 'bigsearch', role: 'search' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Analyze'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = cleanDomain(input.value);
    if (d) location.hash = `#/site/${d}`;
  });
  return form;
}

function errorView(title, message, retry) {
  return h('div', { class: 'loading' },
    h('h2', null, title),
    h('p', { class: 'muted' }, message),
    retry ? h('button', { class: 'btn primary', onclick: retry }, 'Try again') : null,
    h('p', null, h('a', { href: '#/' }, '← Back home')));
}

// ---- views -------------------------------------------------------------------

const FEATURES = [
  ['M3 17l5-5 4 4 8-8', 'Traffic & rank', 'Global rank from the Tranco research list, 30-day rank history and a transparent traffic model with ranges, not fake precision.'],
  ['M4 6h16M4 12h16M4 18h10', 'Technology stack', '180+ fingerprints: CMS, frameworks, analytics, ad pixels, CDNs, payments, consent tools, hosting and more.'],
  ['M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z', 'Security grade', 'TLS certificate, HSTS, CSP and other headers, SPF/DMARC email security, CAA and security.txt.'],
  ['M5 12h4l2-6 2 12 2-6h4', 'Performance', 'Real server timings (DNS, connect, TLS, TTFB), compression, HTTP/2, page weight and render-blocking scripts.'],
  ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', 'SEO audit', '20 on-page checks plus robots.txt, sitemaps, structured data, hreflang and which AI crawlers are blocked.'],
  ['M4 7h16v10H4zM8 11h8', 'Business signals', 'Email provider, SaaS tools verified on the domain (via DNS), email senders, ad sellers, socials and domain age.'],
];

function homeView() {
  const recentBox = h('div', { class: 'site-tiles' }, h('div', { class: 'muted small' }, 'Loading…'));
  const recentSection = h('section', { class: 'section' },
    h('div', { class: 'card-head' }, h('h2', null, 'Recently analyzed on this server'), h('a', { href: '#/top' }, 'See rankings →')),
    recentBox);
  const watch = watchlist();
  const view = h('div', null,
    h('section', { class: 'hero' },
      h('h1', null, 'See inside ', h('span', { class: 'hl' }, 'any website'), '.'),
      h('p', { class: 'lead' }, 'Traffic estimates, global rank, tech stack, SEO, performance and security for any domain. Free, no sign-up, with an open API.'),
      searchForm({ big: true }),
      h('div', { class: 'chips examples' },
        h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Try:'),
        ['github.com', 'wikipedia.org', 'stripe.com', 'nytimes.com', 'shopify.com', 'vercel.com'].map((d) =>
          h('a', { class: 'chip', href: `#/site/${d}` }, d))),
      recentSearchesRow()),
    watch.length ? h('section', { class: 'section' },
      h('h2', null, 'Your watchlist'),
      h('div', { class: 'site-tiles' }, watch.map((w) => siteTile(w)))) : null,
    recentSection,
    h('section', { class: 'section grid g3 features' },
      FEATURES.map(([d, t, p]) => h('div', { class: 'card feature' },
        h('div', { class: 'ico' }, svgIcon(d)), h('h3', null, t), h('p', null, p)))),
    h('section', { class: 'section card' },
      h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'How SiteLens compares'),
        h('p', { class: 'muted small' }, 'An honest comparison with typical paid traffic-intelligence tools.'))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'vs-table' },
        h('thead', null, h('tr', null, h('th', null, 'Feature'), h('th', null, 'SiteLens'), h('th', null, 'Typical paid tools'))),
        h('tbody', null, [
          ['Full report without an account', true, 'Limited preview'],
          ['REST API', 'Free, open, self-hostable', 'Enterprise plans'],
          ['Technology stack detection', true, 'Separate product / add-on'],
          ['Security, SEO and performance audits', true, false],
          ['SaaS tools & email providers (DNS)', true, false],
          ['Compare up to 5 sites', true, 'Paid'],
          ['Methodology published', true, false],
          ['Clickstream traffic sources & demographics', false, true],
        ].map(([f, a, b]) => h('tr', null, h('td', null, f), cell(a), cell(b))))))));

  hasBackend().then((ok) => {
    if (!ok) { recentSection.remove(); return null; }
    return api('/api/v1/recent?limit=12');
  }).then((res) => {
    if (!res) return;
    const { sites } = res;
    recentBox.replaceChildren(...(sites.length ? sites.map(siteTile) : [h('div', { class: 'muted small' }, 'Nothing analyzed yet. Be the first: search above.')]));
  }).catch(() => recentBox.replaceChildren(h('div', { class: 'muted small' }, 'Could not load recent sites.')));
  return view;
}

function cell(v) {
  if (v === true) return h('td', { class: 'yes' }, '✓ Yes');
  if (v === false) return h('td', { class: 'no' }, '—');
  return h('td', null, v);
}

function svgIcon(d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

// ---- site report ---------------------------------------------------------------

const STEPS = ['Fetching the homepage', 'Resolving DNS, hosting and email', 'Inspecting the TLS certificate', 'Detecting technologies', 'Looking up global rank', 'Reading robots.txt, sitemap and ads.txt', 'Checking registration and archive history', 'Scoring SEO, performance and security'];

function loadingView(domain) {
  const items = STEPS.map((s) => h('li', null, h('span', { class: 'spinner' }), s));
  const view = h('div', { class: 'loading', 'aria-live': 'polite' },
    h('h2', null, `Analyzing ${domain}`),
    h('p', { class: 'muted' }, 'Running live checks. This usually takes 3–10 seconds.'),
    h('ul', { class: 'steps' }, items));
  let i = 0;
  items[0].classList.add('on');
  const timer = setInterval(() => {
    if (i >= items.length - 1) return;
    items[i].classList.replace('on', 'done');
    i++;
    items[i].classList.add('on');
  }, 900);
  view.stop = () => clearInterval(timer);
  return view;
}

async function siteView(domain, fresh = false) {
  let loading = null;
  // Only show the progress screen if the report isn't already saved.
  const showLoading = setTimeout(() => { loading = loadingView(domain); render(loading); }, 120);
  let r;
  let cachedAt;
  try {
    ({ report: r, cachedAt } = await getReport(domain, { fresh }));
  } catch (err) {
    clearTimeout(showLoading);
    loading?.stop();
    return render(errorView(`Couldn't analyze ${domain}`, err.message, () => siteView(domain, true)));
  }
  clearTimeout(showLoading);
  loading?.stop();
  if (currentRoute !== `site:${domain}`) return;
  if (!r.reachable) return render(errorView(`Couldn't reach ${r.host || domain}`, r.error || 'The site did not respond.', () => siteView(domain, true)));
  addSearch(domain);
  document.title = `${r.domain} · SiteLens`;
  render(r.mode === 'lite' ? liteReportView(r, cachedAt) : reportView(r, cachedAt));
}

function freshness(r, cachedAt, verb) {
  const took = `${verb} ${ago(r.meta.analyzedAt)} in ${(r.meta.durationMs / 1000).toFixed(1)}s`;
  return h('div', { class: 'muted small' }, took, cachedAt ? h('span', { class: 'chip', style: { marginLeft: '8px' }, title: 'Loaded instantly from your browser. Use Re-run for a fresh check.' }, '⚡ Saved result') : null);
}

function reportView(r, cachedAt) {
  const prev = watchlist().find((w) => w.domain === r.domain);
  if (prev) { // refresh the stored snapshot so the watchlist stays current
    const list = watchlist().map((w) => (w.domain === r.domain ? snapshot(r) : w));
    store.set('sitelens-watch', list);
  }
  const watchBtn = h('button', { class: 'btn sm', type: 'button' }, isWatched(r.domain) ? '★ Watching' : '☆ Watch');
  watchBtn.addEventListener('click', () => { watchBtn.textContent = toggleWatch(r) ? '★ Watching' : '☆ Watch'; });

  const t = r.traffic;
  const rk = r.rank;
  const rdap = r.domainInfo?.rdap;
  const wb = r.domainInfo?.wayback;
  const ageYears = rdap?.ageYears ?? (wb?.firstSeen ? Math.round(((Date.now() - new Date(wb.firstSeen)) / 31557600000) * 10) / 10 : null);

  const sections = [
    ['overview', 'Overview'], ['traffic', 'Traffic'], ['tech', 'Technology'], ['audits', 'Audits'],
    ['infra', 'Infrastructure'], ['content', 'Content & links'], ['domain', 'Domain'], ['similar', 'Similar'], ['api', 'API'],
  ];

  return h('div', null,
    h('div', { class: 'report-head', id: 'overview' },
      favicon(r.site?.icon, r.domain, 'lg'),
      h('div', { class: 'info' },
        h('h1', null, r.domain, r.category?.primary ? h('span', { class: 'chip accent' }, r.category.primary) : null),
        r.site?.title ? h('div', { class: 'title' }, r.site.title) : null,
        r.site?.description ? h('p', { class: 'desc' }, r.site.description) : null,
        h('div', { class: 'report-actions' },
          ext(r.url, h('span', { class: 'btn sm' }, 'Visit site ↗')),
          h('a', { class: 'btn sm', href: `#/compare/${r.domain}` }, 'Compare'),
          watchBtn,
          h('button', { class: 'btn sm', type: 'button', onclick: () => downloadJson(r) }, 'JSON'),
          h('a', { class: 'btn sm', href: apiUrl(`/api/v1/analyze/${r.domain}?format=csv`) }, 'CSV'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => siteView(r.domain, true) }, '↻ Re-run'))),
      freshness(r, cachedAt, 'Analyzed')),

    prev && prev.at !== r.meta.analyzedAt ? changesCallout(prev, r) : null,

    h('div', { class: 'kpis' },
      rankKpi(r),
      visitsKpi(r),
      kpi('Overall score', `${r.scores.overall}`, `Perf ${r.scores.performance} · SEO ${r.scores.seo} · Sec ${r.scores.security}`),
      kpi('Domain age', ageYears != null ? `${ageYears} yrs` : '—', rdap?.created ? `Registered ${date(rdap.created)}` : (wb?.firstSeen ? `Archived since ${wb.firstSeen.slice(0, 4)}` : 'unknown')),
      kpi('Technologies', String(r.tech.count), Object.keys(r.tech.byCategory).slice(0, 3).join(', ') || 'none detected'),
      kpi('Server response', `${r.performance.metrics?.ttfb ?? '—'} ms`, `TTFB · ${r.performance.metrics?.htmlKb ?? '—'} KB HTML`)),

    h('nav', { class: 'subnav', 'aria-label': 'Report sections' },
      sections.map(([id, label]) => h('a', { href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); } }, label))),

    h('section', { class: 'section grid g-main', id: 'traffic' }, trafficCard(r), scoresCard(r)),
    audienceCard(r),
    h('section', { class: 'section', id: 'tech' }, h('h2', null, 'Technology stack', h('span', { class: 'chip' }, `${r.tech.count} detected`)), techView(r.tech)),
    h('section', { class: 'section', id: 'audits' }, h('h2', null, 'Audits'),
      h('div', { class: 'grid g3' },
        auditCard('Performance', r.performance), auditCard('SEO', r.seo), auditCard('Security', r.security))),
    h('section', { class: 'section', id: 'infra' }, h('h2', null, 'Infrastructure'), infraView(r)),
    h('section', { class: 'section', id: 'content' }, h('h2', null, 'Content & links'), contentView(r)),
    h('section', { class: 'section', id: 'domain' }, h('h2', null, 'Domain & history'), domainView(r)),
    h('section', { class: 'section', id: 'similar' }, h('h2', null, 'Similar sites'), similarView(r)),
    h('section', { class: 'section', id: 'api' }, h('h2', null, 'Get this data via API'), apiSnippet(r.domain)));
}

function changesCallout(prev, r) {
  const parts = [];
  const d = (a, b) => (a != null && b != null && a !== b ? b - a : 0);
  const ov = d(prev.scores?.overall, r.scores.overall);
  if (ov) parts.push(`overall score ${ov > 0 ? '+' : ''}${ov}`);
  const rk = d(prev.rank, r.rank?.rank);
  if (rk) parts.push(`rank ${rk < 0 ? 'up' : 'down'} ${fmt(Math.abs(rk))} places`);
  for (const k of ['performance', 'seo', 'security']) {
    const v = d(prev.scores?.[k], r.scores[k]);
    if (v) parts.push(`${k} ${v > 0 ? '+' : ''}${v}`);
  }
  return h('div', { class: 'callout section', style: { marginTop: '16px' } },
    h('b', null, 'Since your last check '), h('span', { class: 'muted' }, `(${date(prev.at)}): `),
    parts.length ? parts.join(' · ') : 'no changes in scores or rank.');
}

function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value', title: value }, value), h('div', { class: 'sub' }, sub));
}

function trafficCard(r) {
  const t = r.traffic;
  const rk = r.rank;
  const body = h('div');
  const tabs = h('div', { class: 'chart-tabs', role: 'tablist' });
  const modes = [['visits', 'Est. visits'], ['rank', 'Global rank']];
  const draw = (mode) => {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    if (!rk?.history?.length) {
      body.replaceChildren(h('div', { class: 'empty' }, rk?.rank
        ? `Ranked ${rankStr(rk.rank)} in the local Tranco list. Daily history needs the Tranco API, which was unreachable.`
        : t?.note || 'No ranking data for this domain.'));
      return;
    }
    body.replaceChildren(mode === 'rank'
      ? lineChart({ series: [{ name: 'Tranco rank', points: rk.history.map((p) => ({ x: p.date, y: p.rank })) }], invert: true, format: (v) => `#${compact(v)}`, label: `Tranco rank history for ${r.domain}` })
      : lineChart({ series: [{ name: 'Est. monthly visits', points: t.history.map((p) => ({ x: p.date, y: p.visits })) }], format: compact, label: `Estimated monthly visits for ${r.domain}` }));
  };
  for (const [mode, label] of modes) {
    tabs.append(h('button', { type: 'button', role: 'tab', 'data-mode': mode, onclick: () => draw(mode) }, label));
  }
  draw('visits');
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h3', null, 'Traffic & popularity'),
        h('p', { class: 'muted small' }, t?.available
          ? `~${compact(t.monthlyVisits)} visits/month (range ${compact(t.low)}–${compact(t.high)}) · ${t.trendPct != null ? `${t.trendPct > 0 ? '+' : ''}${t.trendPct}% over the period · ` : ''}confidence: ${t.confidence}`
          : 'Below the top-1M threshold')),
      tabs),
    body,
    t?.available ? h('p', { class: 'note' }, t.note, ` Model: ${t.model}.`) : null);
}

function scoresCard(r) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Site health')),
    h('div', { class: 'rings' },
      ring(r.scores.overall, 'Overall', grade(r.scores.overall)),
      ring(r.performance.score, 'Performance', r.performance.grade),
      ring(r.seo.score, 'SEO', r.seo.grade),
      ring(r.security.score, 'Security', r.security.grade)),
    h('p', { class: 'note' }, 'Overall = 35% performance + 35% SEO + 30% security. Every check is listed under Audits.'));
}

function grade(score) {
  return score >= 95 ? 'A+' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
}

function audienceCard(r) {
  const sig = r.audience?.signals || [];
  const cat = r.category?.scores || [];
  return h('section', { class: 'section grid g2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Audience signals'), h('p', { class: 'muted small' }, 'Inferred from what the site publishes, not from tracking people.'))),
      sig.length ? h('dl', { class: 'kv' }, sig.map((s) => [h('dt', null, s.type), h('dd', null, s.value)])) : h('div', { class: 'empty' }, 'No audience signals found.')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Category'), h('p', { class: 'muted small' }, 'Topic classifier over title, headings and text.'))),
      cat.length ? barList(cat.map((c) => ({ label: c.category, value: c.confidence, display: `${c.confidence}%`, tip: 'confidence' })), { max: 100 }) : h('div', { class: 'empty' }, 'Not enough text to classify.'),
      r.topics?.length ? h('div', { class: 'chips', style: { marginTop: '14px' } }, r.topics.slice(0, 12).map((w) => h('span', { class: 'chip' }, w))) : null));
}

function techView(tech) {
  if (!tech.count) return h('div', { class: 'empty' }, 'No known technologies detected on the homepage.');
  return h('div', { class: 'tech-cats' },
    Object.entries(tech.byCategory).map(([cat, items]) => h('div', { class: 'tech-cat' },
      h('h4', null, cat),
      items.map((t) => h('div', { class: 'tech-item', title: `Detected via ${t.evidence}` },
        h('span', null, h('span', { class: 'tech-dot' }), t.name),
        t.version ? h('span', { class: 'ver' }, t.version) : null)))));
}

function auditCard(name, audit) {
  const st = statusOf(audit.score);
  return h('div', { class: 'card' },
    h('div', { class: 'audit-head' },
      h('div', { class: `grade ${st}` }, audit.grade),
      h('div', null, h('h3', null, `${name}: ${audit.score}/100`), h('div', { class: 'muted small' }, `${audit.passed} passed · ${audit.failed} to improve`))),
    h('ul', { class: 'checks' }, audit.checks.map((c) => {
      const cls = c.pass === null ? 'na' : c.pass === true ? 'pass' : c.pass === false ? 'fail' : c.pass >= 0.75 ? 'pass' : c.pass > 0 ? 'partial' : 'fail';
      const sym = { na: '–', pass: '✓', fail: '✕', partial: '!' }[cls];
      return h('li', null,
        h('span', { class: `st ${cls}`, 'aria-label': { na: 'Not applicable', pass: 'Pass', fail: 'Fail', partial: 'Partial' }[cls] }, sym),
        h('div', null, h('div', null, c.label), c.detail ? h('div', { class: 'detail' }, c.detail) : null));
    })));
}

const list = (arr, empty = '—') => (arr?.length ? arr.join(', ') : empty);

function hostingCard(r) {
  const d = r.dns;
  const net = d?.network;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Hosting & network')),
      h('dl', { class: 'kv' },
        h('dt', null, 'Hosting'), h('dd', null, d?.providers?.hosting || '—'),
        h('dt', null, 'IP address'), h('dd', { class: 'mono' }, net?.ip || r.http?.ip || '—'),
        h('dt', null, 'Network'), h('dd', null, net?.asn ? `AS${net.asn} ${net.org || ''}` : '—'),
        h('dt', null, 'Server country'), h('dd', null, net?.country || '—'),
        h('dt', null, 'Reverse DNS'), h('dd', { class: 'mono' }, net?.ptr || '—'),
        h('dt', null, 'IPv6'), h('dd', null, d ? (d.ipv6 ? `Yes (${d.aaaa[0]})` : 'No') : '—'),
        h('dt', null, 'DNS provider'), h('dd', null, list(d?.providers?.dns, list(d?.ns))),
        h('dt', null, 'Nameservers'), h('dd', { class: 'mono' }, list(d?.ns)),
        h('dt', null, 'www CNAME'), h('dd', { class: 'mono' }, d?.wwwCname || '—')));
}

function saasCard(r) {
  const d = r.dns;
  return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Email & SaaS footprint'), h('p', { class: 'muted small' }, 'From MX, SPF and TXT verification records.'))),
      h('dl', { class: 'kv' },
        h('dt', null, 'Email provider'), h('dd', null, list(d?.providers?.email, d?.mx?.length ? d.mx[0] : 'No MX records')),
        h('dt', null, 'Sends email via'), h('dd', null, list(d?.providers?.emailSenders)),
        h('dt', null, 'DMARC policy'), h('dd', null, d?.dmarcPolicy || 'none')),
      h('h4', { class: 'small muted', style: { margin: '14px 0 8px' } }, 'TOOLS VERIFIED ON THIS DOMAIN'),
      d?.providers?.verifiedServices?.length
        ? h('div', { class: 'chips' }, d.providers.verifiedServices.map((s) => h('span', { class: 'chip' }, s)))
        : h('div', { class: 'muted small' }, 'None found in TXT records.'));
}

function rankKpi(r) {
  const rk = r.rank;
  const t = r.traffic;
  if (!rk?.rank && t?.rankUnavailable) return kpi('Global rank', '—', 'ranking service unreachable');
  return kpi('Global rank', rankStr(rk?.rank), rk?.change
    ? h('span', { class: rk.change > 0 ? 'delta-up' : 'delta-down' }, `${rk.change > 0 ? '▲' : '▼'} ${fmt(Math.abs(rk.change))} in 30 days`)
    : (rk?.rank ? 'Tranco list' : 'Not in top 1M'));
}

function visitsKpi(r) {
  const t = r.traffic;
  if (t?.available) return kpi('Monthly visits', `~${compact(t.monthlyVisits)}`, `${compact(t.low)} – ${compact(t.high)} est.`);
  return kpi('Monthly visits', t?.rankUnavailable ? '—' : '< 10K', t?.rankUnavailable ? 'needs rank data' : 'estimate');
}

function infraView(r) {
  const tls = r.tls;
  const m = r.performance.metrics || {};
  const timing = [['DNS', m.dns], ['Connect', m.connect], ['TLS', m.tls], ['First byte', m.ttfb], ['Download', m.total]].filter(([, v]) => v != null);
  return h('div', { class: 'grid g2' },
    hostingCard(r),
    saasCard(r),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'TLS certificate')),
      tls && !tls.error ? h('dl', { class: 'kv' },
        h('dt', null, 'Status'), h('dd', null, tls.authorized ? h('span', { class: 'yes' }, '✓ Valid & trusted') : h('span', { class: 'delta-down' }, `✕ ${tls.authorizationError || 'Untrusted'}`)),
        h('dt', null, 'Issuer'), h('dd', null, tls.issuer || '—', tls.issuerCN ? h('span', { class: 'muted' }, ` (${tls.issuerCN})`) : null),
        h('dt', null, 'Valid'), h('dd', null, `${date(tls.validFrom)} → ${date(tls.validTo)}`),
        h('dt', null, 'Expires in'), h('dd', null, `${tls.daysRemaining} days`),
        h('dt', null, 'Protocol'), h('dd', null, `${tls.protocol} · ${tls.cipher}`),
        h('dt', null, 'ALPN'), h('dd', null, tls.alpn || '—'),
        h('dt', null, 'Key'), h('dd', null, tls.keyType || '—'),
        h('dt', null, 'Covers'), h('dd', null, `${tls.sanCount} hostname(s)${tls.wildcard ? ', incl. wildcard' : ''}`)) : h('div', { class: 'empty' }, tls?.error || 'Site is not served over HTTPS.'),
      tls?.sans?.length ? h('details', { style: { marginTop: '12px' } }, h('summary', null, 'Hostnames on this certificate'),
        h('div', { class: 'chips', style: { marginTop: '8px' } }, tls.sans.map((s) => h('span', { class: 'chip mono' }, s)))) : null),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'HTTP response')),
      timing.length ? barList(timing.map(([label, v]) => ({ label, value: v, display: `${v} ms`, tip: 'cumulative' }))) : null,
      h('dl', { class: 'kv', style: { marginTop: '14px' } },
        h('dt', null, 'Status'), h('dd', null, `${r.http.status} · HTTP/${r.http.httpVersion}`),
        h('dt', null, 'Final URL'), h('dd', { class: 'mono' }, r.http.finalUrl),
        h('dt', null, 'Redirects'), h('dd', null, r.http.redirects.length ? r.http.redirects.map((x) => `${x.status} ${x.url}`).join(' → ') : 'None'),
        h('dt', null, 'Size'), h('dd', null, `${(r.http.bytes / 1024).toFixed(1)} KB (${(r.http.transferBytes / 1024).toFixed(1)} KB on the wire, ${r.http.encoding || 'uncompressed'})`)),
      h('details', { style: { marginTop: '12px' } }, h('summary', null, 'Response headers'),
        h('pre', { style: { marginTop: '8px' } }, Object.entries(r.http.headers).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('\n')))));
}

function contentView(r) {
  const c = r.content;
  const l = r.links;
  const f = r.files;
  const blockedBots = f?.robots?.aiBots?.filter((b) => b.blocked) || [];
  return h('div', { class: 'grid g2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Top outbound domains'), h('p', { class: 'muted small' }, 'Where the homepage sends visitors.'))),
      l?.topOutbound?.length
        ? barList(l.topOutbound.slice(0, 10).map((o, i) => ({ label: o.domain, value: o.links, display: String(o.links), tip: `link${o.links > 1 ? 's' : ''}${o.nofollow ? `, ${o.nofollow} nofollow` : ''}`, color: i === 0 ? 'var(--s1)' : undefined })), { href: (it) => `#/site/${it.label}` })
        : h('div', { class: 'empty' }, 'No external links on the homepage.'),
      l ? h('p', { class: 'note' }, `${fmt(l.total)} links: ${fmt(l.internal)} internal (${fmt(l.uniqueInternalPaths)} unique paths), ${fmt(l.external)} external.`) : null),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Social profiles')),
      l?.social?.length
        ? h('div', { class: 'chips' }, l.social.map((s) => ext(s.url, h('span', { class: 'chip' }, s.network, ' ↗'))))
        : h('div', { class: 'muted small' }, 'No social profile links found on the homepage.'),
      h('h4', { class: 'small muted', style: { margin: '18px 0 8px' } }, 'PAGE CONTENT'),
      c ? h('dl', { class: 'kv' },
        h('dt', null, 'Words'), h('dd', null, fmt(c.wordCount)),
        h('dt', null, 'Headings'), h('dd', null, `H1 ${c.headings.h1} · H2 ${c.headings.h2} · H3 ${c.headings.h3}`),
        h('dt', null, 'Images'), h('dd', null, `${fmt(c.images)} (${fmt(c.imagesMissingAlt)} missing alt)`),
        h('dt', null, 'Scripts'), h('dd', null, `${c.scripts} external, ${c.inlineScripts} inline`),
        h('dt', null, 'Structured data'), h('dd', null, c.structuredData.join(', ') || '—'),
        h('dt', null, 'Feeds'), h('dd', null, r.site?.feeds?.length ? r.site.feeds.map((u) => ext(u, 'RSS ')) : '—')) : null),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Crawlers & AI bots'), h('p', { class: 'muted small' }, 'From robots.txt.'))),
      f?.robots ? h('div', null,
        h('p', { class: 'small', style: { marginTop: 0 } }, f.robots.blocksEverything ? 'robots.txt blocks all crawlers. ' : '',
          blockedBots.length ? `Blocks ${blockedBots.length} of ${f.robots.aiBots.length} known AI crawlers.` : 'Allows all known AI crawlers.'),
        h('div', { class: 'chips' }, f.robots.aiBots.map((b) => h('span', { class: 'chip', title: b.blocked ? 'Blocked' : 'Allowed' }, b.blocked ? '⛔ ' : '✓ ', b.bot)))) : h('div', { class: 'muted small' }, 'No robots.txt found.'),
      h('dl', { class: 'kv', style: { marginTop: '14px' } },
        h('dt', null, 'Sitemap'), h('dd', null, f?.sitemap ? [ext(f.sitemap.url, f.sitemap.isIndex ? `Index of ${f.sitemap.children} sitemaps` : `${fmt(f.sitemap.urls)} URLs`), f.sitemap.latestUpdate ? ` · updated ${f.sitemap.latestUpdate.slice(0, 10)}` : ''] : 'Not found'),
        h('dt', null, 'llms.txt'), h('dd', null, f?.llmsTxt ? `Yes${f.llmsTxt.title ? ` (“${f.llmsTxt.title}”)` : ''}` : 'No'),
        h('dt', null, 'security.txt'), h('dd', null, f?.securityTxt ? f.securityTxt.contact || 'Yes' : 'No'))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Monetization (ads.txt)'), h('p', { class: 'muted small' }, 'Authorized ad sellers declared by the publisher.'))),
      f?.adsTxt ? h('div', null,
        h('p', { class: 'small', style: { marginTop: 0 } }, `${fmt(f.adsTxt.sellers)} authorized sellers (${fmt(f.adsTxt.direct)} direct, ${fmt(f.adsTxt.reseller)} resellers).`),
        barList(f.adsTxt.topSystems.slice(0, 8).map((s) => ({ label: s.domain, value: s.count, tip: 'entries' })))) : h('div', { class: 'empty' }, 'No ads.txt: the site probably does not sell programmatic ads.')));
}

function domainView(r) {
  const rd = r.domainInfo?.rdap;
  const wb = r.domainInfo?.wayback;
  let years = null;
  if (wb?.yearsArchived?.length) {
    const first = wb.yearsArchived[0];
    const now = new Date().getFullYear();
    const set = new Set(wb.yearsArchived);
    years = h('div', { class: 'timeline' }, Array.from({ length: now - first + 1 }, (_, i) => first + i).map((y) => h('span', { class: set.has(y) ? '' : 'off', title: set.has(y) ? 'Archived' : 'No capture' }, String(y))));
  }
  return h('div', { class: 'grid g2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Registration'), h('p', { class: 'muted small' }, 'From the registry via RDAP.'))),
      rd ? h('dl', { class: 'kv' },
        h('dt', null, 'Registrar'), h('dd', null, rd.registrar || '—'),
        h('dt', null, 'Created'), h('dd', null, `${date(rd.created)}${rd.ageYears != null ? ` (${rd.ageYears} years)` : ''}`),
        h('dt', null, 'Expires'), h('dd', null, date(rd.expires)),
        h('dt', null, 'Updated'), h('dd', null, date(rd.updated)),
        h('dt', null, 'DNSSEC'), h('dd', null, rd.dnssec == null ? '—' : rd.dnssec ? 'Signed' : 'Not signed'),
        h('dt', null, 'Status'), h('dd', { class: 'small' }, rd.status.join(', ') || '—')) : h('div', { class: 'empty' }, 'Registration data unavailable for this TLD.')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Web archive history'), h('p', { class: 'muted small' }, 'Captures by the Internet Archive.'))),
      wb ? h('div', null,
        h('dl', { class: 'kv' },
          h('dt', null, 'First captured'), h('dd', null, date(wb.firstSeen)),
          h('dt', null, 'Latest capture'), h('dd', null, date(wb.lastSeen)),
          h('dt', null, 'Browse'), h('dd', null, ext(wb.url, 'Open in the Wayback Machine ↗'))),
        years ? h('div', { style: { marginTop: '14px' } }, years) : null) : h('div', { class: 'empty' }, 'No archive history found.')));
}

function similarView(r) {
  if (!r.similar?.length) {
    return h('div', { class: 'card' }, h('p', { class: 'muted', style: { margin: 0 } },
      'No similar sites in the index yet. Similarity grows as more sites are analyzed: it matches category, topics, tech stack and outbound links. ',
      h('a', { href: `#/compare/${r.domain}` }, 'Compare manually →')));
  }
  return h('div', { class: 'site-tiles' }, r.similar.map((s) => h('a', { class: 'site-tile', href: `#/site/${s.domain}` },
    favicon(s.icon, s.domain),
    h('div', { class: 't' }, h('b', null, s.domain), h('span', null, `${s.similarity}% match${s.rank ? ` · ${rankStr(s.rank)}` : ''}`)))));
}

function apiSnippet(domain) {
  const base = API_BASE || location.origin;
  return h('div', { class: 'card' },
    h('p', { style: { marginTop: 0 } }, 'Everything on this page is available as JSON. No key needed. ', h('a', { href: '#/api' }, 'API docs →')),
    h('pre', null, `curl ${base}/api/v1/analyze/${domain}\ncurl "${base}/api/v1/analyze/${domain}?fields=scores,traffic.monthlyVisits,tech.list"\ncurl ${base}/api/v1/rank/${domain}`));
}

function downloadJson(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const a = h('a', { download: `${r.domain}-sitelens.json` });
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- lite (browser-only) report ------------------------------------------------

function liteReportView(r, cachedAt) {
  const watchBtn = h('button', { class: 'btn sm', type: 'button' }, isWatched(r.domain) ? '★ Watching' : '☆ Watch');
  watchBtn.addEventListener('click', () => { watchBtn.textContent = toggleWatch(r) ? '★ Watching' : '☆ Watch'; });
  const d = r.dns;
  const rdap = r.domainInfo?.rdap;
  const wb = r.domainInfo?.wayback;
  const ageYears = rdap?.ageYears ?? (wb?.firstSeen ? Math.round(((Date.now() - new Date(wb.firstSeen)) / 31557600000) * 10) / 10 : null);
  const es = r.emailSecurity;
  return h('div', null,
    h('div', { class: 'report-head', id: 'overview' },
      favicon(r.site?.icon, r.domain, 'lg'),
      h('div', { class: 'info' },
        h('h1', null, r.domain, h('span', { class: 'chip' }, 'Lite report')),
        h('div', { class: 'report-actions', style: { marginTop: '10px' } },
          ext(r.url, h('span', { class: 'btn sm' }, 'Visit site ↗')),
          h('a', { class: 'btn sm', href: `#/compare/${r.domain}` }, 'Compare'),
          watchBtn,
          h('button', { class: 'btn sm', type: 'button', onclick: () => downloadJson(r) }, 'JSON'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => siteView(r.domain, true) }, '↻ Re-run'))),
      freshness(r, cachedAt, 'Checked')),
    liteNotice(),
    h('div', { class: 'kpis' },
      rankKpi(r),
      visitsKpi(r),
      kpi('Domain age', ageYears != null ? `${ageYears} yrs` : '—', rdap?.created ? `Registered ${date(rdap.created)}` : (wb?.firstSeen ? `Archived since ${wb.firstSeen.slice(0, 4)}` : 'unknown')),
      kpi('Hosting', d?.providers?.hosting || '—', d?.network?.country ? `Server in ${d.network.country}` : 'from IP network'),
      kpi('Email', d?.providers?.email?.[0] || (d?.mx?.length ? 'Custom' : 'None'), d?.providers?.emailSenders?.length ? `+ ${d.providers.emailSenders.length} sending service(s)` : 'MX records'),
      kpi('Email security', es ? `${es.score}` : '—', es ? `Grade ${es.grade}` : 'DNS unavailable')),
    h('section', { class: 'section', id: 'traffic' }, trafficCard(r)),
    h('section', { class: 'section', id: 'infra' }, h('h2', null, 'Infrastructure'),
      d ? h('div', { class: 'grid g2' }, hostingCard(r), saasCard(r)) : h('div', { class: 'callout err' }, 'DNS lookups failed. Try again in a moment.')),
    es ? h('section', { class: 'section', id: 'audits' }, h('h2', null, 'Email & DNS security'),
      h('div', { class: 'grid g2' }, auditCard('Email & DNS', es),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', null, 'Raw records')),
          h('pre', null, [
            `A      ${list(d.a)}`, `AAAA   ${list(d.aaaa)}`, `MX     ${list(d.mx)}`, `NS     ${list(d.ns)}`,
            `SPF    ${d.spf || '—'}`, `DMARC  ${d.dmarc || '—'}`, ...d.txt.filter((t) => !/^v=spf1/i.test(t)).slice(0, 12).map((t) => `TXT    ${t}`),
          ].join('\n'))))) : null,
    h('section', { class: 'section', id: 'domain' }, h('h2', null, 'Domain & history'), domainView(r)));
}

/** Maps a full or lite report to the row shape the comparison view uses. */
function toCompareSite(r) {
  const lite = r.mode === 'lite';
  return {
    domain: r.domain,
    reachable: true,
    icon: r.site?.icon || null,
    category: r.category?.primary || null,
    rank: r.rank?.rank ?? null,
    monthlyVisits: r.traffic?.monthlyVisits ?? null,
    scores: lite ? null : r.scores,
    tech: lite ? null : r.tech.list.map((t) => t.name),
    hosting: r.dns?.providers?.hosting || null,
    providers: r.dns?.providers || null,
    performance: r.performance?.metrics || null,
    tls: r.tls && !r.tls.error ? { protocol: r.tls.protocol, http2: r.tls.http2 } : null,
    domainAge: r.domainInfo?.rdap?.ageYears ?? null,
    firstSeen: r.domainInfo?.wayback?.firstSeen ?? null,
    rankHistory: r.rank?.history || [],
    words: r.content?.wordCount ?? null,
    sitemapUrls: r.files?.sitemap?.urls ?? null,
    emailSecurity: r.emailSecurity?.score ?? null,
    saas: r.dns?.providers?.verifiedServices?.length ?? null,
  };
}

// ---- compare -------------------------------------------------------------------

async function compareView(list) {
  const domains = list.map(cleanDomain).filter(Boolean).slice(0, 5);
  const inputs = Array.from({ length: Math.max(2, Math.min(5, domains.length + 1)) }, (_, i) =>
    h('input', { class: 'field', value: domains[i] || '', placeholder: i === 0 ? 'first.com' : 'competitor.com', 'aria-label': `Site ${i + 1}`, list: 'recent-domains', autocomplete: 'off' }));
  // Clicking a recent search drops it into the first empty box (or adds a box).
  const pick = (d) => {
    if (inputs.some((i) => cleanDomain(i.value) === d)) return;
    let target = inputs.find((i) => !i.value.trim());
    if (!target && inputs.length < 5) {
      target = h('input', { class: 'field', placeholder: 'competitor.com', 'aria-label': `Site ${inputs.length + 1}`, list: 'recent-domains', autocomplete: 'off' });
      inputs.at(-1).after(target);
      inputs.push(target);
    }
    if (target) target.value = d;
  };
  const form = h('form', { class: 'compare-form' }, inputs, h('button', { class: 'btn primary', type: 'submit', style: { height: '44px' } }, 'Compare'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ds = inputs.map((i) => cleanDomain(i.value)).filter(Boolean);
    if (ds.length) location.hash = `#/compare/${ds.join(',')}`;
  });
  const results = h('div');
  render(h('div', null,
    h('h1', { style: { fontSize: '28px', letterSpacing: '-0.02em' } }, 'Compare websites'),
    h('p', { class: 'muted' }, 'Put up to five sites side by side: traffic, rank trend, scores, stack and infrastructure.'),
    h('div', { class: 'card' }, form, recentSearchesRow({ onPick: pick })),
    results));
  if (domains.length < 2) {
    results.append(h('div', { class: 'section chips' }, h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Ideas:'),
      [['github.com', 'gitlab.com', 'bitbucket.org'], ['nytimes.com', 'theguardian.com', 'bbc.com'], ['stripe.com', 'paypal.com', 'adyen.com']].map((g) =>
        h('a', { class: 'chip', href: `#/compare/${g.join(',')}` }, g.join(' vs ')))));
    return;
  }
  const route = currentRoute;
  let loading = null;
  const showLoading = setTimeout(() => { loading = loadingView(domains.join(', ')); results.replaceChildren(loading); }, 120);
  const full = await hasBackend();
  const fetched = await Promise.all(domains.map((d) => getReport(d)
    .then(({ report, cachedAt }) => ({ report, cachedAt }))
    .catch((err) => ({ report: { domain: d, reachable: false, error: err.message } }))));
  clearTimeout(showLoading);
  loading?.stop();
  if (currentRoute !== route) return;
  fetched.forEach(({ report }, i) => { if (report.reachable) addSearch(domains[i]); });
  const fromCache = fetched.filter((f) => f.cachedAt).length;
  const data = {
    lite: !full,
    domains,
    sites: fetched.map(({ report }) => (report.reachable ? toCompareSite(report) : { domain: report.domain || '?', reachable: false, error: report.error })),
  };
  results.replaceChildren(
    fromCache ? h('p', { class: 'muted small section', style: { marginBottom: 0 } }, `⚡ ${fromCache} of ${domains.length} loaded instantly from saved results.`) : '',
    compareResults(data));
}

function compareResults(data) {
  const ok = data.sites.filter((s) => s.reachable);
  const failed = data.sites.filter((s) => !s.reachable);
  const color = (s) => seriesColor(data.sites.indexOf(s));
  const legend = h('div', { class: 'legend' }, ok.map((s) => h('span', null, h('i', { style: { background: color(s) } }), s.domain)));

  const metric = (title, get, { fmt: f = fmt, higherBetter = true, max } = {}) => {
    const vals = ok.map((s) => ({ s, v: get(s) }));
    const nums = vals.filter((x) => x.v != null).map((x) => x.v);
    if (!nums.length) return null;
    const best = nums.length > 1 && !nums.every((v) => v === nums[0]) ? (higherBetter ? Math.max(...nums) : Math.min(...nums)) : null;
    return h('div', { class: 'metric-group' },
      h('h4', null, title),
      barList(vals.map(({ s, v }) => ({
        label: s.domain, value: v == null ? 0 : (higherBetter ? v : Math.min(...nums) / Math.max(v, 1)), display: v == null ? '—' : `${f(v)}${v === best ? ' ★' : ''}`, color: color(s), tip: title,
      })), { max: higherBetter ? (max ?? Math.max(...nums, 1)) : 1 }));
  };

  const rankSeries = ok.filter((s) => s.rankHistory?.length).map((s) => ({ name: s.domain, points: s.rankHistory.map((p) => ({ x: p.date, y: p.rank })) }));
  const rows = [
    ['Global rank', (s) => s.rank, (v) => rankStr(v), false],
    ['Est. monthly visits', (s) => s.monthlyVisits, compact, true],
    ['Overall score', (s) => s.scores?.overall, String, true],
    ['Performance', (s) => s.scores?.performance, String, true],
    ['SEO', (s) => s.scores?.seo, String, true],
    ['Security', (s) => s.scores?.security, String, true],
    ['Server response (TTFB)', (s) => s.performance?.ttfb, (v) => `${v} ms`, false],
    ['HTML size', (s) => s.performance?.htmlKb, (v) => `${v} KB`, false],
    ['Third-party script hosts', (s) => s.performance?.thirdPartyHosts, String, false],
    ['Technologies', (s) => s.tech?.length, String, null],
    ['Domain age', (s) => s.domainAge, (v) => `${Math.round(v * 10) / 10} yrs`, true],
    ['Sitemap URLs', (s) => s.sitemapUrls, fmt, null],
    ['Words on homepage', (s) => s.words, fmt, null],
    ['Email & DNS security', (s) => s.emailSecurity, String, true],
    ['SaaS tools verified', (s) => s.saas, String, null],
  ];
  const table = h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Metric'), ok.map((s) => h('th', { class: 'num' }, h('span', { class: 'nowrap' }, h('i', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: color(s), marginRight: '6px' } }), s.domain))))),
    h('tbody', null,
      rows.map(([label, get, f, higher]) => {
        const vals = ok.map(get);
        const nums = vals.filter((v) => v != null);
        if (!nums.length) return null;
        const allSame = nums.every((v) => v === nums[0]);
        const best = higher == null || nums.length < 2 || allSame ? null : higher ? Math.max(...nums) : Math.min(...nums);
        return h('tr', null, h('td', null, label), vals.map((v) => h('td', { class: `num ${v != null && v === best ? 'win' : ''}` }, v == null ? '—' : f(v))));
      }),
      [['Category', (s) => s.category || '—'], ['Hosting', (s) => s.hosting || s.providers?.hosting || '—'], ['Email', (s) => s.providers?.email?.join(', ') || '—'],
        ['TLS', (s) => (s.tls ? `${s.tls.protocol}${s.tls.http2 ? ' · h2' : ''}` : '—')], ['First archived', (s) => s.firstSeen || '—']]
        .filter(([, get]) => ok.some((s) => get(s) !== '—'))
        .map(([label, get]) => h('tr', null, h('td', null, label), ok.map((s) => h('td', { class: 'num small' }, get(s)))))));

  const allTech = new Map();
  ok.forEach((s) => (s.tech || []).forEach((t) => allTech.set(t, (allTech.get(t) || 0) + 1)));
  const shared = [...allTech].filter(([, n]) => n === ok.length).map(([t]) => t);

  return h('div', null,
    failed.length ? h('div', { class: 'callout err section' }, `Could not analyze: ${failed.map((f) => `${f.domain} (${f.error})`).join('; ')}`) : null,
    h('div', { class: 'section grid g-main' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'Global rank, last 30 days'), legend),
        rankSeries.length ? lineChart({ series: rankSeries, invert: true, format: (v) => `#${compact(v)}`, label: 'Rank comparison' }) : h('div', { class: 'empty' }, 'No rank history available for these sites.'),
        h('p', { class: 'note' }, 'Lower is better. Source: Tranco.')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, 'Head to head')),
        metric('Est. monthly visits', (s) => s.monthlyVisits, { fmt: compact }),
        metric('Overall score', (s) => s.scores?.overall, { max: 100, fmt: String }),
        metric('Email & DNS security', (s) => s.emailSecurity, { max: 100, fmt: String }),
        metric('Domain age', (s) => s.domainAge, { fmt: (v) => `${Math.round(v * 10) / 10} yrs` }),
        metric('Server response', (s) => s.performance?.ttfb, { fmt: (v) => `${v} ms`, higherBetter: false }))),
    h('div', { class: 'section card' },
      h('div', { class: 'card-head' }, h('h3', null, 'All metrics'), data.lite ? null : h('a', { href: apiUrl(`/api/v1/compare?domains=${data.domains.join(',')}&format=csv`), class: 'btn sm' }, 'Download CSV')),
      h('div', { class: 'table-wrap' }, table)),
    data.lite ? liteNotice() : h('div', { class: 'section card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Technology overlap'), h('p', { class: 'muted small' }, shared.length ? `Shared by all: ${shared.join(', ')}` : 'No technology shared by all sites.'))),
      h('div', { class: 'grid g2' }, ok.map((s) => h('div', null,
        h('h4', { class: 'small', style: { marginBottom: '8px' } }, s.domain),
        h('div', { class: 'chips' }, s.tech.filter((t) => !shared.includes(t)).map((t) => h('span', { class: 'chip' }, t))))))));
}

// ---- rankings ------------------------------------------------------------------

async function topView(tab = 'global') {
  const tabs = h('div', { class: 'chart-tabs', role: 'tablist' },
    [['global', 'Global top sites'], ['index', 'Analyzed leaderboard']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { location.hash = `#/top/${id}`; } }, label)));
  const body = h('div', { class: 'section' }, h('div', { class: 'muted' }, 'Loading…'));
  render(h('div', null,
    h('div', { class: 'card-head' }, h('div', null, h('h1', { style: { fontSize: '28px', letterSpacing: '-0.02em' } }, 'Rankings'),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, tab === 'global' ? 'The most popular domains on the web, from the Tranco list.' : 'Every site analyzed on this server, ranked by score.')), tabs),
    body));

  if (!(await hasBackend())) {
    body.replaceChildren(h('div', { class: 'callout' }, 'Rankings come from the SiteLens API server, which this copy of the site does not have. ',
      h('a', { href: 'https://github.com/0050piyush/SiteLens#run-it', target: '_blank', rel: 'noopener' }, 'How to run it →')));
    return;
  }
  if (tab === 'global') {
    try {
      const data = await api('/api/v1/top?limit=200');
      body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'num' }, 'Rank'), h('th', null, 'Domain'), h('th', { class: 'num' }, 'Est. visits / mo'), h('th', null, 'Category'), h('th', { class: 'num' }, 'Score'), h('th', null, ''))),
        h('tbody', null, data.sites.map((s) => h('tr', null,
          h('td', { class: 'num' }, fmt(s.rank)),
          h('td', null, h('a', { href: `#/site/${s.domain}` }, s.domain)),
          h('td', { class: 'num' }, `~${compact(85e9 * Math.pow(s.rank, -1.15))}`),
          h('td', { class: 'small muted' }, s.indexed?.category || ''),
          h('td', { class: 'num' }, s.indexed?.scores?.overall ?? ''),
          h('td', null, h('a', { class: 'btn sm', href: `#/site/${s.domain}` }, s.indexed ? 'View' : 'Analyze'))))))),
      h('p', { class: 'note' }, `List loaded ${date(data.loadedAt)} · ${fmt(data.domains)} domains.`)));
    } catch (err) {
      body.replaceChildren(h('div', { class: 'callout' }, err.message));
    }
    return;
  }
  const sortSel = h('select', { class: 'field', style: { width: 'auto', height: '38px' }, 'aria-label': 'Sort by' },
    [['score', 'Overall score'], ['rank', 'Global rank'], ['performance', 'Performance'], ['seo', 'SEO'], ['security', 'Security']].map(([v, l]) => h('option', { value: v }, l)));
  const catSel = h('select', { class: 'field', style: { width: 'auto', height: '38px' }, 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'));
  const tableBox = h('div');
  const load = async () => {
    tableBox.style.opacity = '0.5';
    const q = new URLSearchParams({ sort: sortSel.value, limit: '100' });
    if (catSel.value) q.set('category', catSel.value);
    const data = await api(`/api/v1/leaderboard?${q}`);
    if (catSel.options.length === 1) data.categories.forEach((c) => catSel.append(h('option', { value: c.category }, `${c.category} (${c.count})`)));
    tableBox.style.opacity = '1';
    tableBox.replaceChildren(data.sites.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Site'), h('th', null, 'Category'), h('th', { class: 'num' }, 'Rank'), h('th', { class: 'num' }, 'Overall'), h('th', { class: 'num' }, 'Perf'), h('th', { class: 'num' }, 'SEO'), h('th', { class: 'num' }, 'Security'), h('th', null, 'Hosting'))),
      h('tbody', null, data.sites.map((s, i) => h('tr', null,
        h('td', { class: 'num muted' }, String(i + 1)),
        h('td', null, h('a', { href: `#/site/${s.domain}`, style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, favicon(s.icon, s.domain), s.domain)),
        h('td', { class: 'small' }, s.category || '—'),
        h('td', { class: 'num' }, s.rank ? fmt(s.rank) : '—'),
        h('td', { class: 'num' }, h('b', null, String(s.scores.overall))),
        h('td', { class: 'num' }, String(s.scores.performance)),
        h('td', { class: 'num' }, String(s.scores.seo)),
        h('td', { class: 'num' }, String(s.scores.security)),
        h('td', { class: 'small muted' }, s.hosting || '—')))))) : h('div', { class: 'empty' }, 'No sites analyzed yet.'));
  };
  sortSel.addEventListener('change', load);
  catSel.addEventListener('change', load);
  body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'compare-form', style: { marginBottom: '12px' } }, sortSel, catSel), tableBox));
  load().catch((err) => tableBox.replaceChildren(h('div', { class: 'callout err' }, err.message)));
}

// ---- API docs ------------------------------------------------------------------

async function apiView() {
  const base = API_BASE || location.origin;
  const statusBox = h('div', { class: 'muted small' }, 'Loading…');
  const endpoints = h('div', null);
  const select = h('select', { 'aria-label': 'Endpoint' });
  const input = h('input', { value: 'github.com', 'aria-label': 'Domain or query', spellcheck: 'false' });
  const out = h('pre', { class: 'resp' }, 'Response will appear here.');
  const meta = h('div', { class: 'muted small' });
  const urlFor = () => {
    const tpl = select.value;
    const v = input.value.trim();
    return tpl.includes('{domain}') ? tpl.replace('{domain}', encodeURIComponent(cleanDomain(v)))
      : tpl === '/api/v1/compare' ? `${tpl}?domains=${encodeURIComponent(v)}` : tpl;
  };
  const run = async () => {
    const url = urlFor();
    out.textContent = 'Loading…';
    const t0 = performance.now();
    try {
      const res = await fetch(apiUrl(url));
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
      out.textContent = pretty.length > 200000 ? `${pretty.slice(0, 200000)}\n…` : pretty;
      meta.textContent = `HTTP ${res.status} · ${Math.round(performance.now() - t0)} ms · cache ${res.headers.get('x-cache') || '—'} · ${res.headers.get('x-ratelimit-remaining') ?? '?'} of ${res.headers.get('x-ratelimit-limit') ?? '?'} left this hour`;
    } catch (err) {
      out.textContent = err.message;
    }
  };
  select.addEventListener('change', () => {
    input.value = select.value === '/api/v1/compare' ? 'github.com,gitlab.com' : (select.value.includes('{domain}') ? 'github.com' : '');
    input.disabled = !select.value.includes('{domain}') && select.value !== '/api/v1/compare';
  });

  render(h('div', null,
    h('h1', { style: { fontSize: '28px', letterSpacing: '-0.02em' } }, 'SiteLens API'),
    h('p', { class: 'muted', style: { maxWidth: '720px' } }, 'A free JSON API for website intelligence. No sign-up and no key needed. Responses are cached for 6 hours, CORS is open, and the full OpenAPI 3.1 spec is at ',
      h('a', { href: apiUrl('/api/openapi.json') }, '/api/openapi.json'), '.'),
    h('div', { class: 'grid g-main section' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Endpoints')), endpoints),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Limits & status')), statusBox)),
    h('div', { class: 'section card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Try it')),
      h('form', { class: 'playground', onsubmit: (e) => { e.preventDefault(); run(); } },
        h('div', { class: 'row' }, select, input, h('button', { class: 'btn primary', type: 'submit', style: { height: '40px' } }, 'Send')),
        meta, out)),
    h('div', { class: 'section grid g3' },
      codeCard('cURL', `curl ${base}/api/v1/analyze/stripe.com \\\n  -H "X-API-Key: optional"`),
      codeCard('JavaScript', `const res = await fetch(\n  '${base}/api/v1/analyze/stripe.com'\n);\nconst report = await res.json();\nconsole.log(report.scores, report.traffic);`),
      codeCard('Python', `import requests\n\nr = requests.get(\n  "${base}/api/v1/compare",\n  params={"domains": "stripe.com,adyen.com"},\n)\nprint(r.json()["sites"])`))));

  if (!(await hasBackend())) {
    const msg = 'No API server is connected to this copy of SiteLens. Run the server (npm start) or set the SITELENS_API_URL repository variable, then redeploy.';
    endpoints.replaceChildren(h('p', { class: 'muted small', style: { margin: 0 } }, msg));
    statusBox.replaceChildren(h('dl', { class: 'kv' }, h('dt', null, 'Status'), h('dd', null, 'Lite mode (browser only)')));
    return;
  }
  try {
    const [spec, status] = await Promise.all([api('/api/openapi.json'), api('/api/v1/status')]);
    endpoints.replaceChildren(...Object.entries(spec.paths).map(([p, ops]) => {
      select.append(h('option', { value: p }, `GET ${p}`));
      return h('div', { class: 'endpoint' }, h('span', { class: 'method' }, 'GET'), h('code', null, p), h('span', { class: 'muted small', style: { flexBasis: '100%' } }, ops.get.summary));
    }));
    statusBox.replaceChildren(h('dl', { class: 'kv' },
      h('dt', null, 'Status'), h('dd', null, h('span', { class: 'yes' }, '● '), status.status),
      h('dt', null, 'Version'), h('dd', null, status.version),
      h('dt', null, 'Anonymous'), h('dd', null, `${status.limits.anon.analyses} analyses / hour`),
      h('dt', null, 'With API key'), h('dd', null, `${status.limits.key.analyses} analyses / hour`),
      h('dt', null, 'Indexed sites'), h('dd', null, fmt(status.indexedSites)),
      h('dt', null, 'Analyses run'), h('dd', null, fmt(status.analyses)),
      h('dt', null, 'Top-1M list'), h('dd', null, status.trancoList.loaded ? `${fmt(status.trancoList.domains)} domains` : 'Not loaded (API mode)')));
  } catch (err) {
    statusBox.textContent = err.message;
  }
}

function codeCard(title, code) {
  const pre = h('pre', null, code);
  const btn = h('button', { class: 'btn sm', type: 'button' }, 'Copy');
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); btn.textContent = 'Copied'; } catch { btn.textContent = 'Select & copy'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, title), btn), pre);
}

// ---- router ----------------------------------------------------------------------

let currentRoute = '';
function render(node) {
  hideTooltip();
  main.replaceChildren(node);
}

function route() {
  const hash = location.hash || '#/';
  if (!hash.startsWith('#/')) return; // in-page anchors (skip link, section nav)
  const [, view, arg = ''] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${view}`));
  document.title = 'SiteLens · Website intelligence';
  window.scrollTo(0, 0);
  const decoded = decodeURIComponent(arg);
  currentRoute = `${view}:${view === 'site' ? cleanDomain(decoded) : decoded}`;
  switch (view) {
    case 'site': return decoded ? siteView(cleanDomain(decoded)) : render(homeView());
    case 'compare': return compareView(decoded ? decoded.split(',') : []);
    case 'top': return topView(decoded || 'global');
    case 'api': return apiView();
    default: return render(homeView());
  }
}

document.getElementById('topsearch').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = e.target.elements.q;
  const d = cleanDomain(input.value);
  if (d) { location.hash = `#/site/${d}`; input.value = ''; input.blur(); }
});
document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('sitelens-theme', root.dataset.theme); } catch { /* ignore */ }
});
window.addEventListener('hashchange', route);
refreshSuggestions();
route();
