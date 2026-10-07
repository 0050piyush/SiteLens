// Server-side rendering for search engines and AI crawlers.
//
// Every page is served as real HTML: its own title, description, canonical
// URL, social tags, JSON-LD structured data and the readable page content.
// The browser app then takes over and re-renders the same view. The Node
// server renders on request; scripts/build-static.js writes the same pages
// out as files for static hosting (GitHub Pages).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom, toHtml, escAttr, escText } from './ssr-dom.js';

installDom();

const { h, setRoot } = await import('../public/dom.js');
const { parsePath } = await import('../public/shared/routes.js');
const { seoFor, POPULAR_DOMAINS, relatedDomains, SITE_NAME, TAGLINE } = await import('../public/shared/seo.js');
const { PLANS, FREE_DAILY_REPORTS, API_DATA, WEBSITE_ONLY_NOTE } = await import('../public/shared/plans.js');
const pages = await import('../public/pages.js');
const home = await import('../public/home-content.js');

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const REPO_URL = 'https://github.com/0050piyush/SiteLens';
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// Local files referenced by index.html that get a cache-busting ?v= on static builds.
const VERSIONED = /^(styles\.css|theme\.js|app\.js|favicon\.svg|apple-touch-icon\.png|site\.webmanifest|og-image\.png)$/;

const nf = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plans = () => Object.values(PLANS);

// Views that exist only when an API server is available.
const SERVER_VIEWS = new Set(['rankings', 'api-docs', 'login', 'account', 'forgot', 'reset', 'verify']);
// Views listed in the sitemap, in order.
const SITEMAP_VIEWS = ['', 'compare', 'pricing', 'rankings', 'api-docs', 'methodology', 'about', 'faq', 'contact', 'privacy', 'terms', 'sitemap'];
const SHORT_NAMES = {
  compare: 'Compare websites', pricing: 'Pricing', rankings: 'Rankings', 'api-docs': 'API', methodology: 'Methodology', about: 'About',
  faq: 'FAQ', contact: 'Contact', privacy: 'Privacy policy', terms: 'Terms of Service', sitemap: 'Sitemap',
  login: 'Log in', account: 'Account', forgot: 'Forgot password', reset: 'Reset password', verify: 'Confirm email',
};

export const isDomain = (d) => DOMAIN_RE.test(d);
const withSlash = (u) => (u.endsWith('/') ? u : `${u}/`);
const contactHref = (contact, subject) => {
  if (!contact) return null;
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(contact)) return `mailto:${contact}?subject=${encodeURIComponent(subject)}`;
  return /^https:\/\//.test(contact) ? contact : null;
};

// ---- page content ----------------------------------------------------------------

const article = (title, lead, ...body) => h('article', { class: 'page' },
  h('header', { class: 'page-head' }, h('h1', null, title), lead ? h('p', { class: 'lead muted' }, lead) : null), body);

function homeContent() {
  return h('div', null,
    h('section', { class: 'hero' },
      h('h1', null, 'See ', h('span', { class: 'hl' }, 'any website'), ' clearly.'),
      h('p', { class: 'lead' }, home.HOME_LEAD),
      home.plainSearchForm(),
      home.exampleChips()),
    home.featuresSection(),
    home.whatIsSection(),
    home.comparisonSection(),
    home.popularSection());
}

function compareContent() {
  const ideas = [['github.com', 'gitlab.com', 'bitbucket.org'], ['nytimes.com', 'theguardian.com', 'bbc.com'], ['stripe.com', 'paypal.com', 'adyen.com'],
    ['netflix.com', 'youtube.com', 'twitch.tv'], ['amazon.com', 'ebay.com', 'walmart.com'], ['notion.so', 'slack.com', 'figma.com']];
  return article('Compare websites side by side', 'Put up to five websites next to each other: estimated traffic, global rank, tech stack, SEO, performance and security.',
    h('section', { class: 'page-section' }, h('h2', null, 'What you can compare'),
      h('ul', null,
        h('li', null, 'Estimated monthly visits with ranges, and global rank with 30-day history.'),
        h('li', null, 'Technology stacks: which CMS, frameworks, analytics and payment tools each site uses, and what they share.'),
        h('li', null, 'Performance, SEO and security scores, check by check.'),
        h('li', null, 'Hosting, CDN, email provider and domain age.'))),
    h('section', { class: 'page-section' }, h('h2', null, 'Popular comparisons'),
      h('div', { class: 'chips' }, ideas.map((g) => h('a', { class: 'chip', href: `#/compare/${g.join(',')}` }, g.join(' vs '))))));
}

function pricingContent() {
  const card = (title, price, blurb, items) => h('div', { class: 'card plan' },
    h('h2', null, title), h('p', { class: 'plan-price' }, price), h('p', { class: 'muted small' }, blurb), h('ul', null, items.map((i) => h('li', null, i))));
  return article('Pricing', `The Webvieu website is free. API access for your own apps starts at $${plans()[0].price} a month, with no sales call and no annual contract.`,
    h('div', { class: 'grid g2' },
      card('Free website', '$0', 'Use Webvieu in your browser.', [
        `${FREE_DAILY_REPORTS} full reports a day, no account needed`,
        'Global rank, traffic estimates and domain history',
        'Tech stack, SEO, performance and security audits',
        'Compare up to 5 sites side by side',
        'Export reports as JSON or CSV',
      ]),
      plans().map((p) => card(`${p.name} API`, `$${p.price}/month`, p.blurb, [
        `${nf.format(p.monthly)} analyses a month (${nf.format(p.hourly)} an hour)`,
        `Bulk jobs of up to ${nf.format(p.bulkMax)} domains`,
        `Monitor up to ${p.monitors} sites with webhook alerts`,
        ...API_DATA,
      ]))),
    h('p', { class: 'muted small' }, WEBSITE_ONLY_NOTE),
    h('p', null, 'Questions about plans? ', h('a', { href: '#/faq' }, 'Read the FAQ'), ' or ', h('a', { href: '#/contact' }, 'contact us'), '.'));
}

function apiContent() {
  return article('Webvieu API', `A JSON API for website intelligence. Plans start at $${plans()[0].price}/month; send your key in the X-API-Key header.`,
    h('section', { class: 'page-section' }, h('h2', null, 'Endpoints'),
      h('ul', null,
        h('li', null, h('code', null, 'GET /api/v1/analyze?domain=example.com'), ': full analysis of one site.'),
        h('li', null, h('code', null, 'GET /api/v1/compare?domains=a.com,b.com'), ': up to five sites at once.'),
        h('li', null, h('code', null, 'POST /api/v1/bulk'), ': analyze a list of domains as a job, with JSON or CSV results.'),
        h('li', null, h('code', null, 'POST /api/v1/monitors'), ': re-check a site daily or weekly and get signed webhooks on changes.'))),
    h('section', { class: 'page-section' }, h('h2', null, 'What responses include'), h('ul', null, API_DATA.map((d) => h('li', null, d)))),
    h('p', null, 'The full OpenAPI 3.1 specification is at ', h('a', { href: '/api/openapi.json' }, '/api/openapi.json'), '.'));
}

function rankingsContent(index) {
  const sites = index ? index.leaderboard({ limit: 50 }) : [];
  return article('Top websites', 'The most visited sites analyzed on Webvieu, ordered by global rank.',
    sites.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'vs-table' },
        h('thead', null, h('tr', null, h('th', null, 'Rank'), h('th', null, 'Website'), h('th', null, 'Category'), h('th', null, 'Score'))),
        h('tbody', null, sites.map((s) => h('tr', null,
          h('td', null, s.rank ? `#${nf.format(s.rank)}` : '—'), h('td', null, h('a', { href: `#/site/${s.domain}` }, s.domain)),
          h('td', null, s.category || '—'), h('td', null, s.scores ? String(s.scores.overall) : '—'))))))
      : h('p', null, 'No sites have been analyzed yet.'));
}

const qa = (q, a) => h('div', { class: 'qa' }, h('h3', null, q), h('p', null, a));

function siteContent(domain, summary) {
  const facts = [];
  if (summary) {
    if (summary.rank) facts.push(['Global rank', `#${nf.format(summary.rank)} (Tranco)`]);
    if (summary.monthlyVisits) facts.push(['Estimated monthly visits', `≈ ${compact.format(summary.monthlyVisits)} (modelled from rank)`]);
    if (summary.category) facts.push(['Category', summary.category]);
    if (summary.scores) facts.push(['Scores', `Overall ${summary.scores.overall}/100 · Performance ${summary.scores.performance} · SEO ${summary.scores.seo} · Security ${summary.scores.security}`]);
    if (summary.hosting) facts.push(['Hosting', summary.hosting]);
    if (summary.tech?.length) facts.push(['Technologies', summary.tech.slice(0, 20).join(', ')]);
    if (summary.analyzedAt) facts.push(['Last analyzed', new Date(summary.analyzedAt).toISOString().slice(0, 10)]);
  }
  const related = relatedDomains(domain);
  return article(`${domain} traffic, rank & tech stack`,
    `A free website report for ${domain}: estimated monthly visits, global rank, technology stack, SEO, performance and security scores, hosting, DNS and domain history.`,
    summary?.title || summary?.description ? h('p', null, summary.title ? h('b', null, summary.title) : null, summary.title && summary.description ? ': ' : null, summary.description || null) : null,
    facts.length ? h('section', { class: 'page-section' }, h('h2', null, `${domain} at a glance`),
      h('dl', { class: 'facts-list' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))) : null,
    h('section', { class: 'page-section' }, h('h2', null, 'What this report shows'),
      h('ul', null,
        h('li', null, h('b', null, 'Traffic & rank: '), `${domain}’s global Tranco rank, 30-day rank history and estimated monthly visits with a low–high range.`),
        h('li', null, h('b', null, 'Technology stack: '), `the CMS, frameworks, analytics, advertising, CDN and payment technologies ${domain} uses.`),
        h('li', null, h('b', null, 'Health scores: '), 'performance timings and SEO and security audits, with every check explained.'),
        h('li', null, h('b', null, 'Infrastructure: '), 'hosting provider, DNS, email provider, TLS certificate and domain registration history.'))),
    h('p', null, 'The full report is generated live in your browser. ', h('a', { href: '#/methodology' }, 'How the numbers are calculated →')),
    h('section', { class: 'page-section' }, h('h2', null, `Questions about ${domain}`),
      qa(`How much traffic does ${domain} get?`, summary?.monthlyVisits
        ? `Webvieu estimates about ${compact.format(summary.monthlyVisits)} visits a month for ${domain}, modelled from its global rank of #${nf.format(summary.rank)}. The report shows the full range and a confidence level.`
        : `The report estimates ${domain}’s monthly visits from its global Tranco rank and shows a low–high range with a confidence level. Sites outside the top 1 million are shown as “< 10K” instead of a made-up number.`),
      qa(`What technology is ${domain} built with?`, summary?.tech?.length
        ? `Webvieu detected ${summary.tech.slice(0, 8).join(', ')}${summary.tech.length > 8 ? ` and ${summary.tech.length - 8} more` : ''} on ${domain}.`
        : `The report lists the technologies Webvieu detects on ${domain}’s homepage, from its CMS and frameworks to analytics, advertising, CDN and payment tools, out of 180+ known fingerprints.`),
      qa(`Is ${domain} secure and fast?`, summary?.scores
        ? `${domain} scored ${summary.scores.security}/100 for security and ${summary.scores.performance}/100 for performance in its last Webvieu check. The report lists every check behind those scores.`
        : `The report grades ${domain}’s security (HTTPS, certificate, security headers, email protection) and performance (server response time, compression, HTTP/2, page weight) from 0 to 100, with every check explained.`)),
    h('section', { class: 'page-section' }, h('h2', null, 'Related reports'),
      h('div', { class: 'chips' }, related.map((d) => h('a', { class: 'chip', href: `#/site/${d}` }, d))),
      h('p', null, h('a', { href: `#/compare/${domain},${related[0]}` }, `Compare ${domain} with ${related[0]} →`))));
}

async function contentFor(view, arg, ctx, opts) {
  const pageCtx = {
    render: (node) => { ctx.node = node; },
    api: async () => { throw new Error('offline'); },
    hasBackend: async () => opts.backend,
    contactHref,
    fmt: (n) => (n == null ? '—' : nf.format(n)),
    CONTACT: opts.contact || '',
  };
  switch (view) {
    case '': return homeContent();
    case 'compare': return compareContent();
    case 'pricing': return pricingContent();
    case 'rankings': return rankingsContent(opts.index);
    case 'api-docs': return apiContent();
    case 'site': return siteContent(arg, opts.summary);
    case 'about': pages.aboutView(pageCtx); return ctx.node;
    case 'methodology': pages.methodologyView(pageCtx); return ctx.node;
    case 'faq': pages.faqView(pageCtx); return ctx.node;
    case 'contact': await pages.contactView(pageCtx, new URLSearchParams()); return ctx.node;
    case 'privacy': pages.privacyView(pageCtx); return ctx.node;
    case 'terms': pages.termsView(pageCtx); return ctx.node;
    case 'sitemap': await pages.sitemapView(pageCtx); return ctx.node;
    default: return article(SHORT_NAMES[view] || 'Page not found', view in SHORT_NAMES ? 'This page needs JavaScript.' : 'This page doesn’t exist.',
      h('p', null, h('a', { href: '#/' }, '← Back home')));
  }
}

// ---- structured data -----------------------------------------------------------------

function structuredData(view, arg, meta, siteUrl, url) {
  const org = { '@type': 'Organization', '@id': `${siteUrl}#organization`, name: SITE_NAME, url: siteUrl, logo: `${siteUrl}icon-512.png`, sameAs: [REPO_URL] };
  const website = {
    '@type': 'WebSite', '@id': `${siteUrl}#website`, name: SITE_NAME, alternateName: `${SITE_NAME}: ${TAGLINE}`, url: siteUrl, inLanguage: 'en',
    publisher: { '@id': org['@id'] },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}site/{domain}/` }, 'query-input': 'required name=domain' },
  };
  const app = {
    '@type': 'WebApplication', '@id': `${siteUrl}#app`, name: SITE_NAME, url: siteUrl, applicationCategory: 'BusinessApplication', operatingSystem: 'Any (web browser)',
    description: seoFor('').description, publisher: { '@id': org['@id'] },
    offers: [
      { '@type': 'Offer', name: 'Free website', price: '0', priceCurrency: 'USD' },
      ...plans().map((p) => ({
        '@type': 'Offer', name: `${p.name} API plan`, price: String(p.price), priceCurrency: 'USD', url: `${siteUrl}pricing/`,
        priceSpecification: { '@type': 'UnitPriceSpecification', price: String(p.price), priceCurrency: 'USD', unitCode: 'MON', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' } },
      })),
    ],
  };
  const pageType = { about: 'AboutPage', contact: 'ContactPage', faq: 'FAQPage', sitemap: 'CollectionPage', rankings: 'CollectionPage' }[view] || 'WebPage';
  const webpage = { '@type': pageType, '@id': `${url}#webpage`, url, name: meta.title, description: meta.description, isPartOf: { '@id': website['@id'] }, inLanguage: 'en' };
  const graph = [];
  if (view === '') {
    graph.push(org, website, app, { ...webpage, about: { '@id': app['@id'] } });
  } else {
    const crumbs = [{ name: 'Home', url: siteUrl }, { name: view === 'site' ? arg : SHORT_NAMES[view] || meta.title, url }];
    webpage.breadcrumb = { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) };
    if (view === 'faq') {
      webpage.mainEntity = pages.faqItems().flatMap(([, items]) => items).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }));
    }
    if (view === 'site') webpage.about = { '@type': 'WebSite', name: arg, url: `https://${arg}/` };
    if (view === 'pricing') webpage.mainEntity = { '@id': app['@id'] };
    graph.push(webpage);
    if (view === 'pricing') graph.push(app);
    if (view === 'about' || view === 'contact') graph.push(org);
    if (view === 'methodology') {
      graph.push({
        '@type': 'TechArticle', headline: 'How Webvieu works: methodology', url, description: meta.description, inLanguage: 'en',
        author: { '@id': org['@id'] }, publisher: { '@id': org['@id'] }, mainEntityOfPage: { '@id': webpage['@id'] },
      }, org);
    }
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ---- HTML assembly -----------------------------------------------------------------

let template = null;
const loadTemplate = () => (template ??= fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'));
/** Lets the build script pick up a template changed after import (tests, CI). */
export const reloadTemplate = () => { template = null; };

function headTags(meta, url, data, opts) {
  const tags = [
    `<title>${escText(meta.title)}</title>`,
    `<meta name="description" content="${escAttr(meta.description)}">`,
    `<meta name="robots" content="${escAttr(meta.robots)}">`,
    meta.notFound ? null : `<link rel="canonical" href="${escAttr(url)}">`,
    `<meta property="og:title" content="${escAttr(meta.title)}">`,
    `<meta property="og:description" content="${escAttr(meta.description)}">`,
    `<meta property="og:url" content="${escAttr(url)}">`,
    opts.google ? `<meta name="google-site-verification" content="${escAttr(opts.google)}">` : null,
    opts.bing ? `<meta name="msvalidate.01" content="${escAttr(opts.bing)}">` : null,
    data ? `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>` : null,
  ];
  return tags.filter(Boolean).map((t) => `  ${t}`).join('\n');
}

function assemble({ meta, url, data, mainHtml, opts }) {
  const { root, siteUrl, version, backend } = opts;
  let html = loadTemplate();
  html = html.replace(/ *<!-- seo:start[\s\S]*?<!-- seo:end -->/, headTags(meta, url, data, opts));
  html = html.replace('<meta property="og:image" content="og-image.png">', `<meta property="og:image" content="${escAttr(`${siteUrl}og-image.png${version ? `?v=${version}` : ''}`)}">`);
  // Relative links and assets in the template point at the site root.
  html = html.replace(/\b(href|src)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]*)"/gi, (_, attr, rel) => {
    const file = rel === './' ? '' : rel;
    return `${attr}="${root}${file}${version && VERSIONED.test(file) ? `?v=${version}` : ''}"`;
  });
  if (!backend) html = html.replace(/ data-needs-server/g, ' data-needs-server hidden');
  return html.replace('<main id="main" class="wrap" tabindex="-1"></main>', `<main id="main" class="wrap" tabindex="-1">${mainHtml}</main>`);
}

/**
 * Renders the page at `rel` (path relative to the site root, e.g. "site/github.com/").
 * opts: { siteUrl, backend, index?, contact?, version?, google?, bing? }
 * Returns { status, html } or { redirect } (to the trailing-slash URL).
 */
export async function renderPage(rel, opts) {
  const siteUrl = withSlash(opts.siteUrl);
  const root = new URL(siteUrl).pathname;
  const o = { ...opts, siteUrl, root, google: opts.google ?? process.env.SITELENS_GOOGLE_VERIFICATION, bing: opts.bing ?? process.env.SITELENS_BING_VERIFICATION };
  setRoot(root);

  const [pathPart] = rel.split('?');
  let parsed = parsePath(pathPart);
  let arg = '';
  if (parsed) {
    try { arg = decodeURIComponent(parsed.arg); } catch { parsed = null; }
  }
  if (parsed && pathPart && !pathPart.endsWith('/')) return { redirect: `${root}${pathPart}/` };
  if (parsed?.view === 'site') {
    arg = arg.toLowerCase();
    if (!arg || !isDomain(arg)) parsed = null;
  }
  if (parsed && SERVER_VIEWS.has(parsed.view) && !o.backend) parsed = null;

  const view = parsed ? parsed.view : null;
  const summary = view === 'site' ? o.index?.get(arg) || null : null;
  const meta = view === null ? seoFor('__missing__') : seoFor(view, arg, { indexed: !!summary });
  const url = `${siteUrl}${view ? `${view}/${parsed.arg ? `${parsed.arg}/` : ''}` : ''}`;
  const ctx = {};
  const node = await contentFor(view, arg, ctx, { ...o, summary });
  const data = view === null || meta.robots.startsWith('noindex') ? null : structuredData(view, arg, meta, siteUrl, url);
  return { status: view === null ? 404 : 200, html: assemble({ meta, url, data, mainHtml: toHtml(node), opts: o }) };
}

/** The app shell with no content, for static hosts' 404 page (the app renders the route). */
export function renderShell(opts) {
  const siteUrl = withSlash(opts.siteUrl);
  const o = { ...opts, siteUrl, root: new URL(siteUrl).pathname };
  const meta = { title: `${SITE_NAME} · ${TAGLINE}`, description: seoFor('').description, robots: 'noindex,follow', notFound: true };
  return assemble({ meta, url: siteUrl, data: null, mainHtml: '', opts: o });
}

/** URLs to list in sitemap.xml: [{ path, lastmod? }] relative to the site root. */
export function sitemapEntries({ backend, index }) {
  const out = SITEMAP_VIEWS.filter((v) => backend || !SERVER_VIEWS.has(v)).map((v) => ({ path: v ? `${v}/` : '' }));
  const seen = new Set();
  for (const d of POPULAR_DOMAINS) {
    seen.add(d);
    const s = index?.get(d);
    out.push({ path: `site/${d}/`, lastmod: s?.analyzedAt?.slice(0, 10) });
  }
  if (index) {
    for (const s of index.leaderboard({ limit: 5000 })) {
      if (seen.has(s.domain) || !isDomain(s.domain)) continue;
      out.push({ path: `site/${s.domain}/`, lastmod: s.analyzedAt?.slice(0, 10) });
    }
  }
  return out;
}

export function renderSitemap({ siteUrl, backend, index }) {
  const base = withSlash(siteUrl);
  const urls = sitemapEntries({ backend, index }).map((e) => `  <url><loc>${escText(base + e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// Search and AI crawlers we welcome by name (all others are allowed too).
const CRAWLERS = ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Applebot', 'Applebot-Extended', 'Google-Extended', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Meta-ExternalAgent', 'Amazonbot', 'CCBot', '*'];

export function renderRobots({ siteUrl, backend }) {
  const base = withSlash(siteUrl);
  const root = new URL(base).pathname;
  const rules = [`Allow: ${root}`];
  if (backend) rules.push(`Disallow: ${root}api/v1/`, `Disallow: ${root}account/`);
  return `# Webvieu welcomes search engines and AI assistants.\n${CRAWLERS.map((c) => `User-agent: ${c}`).join('\n')}\n${rules.join('\n')}\n\nSitemap: ${base}sitemap.xml\n`;
}

/** llms.txt: a plain-language guide to the site for AI assistants (https://llmstxt.org). */
export function renderLlms({ siteUrl, backend }) {
  const base = withSlash(siteUrl);
  const [starter] = plans();
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_NAME} is a free website analysis tool. Enter any domain to see its estimated monthly traffic, global rank, technology stack, SEO, performance and security scores, hosting, DNS and domain history in one report. Developers can use ${SITE_NAME}'s own live analysis through a paid API from $${starter.price}/month.`,
    '',
    '## Key facts',
    '',
    `- The website is free: ${FREE_DAILY_REPORTS} full reports a day per visitor, no account needed. Up to five sites can be compared side by side.`,
    '- Global rank comes from the Tranco research list (top 1 million sites, averaged over 30 days).',
    '- Monthly visits are estimated from rank with a published model: visits ≈ 8.5 × 10^10 × rank^-1.15, shown with a 0.5×–1.8× range and a confidence level (medium for the top 10,000, low to rank 200,000, very low beyond). Sites outside the top 1 million show "< 10K" rather than a made-up number.',
    '- Technology detection covers 180+ technologies (CMS, frameworks, analytics, ad pixels, CDNs, payments, consent tools, hosting).',
    '- The overall score is 35% performance, 35% SEO and 30% security; each audit is the weighted share of checks passed.',
    `- API plans: ${plans().map((p) => `${p.name} $${p.price}/month (${nf.format(p.monthly)} analyses)`).join(', ')}. API plans include tech stack, audits, DNS, hosting, email and TLS data; rank, traffic estimates and domain history are on the free website only.`,
    `- ${SITE_NAME} does not use clickstream panels, so it does not report traffic sources, referrals, keywords or demographics.`,
    `- ${SITE_NAME} is independent and not affiliated with Similarweb or other analytics companies.`,
    '',
    '## Main pages',
    '',
    `- [Home](${base}): analyze any website`,
    `- [Methodology](${base}methodology/): how rank, traffic estimates and scores are calculated`,
    `- [Pricing](${base}pricing/): free website and API plans`,
    `- [Compare websites](${base}compare/): up to five sites side by side`,
    `- [FAQ](${base}faq/): answers about reports, data, plans and privacy`,
    `- [About](${base}about/): why ${SITE_NAME} exists and where the data comes from`,
    backend ? `- [API documentation](${base}api-docs/): endpoints, limits and examples` : null,
    backend ? `- [Rankings](${base}rankings/): top websites analyzed on ${SITE_NAME}` : null,
    `- [Contact](${base}contact/)`,
    '',
    '## Example reports',
    '',
    ...POPULAR_DOMAINS.slice(0, 20).map((d) => `- [${d} traffic, rank & tech stack](${base}site/${d}/)`),
    '',
    '## FAQ',
    '',
    ...pages.faqItems().flatMap(([, items]) => items).flatMap(([q, a]) => [`### ${q}`, '', a, '']),
  ];
  return `${lines.filter((l) => l !== null).join('\n').trim()}\n`;
}
