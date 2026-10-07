import { fetchUrl } from './fetcher.js';
import { extractPage, analyzeLinks } from './html.js';
import { detectTechnologies } from './tech.js';
import { dnsInfo } from './dnsinfo.js';
import { tlsInfo } from './tlsinfo.js';
import { securityAudit, seoAudit, performanceAudit } from './audits.js';
import { getRank, trafficEstimate } from './rank.js';
import { rdapInfo, waybackInfo, siteFiles } from './external.js';
import { classify, audienceSignals } from './classify.js';
import { normalizeDomain, registrableDomain, safe, withTimeout, HttpError } from './util.js';

import { WEBSITE_ONLY_DATA, WEBSITE_ONLY_NOTE } from '../public/shared/plans.js';

export const VERSION = '1.0.0';

async function fetchHomepage(host) {
  const bare = host.replace(/^www\./, '');
  const candidates = [`https://${host}/`];
  if (!host.startsWith('www.') && !host.includes(':')) candidates.push(`https://www.${bare}/`);
  candidates.push(`http://${host}/`);
  let lastErr;
  for (const url of candidates) {
    try {
      const res = await fetchUrl(url, { timeout: 15000 });
      if (res.status < 500 || url === candidates.at(-1)) return res;
      lastErr = new HttpError(502, `${url} returned HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (err.status === 403 && /private address/.test(err.message)) throw err;
    }
  }
  throw lastErr || new HttpError(502, `Could not reach ${host}`);
}

function topicWords(extract) {
  if (!extract) return [];
  const text = `${extract.title || ''} ${extract.meta.description || ''} ${extract.meta.keywords || ''} ${extract.headings.h1.join(' ')} ${extract.headings.h2.slice(0, 10).join(' ')}`.toLowerCase();
  const stop = new Set(['the', 'and', 'for', 'with', 'your', 'you', 'our', 'are', 'from', 'that', 'this', 'all', 'more', 'new', 'get', 'how', 'what', 'can', 'will', 'its', 'about', 'home', 'welcome', 'page', 'site', 'into', 'has', 'have', 'not', 'one', 'best', 'free']);
  const counts = {};
  for (const w of text.match(/\p{L}{3,}/gu) || []) if (!stop.has(w)) counts[w] = (counts[w] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
}

/** Runs every analyzer for one domain and assembles the report. */
/**
 * Strips data that comes from non-commercially licensed sources (rank and
 * traffic from Tranco, RDAP registration, Internet Archive history) so the
 * report can be returned to paid API callers.
 */
export function toApiReport(report) {
  if (!report || report.dataScope?.mode === 'api') return report;
  const { rank: _rank, traffic: _traffic, domainInfo: _domainInfo, similar, ...rest } = report;
  return {
    ...rest,
    similar: (similar || []).map(({ rank: _r, ...s }) => s),
    dataScope: API_SCOPE,
  };
}

const API_SCOPE = {
  mode: 'api',
  excluded: WEBSITE_ONLY_DATA.map((d) => d.id),
  note: WEBSITE_ONLY_NOTE,
};

export async function analyzeDomain(input, { index, api = false } = {}) {
  const started = Date.now();
  const allowPort = process.env.SITELENS_ALLOW_PRIVATE === '1';
  const host = normalizeDomain(input, { allowPort });
  const bareHost = host.replace(/:\d+$/, '');
  const domain = registrableDomain(bareHost);

  // Network-bound lookups that do not depend on the homepage start right away.
  const isLocal = bareHost === 'localhost' || /^[\d.]+$|:/.test(bareHost);
  const dnsP = isLocal ? Promise.resolve(null) : withTimeout(safe(() => dnsInfo(domain)), 12000, { error: 'DNS lookup timed out' });
  // API reports never fetch the non-commercially licensed sources.
  const rankP = api ? Promise.resolve(null) : withTimeout(safe(() => getRank(domain)), 15000, null);
  const rdapP = api ? Promise.resolve(null) : withTimeout(safe(() => rdapInfo(domain)), 12000, null);
  const waybackP = api ? Promise.resolve(null) : withTimeout(safe(() => waybackInfo(domain)), 12000, null);

  let page;
  try {
    page = await fetchHomepage(host);
  } catch (err) {
    page = { error: err.message, status: null, errorStatus: err.status || 502 };
  }

  let extract = null;
  let tech = { count: 0, list: [], byCategory: {} };
  let links = null;
  let finalHost = host;
  let origin = `https://${host}`;
  if (!page.error) {
    const final = new URL(page.finalUrl);
    finalHost = final.host;
    origin = final.origin;
    const isHtml = /html|xml/i.test(page.headers['content-type'] || 'text/html');
    if (isHtml) {
      extract = extractPage(page.body, page.finalUrl);
      const setCookie = [].concat(page.headers['set-cookie'] || []);
      tech = detectTechnologies({
        html: page.body,
        headers: page.headers,
        cookies: setCookie.map((c) => c.split('=')[0].trim()),
        scriptSrcs: extract.scripts.map((s) => s.src).filter(Boolean),
        meta: extract.meta,
      });
      links = analyzeLinks(extract.anchors, registrableDomain(final.hostname), registrableDomain);
    }
  }

  const tlsP = origin.startsWith('https://')
    ? withTimeout(safe(() => tlsInfo(finalHost.replace(/:\d+$/, ''), Number(finalHost.split(':')[1] || 443))), 10000, { error: 'TLS timed out' })
    : Promise.resolve(null);
  const filesP = page.error ? Promise.resolve(null) : withTimeout(safe(() => siteFiles(origin, bareHost)), 20000, null);

  const [dns, rank, rdap, wayback, tls, files] = await Promise.all([dnsP, rankP, rdapP, waybackP, tlsP, filesP]);
  if (page && !page.error && files) page.httpRedirectsToHttps = files.httpRedirectsToHttps;

  const security = securityAudit({ page: page.error ? null : page, tls, dns, files });
  const seo = seoAudit({ page: page.error ? null : page, extract, files });
  const performance = performanceAudit({ page: page.error ? null : page, extract, tls });
  const overall = page.error ? 0 : Math.round(performance.score * 0.35 + seo.score * 0.35 + security.score * 0.3);
  const category = classify(extract, tech);
  const traffic = trafficEstimate(rank && !rank.error ? rank : null);
  const audience = audienceSignals(bareHost, extract, dns && !dns.error ? dns : null);

  const report = {
    domain,
    host,
    url: page.error ? null : page.finalUrl,
    reachable: !page.error,
    error: page.error || null,
    errorStatus: page.error ? page.errorStatus : null,
    site: extract ? {
      title: extract.title,
      description: extract.meta.description || extract.meta['og:description'] || null,
      siteName: extract.meta['og:site_name'] || null,
      image: extract.meta['og:image'] ? safeAbs(extract.meta['og:image'], page.finalUrl) : null,
      icon: extract.icon || (origin ? `${origin}/favicon.ico` : null),
      lang: extract.lang,
      themeColor: extract.meta['theme-color'] || null,
      generator: extract.meta.generator || null,
      feeds: extract.feeds,
    } : null,
    category,
    topics: topicWords(extract),
    rank: rank && !rank.error ? rank : null,
    traffic,
    audience,
    scores: page.error
      ? { overall: 0, performance: 0, seo: 0, security: 0 }
      : { overall, performance: performance.score, seo: seo.score, security: security.score },
    performance,
    seo,
    security,
    tech,
    links,
    content: extract ? {
      wordCount: extract.wordCount,
      headings: Object.fromEntries(Object.entries(extract.headings).map(([k, v]) => [k, v.length])),
      h1: extract.headings.h1.slice(0, 3),
      images: extract.images.length,
      imagesMissingAlt: extract.images.filter((i) => !i.alt || !i.alt.trim()).length,
      scripts: extract.scripts.filter((s) => s.src).length,
      inlineScripts: extract.scripts.filter((s) => !s.src).length,
      stylesheets: extract.stylesheets.length,
      iframes: extract.iframes.length,
      forms: extract.forms,
      structuredData: extract.jsonLdTypes,
      hreflang: extract.hreflang.length,
    } : null,
    http: page.error ? null : {
      status: page.status,
      httpVersion: page.httpVersion,
      ip: page.ip,
      redirects: page.redirects,
      finalUrl: page.finalUrl,
      headers: page.headers,
      bytes: page.bytes,
      transferBytes: page.transferBytes,
      encoding: page.encoding,
      timings: page.timings,
    },
    tls: tls || null,
    dns: dns && !dns.error ? dns : null,
    domainInfo: { rdap: rdap && !rdap.error ? rdap : null, wayback: wayback && !wayback.error ? wayback : null },
    files: files && !files.error ? files : null,
    similar: [],
    meta: { analyzedAt: new Date().toISOString(), durationMs: Date.now() - started, version: VERSION },
  };

  if (api) return toApiReport(report);
  if (index && report.reachable) {
    const summary = summarize(report);
    report.similar = index.similar(summary);
    index.upsert(summary);
  }
  return report;
}

function safeAbs(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

export function summarize(report) {
  return {
    domain: report.domain,
    title: report.site?.title || null,
    description: report.site?.description?.slice(0, 200) || null,
    icon: report.site?.icon || null,
    category: report.category?.primary || null,
    topics: report.topics,
    rank: report.rank?.rank ?? null,
    monthlyVisits: report.traffic?.monthlyVisits ?? null,
    scores: report.scores,
    tech: report.tech.list.map((t) => t.name),
    outbound: (report.links?.topOutbound || []).map((o) => o.domain),
    hosting: report.dns?.providers?.hosting || null,
    analyzedAt: report.meta.analyzedAt,
  };
}
