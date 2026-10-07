// Home page sections shared by the app and the prerenderer, so search
// engines and AI crawlers read the same content people see.

import { h, siteRoot } from './dom.js';
import { PLANS, FREE_DAILY_REPORTS } from './shared/plans.js';
import { POPULAR_DOMAINS } from './shared/seo.js';

const FEATURES = [
  ['M3 17l5-5 4 4 8-8', 'Traffic & rank', 'Global rank from the Tranco research list, 30-day rank history and a transparent traffic model with ranges, not fake precision.'],
  ['M4 6h16M4 12h16M4 18h10', 'Technology stack', '180+ fingerprints: CMS, frameworks, analytics, ad pixels, CDNs, payments, consent tools, hosting and more.'],
  ['M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z', 'Security grade', 'TLS certificate, HSTS, CSP and other headers, SPF/DMARC email security, CAA and security.txt.'],
  ['M5 12h4l2-6 2 12 2-6h4', 'Performance', 'Real server timings (DNS, connect, TLS, TTFB), compression, HTTP/2, page weight and render-blocking scripts.'],
  ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', 'SEO audit', '20 on-page checks plus robots.txt, sitemaps, structured data, hreflang and which AI crawlers are blocked.'],
  ['M4 7h16v10H4zM8 11h8', 'Business signals', 'Email provider, SaaS tools verified on the domain (via DNS), email senders, ad sellers, socials and domain age.'],
];

export const HOME_LEAD = 'Free website traffic checker: estimated visits, global rank, tech stack, SEO, performance and security for any domain. No sign-up.';
export const EXAMPLES = ['github.com', 'wikipedia.org', 'stripe.com', 'nytimes.com', 'shopify.com', 'vercel.com'];

export function cell(v) {
  if (v === true) return h('td', { class: 'yes' }, '✓ Yes');
  if (v === false) return h('td', { class: 'no' }, '—');
  return h('td', null, v);
}

export function svgIcon(d) {
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

/** A search box that also works without JavaScript (GET ?q=domain). */
export function plainSearchForm() {
  return h('form', { class: 'bigsearch', role: 'search', action: siteRoot(), method: 'get' },
    h('input', { name: 'q', type: 'text', placeholder: 'Enter any website, e.g. stripe.com', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Website to analyze' }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Analyze'));
}

export const exampleChips = () => h('div', { class: 'chips examples' },
  h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Try:'),
  EXAMPLES.map((d) => h('a', { class: 'chip', href: `#/site/${d}` }, d)));

export const featuresSection = () => h('section', { class: 'section grid g3 features' },
  FEATURES.map(([d, t, p]) => h('div', { class: 'card feature' },
    h('div', { class: 'ico' }, svgIcon(d)), h('h3', null, t), h('p', null, p))));

/** A short, quotable answer to "what is Webvieu?" for people, search engines and AI assistants. */
export function whatIsSection() {
  const from = Math.min(...Object.values(PLANS).map((p) => p.price));
  return h('section', { class: 'section card what-is' },
    h('h2', null, 'What is Webvieu?'),
    h('p', null, 'Webvieu is a free website analysis tool. Enter any domain and it shows the site’s estimated monthly traffic, global rank, technology stack, SEO, performance and security scores, hosting, DNS and domain history in one report, checked live in about 10–15 seconds.'),
    h('ul', { class: 'facts' },
      h('li', null, h('b', null, 'Traffic estimates with ranges. '), 'Monthly visits are modelled from the site’s Tranco rank and shown with a low–high range and a confidence level. ', h('a', { href: '#/methodology' }, 'See the methodology →')),
      h('li', null, h('b', null, '180+ technologies detected, '), 'from CMS and frameworks to analytics, ad pixels, CDNs and payment providers.'),
      h('li', null, h('b', null, 'Free to use. '), `${FREE_DAILY_REPORTS} full reports a day without an account, and up to five sites compared side by side.`),
      h('li', null, h('b', null, 'API for developers. '), `Webvieu’s own live analysis as JSON, from $${from}/month. `, h('a', { href: '#/pricing' }, 'See pricing →')),
      h('li', null, h('b', null, 'Honest about limits. '), 'Webvieu doesn’t use clickstream panels, so it doesn’t claim traffic sources or visitor demographics.')));
}

export const comparisonSection = () => h('section', { class: 'section card' },
  h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'How Webvieu compares'),
    h('p', { class: 'muted small' }, 'An honest comparison with typical paid traffic-intelligence tools.'))),
  h('div', { class: 'table-wrap' }, h('table', { class: 'vs-table' },
    h('thead', null, h('tr', null, h('th', null, 'Feature'), h('th', null, 'Webvieu'), h('th', null, 'Typical paid tools'))),
    h('tbody', null, [
      ['Full report without an account', true, 'Limited preview'],
      ['REST API for your own apps', 'From $15/month', 'Sales-only, annual contracts'],
      ['Technology stack detection', true, 'Separate product / add-on'],
      ['Security, SEO and performance audits', true, false],
      ['SaaS tools & email providers (DNS)', true, false],
      ['Compare up to 5 sites', true, 'Paid'],
      ['Methodology published', true, false],
      ['Clickstream traffic sources & demographics', false, true],
    ].map(([f, a, b]) => h('tr', null, h('td', null, f), cell(a), cell(b)))))));

export const popularSection = () => h('section', { class: 'section' },
  h('h2', null, 'Popular website reports'),
  h('p', { class: 'muted small' }, 'Traffic estimates, rank and tech stack for some of the most visited sites on the web.'),
  h('div', { class: 'chips popular-reports' }, POPULAR_DOMAINS.map((d) => h('a', { class: 'chip', href: `#/site/${d}` }, d))));
