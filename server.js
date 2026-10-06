import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDomain, summarize, VERSION } from './src/analyze.js';
import { Cache, SiteIndex } from './src/store.js';
import { normalizeDomain, registrableDomain, HttpError } from './src/util.js';
import { getRank, trafficEstimate, loadLocalList, downloadList, localListStatus, topSites } from './src/rank.js';
import { openapi } from './src/openapi.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const cache = new Cache({ max: 500, ttlMs: Number(process.env.SITELENS_CACHE_HOURS || 6) * 3600 * 1000 });
const index = new SiteIndex();
const inflight = new Map();
const startedAt = Date.now();
const stats = { analyses: 0, cacheHits: 0, requests: 0 };

// API keys are optional: without SITELENS_API_KEYS the API is open with the
// anonymous rate limit. With keys configured, keyed callers get a higher limit.
const API_KEYS = new Set((process.env.SITELENS_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean));
const LIMITS = {
  anon: { analyses: Number(process.env.SITELENS_ANON_PER_HOUR || 60), requests: 600 },
  key: { analyses: Number(process.env.SITELENS_KEY_PER_HOUR || 1000), requests: 10000 },
};
const buckets = new Map();

function rateLimit(req, kind) {
  const key = apiKeyOf(req);
  const tier = key && API_KEYS.has(key) ? 'key' : 'anon';
  const id = tier === 'key' ? `k:${key}` : `ip:${clientIp(req)}`;
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || now > b.reset) b = { reset: now + 3600_000, analyses: 0, requests: 0 };
  b[kind]++;
  buckets.set(id, b);
  const limit = LIMITS[tier][kind];
  return { ok: b[kind] <= limit, limit, remaining: Math.max(0, limit - b[kind]), reset: Math.ceil(b.reset / 1000), tier };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 600_000).unref();

const apiKeyOf = (req) => req.headers['x-api-key'] || new URL(req.url, 'http://x').searchParams.get('api_key') || null;
const clientIp = (req) => (process.env.SITELENS_TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;

async function getReport(input, { fresh = false } = {}) {
  const allowPort = process.env.SITELENS_ALLOW_PRIVATE === '1';
  const host = normalizeDomain(input, { allowPort });
  const key = registrableDomain(host.replace(/:\d+$/, '')) + (host.includes(':') ? host.slice(host.indexOf(':')) : '');
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) { stats.cacheHits++; return { report: hit, cached: true }; }
  }
  if (inflight.has(key)) return { report: await inflight.get(key), cached: false };
  const p = analyzeDomain(host, { index })
    .then((r) => { if (r.reachable) cache.set(key, r); stats.analyses++; return r; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return { report: await p, cached: false };
}

// ---- helpers ---------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body, null, process.env.NODE_ENV === 'production' ? 0 : 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(json);
}

function sendCsv(res, filename, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` });
  res.end(csv);
}

function reportToCsvRows(reports) {
  const rows = [['domain', 'title', 'category', 'tranco_rank', 'est_monthly_visits', 'overall', 'performance', 'seo', 'security',
    'ttfb_ms', 'html_kb', 'tech_count', 'technologies', 'hosting', 'email_provider', 'dns_provider', 'tls_issuer', 'cert_days_left',
    'domain_created', 'registrar', 'first_archived', 'analyzed_at']];
  for (const r of reports) {
    rows.push([r.domain, r.site?.title, r.category?.primary, r.rank?.rank, r.traffic?.monthlyVisits, r.scores.overall, r.scores.performance,
      r.scores.seo, r.scores.security, r.performance?.metrics?.ttfb, r.performance?.metrics?.htmlKb, r.tech.count,
      r.tech.list.map((t) => t.name).join('; '), r.dns?.providers?.hosting, r.dns?.providers?.email?.join('; '),
      r.dns?.providers?.dns?.join('; '), r.tls?.issuer, r.tls?.daysRemaining, r.domainInfo?.rdap?.created, r.domainInfo?.rdap?.registrar,
      r.domainInfo?.wayback?.firstSeen, r.meta.analyzedAt]);
  }
  return rows;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Bad path' }); }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA fallback
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(data);
  });
}

// ---- routes ----------------------------------------------------------------

const routes = [];
const route = (method, pattern, kind, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), kind, handler });

route('GET', '/api/v1/analyze/([^/]+)', 'analyses', async (req, res, [domain], q) => {
  const { report, cached } = await getReport(domain, { fresh: q.get('fresh') === '1' });
  if (q.get('format') === 'csv') return sendCsv(res, `${report.domain}.csv`, reportToCsvRows([report]));
  const fields = q.get('fields');
  const body = fields ? pick(report, fields.split(',')) : report;
  send(res, report.reachable ? 200 : report.errorStatus || 502, body, { 'x-cache': cached ? 'HIT' : 'MISS' });
});

route('GET', '/api/v1/summary/([^/]+)', 'analyses', async (req, res, [domain]) => {
  const { report, cached } = await getReport(domain);
  send(res, report.reachable ? 200 : report.errorStatus || 502, { ...summarize(report), traffic: report.traffic, reachable: report.reachable, error: report.error }, { 'x-cache': cached ? 'HIT' : 'MISS' });
});

route('GET', '/api/v1/compare', 'analyses', async (req, res, _m, q) => {
  const domains = (q.get('domains') || '').split(',').map((d) => d.trim()).filter(Boolean);
  if (domains.length < 2 || domains.length > 5) throw new HttpError(400, 'Pass 2 to 5 comma-separated domains in ?domains=');
  const results = await Promise.all(domains.map((d) => getReport(d).then((r) => r.report).catch((err) => ({ domain: d, error: err.message, reachable: false }))));
  if (q.get('format') === 'csv') return sendCsv(res, 'comparison.csv', reportToCsvRows(results.filter((r) => r.scores)));
  send(res, 200, {
    domains: results.map((r) => r.domain),
    sites: results.map((r) => (r.scores ? {
      ...summarize(r),
      reachable: r.reachable,
      traffic: r.traffic,
      performance: r.performance.metrics,
      providers: r.dns?.providers || null,
      tls: r.tls ? { issuer: r.tls.issuer, protocol: r.tls.protocol, daysRemaining: r.tls.daysRemaining, http2: r.tls.http2 } : null,
      domainAge: r.domainInfo?.rdap?.ageYears ?? null,
      firstSeen: r.domainInfo?.wayback?.firstSeen ?? null,
      rankHistory: r.rank?.history || [],
      socials: r.links?.social || [],
      words: r.content?.wordCount ?? null,
      sitemapUrls: r.files?.sitemap?.urls ?? null,
    } : { domain: r.domain, reachable: false, error: r.error })),
  });
});

route('GET', '/api/v1/rank/([^/]+)', 'requests', async (req, res, [domain]) => {
  const d = registrableDomain(normalizeDomain(domain));
  const rank = await getRank(d);
  send(res, 200, { domain: d, ...rank, traffic: trafficEstimate(rank) });
});

route('GET', '/api/v1/tech/([^/]+)', 'analyses', async (req, res, [domain]) => {
  const { report } = await getReport(domain);
  send(res, 200, { domain: report.domain, ...report.tech });
});

route('GET', '/api/v1/top', 'requests', async (req, res, _m, q) => {
  const limit = Math.min(1000, Math.max(1, Number(q.get('limit') || 100)));
  const offset = Math.max(0, Number(q.get('offset') || 0));
  const list = topSites(limit, offset);
  if (!list) {
    return send(res, 503, { error: 'The Tranco top-sites list is not downloaded yet. Run `npm run tranco` or wait for the background download.', list: localListStatus() });
  }
  send(res, 200, { source: 'Tranco', ...localListStatus(), sites: list.map((s) => ({ ...s, indexed: index.get(s.domain) })) });
});

route('GET', '/api/v1/recent', 'requests', async (req, res, _m, q) => {
  send(res, 200, { sites: index.recent(Math.min(50, Number(q.get('limit') || 12))) });
});

route('GET', '/api/v1/leaderboard', 'requests', async (req, res, _m, q) => {
  send(res, 200, {
    sort: q.get('sort') || 'rank',
    category: q.get('category') || null,
    categories: index.categories(),
    sites: index.leaderboard({ category: q.get('category'), sort: q.get('sort') || 'rank', limit: Math.min(200, Number(q.get('limit') || 50)) }),
  });
});

route('GET', '/api/v1/status', 'requests', async (req, res) => {
  send(res, 200, {
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    indexedSites: index.size,
    cachedReports: cache.size,
    trancoList: localListStatus(),
    ...stats,
    auth: API_KEYS.size ? 'optional API keys (X-API-Key) raise limits' : 'open',
    limits: LIMITS,
  });
});

route('GET', '/api/openapi.json', 'requests', async (req, res) => send(res, 200, openapi(VERSION)));

function pick(obj, fields) {
  const out = { domain: obj.domain };
  for (const f of fields) {
    const keys = f.trim().split('.');
    let src = obj;
    let dst = out;
    for (let i = 0; i < keys.length; i++) {
      if (src == null) break;
      if (i === keys.length - 1) dst[keys[i]] = src[keys[i]];
      else { dst[keys[i]] ||= {}; dst = dst[keys[i]]; src = src[keys[i]]; }
    }
  }
  return out;
}

// ---- server ----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  stats.requests++;
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (pathname.startsWith('/api/')) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'x-api-key, content-type');
    res.setHeader('access-control-expose-headers', 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-cache');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const r = routes.find((rt) => rt.method === req.method && rt.re.test(pathname));
    if (!r) return send(res, 404, { error: `No route for ${req.method} ${pathname}`, docs: '/api/openapi.json' });
    const apiKey = apiKeyOf(req);
    if (apiKey && API_KEYS.size && !API_KEYS.has(apiKey)) return send(res, 401, { error: 'Invalid API key' });
    const rl = rateLimit(req, r.kind);
    res.setHeader('x-ratelimit-limit', rl.limit);
    res.setHeader('x-ratelimit-remaining', rl.remaining);
    res.setHeader('x-ratelimit-reset', rl.reset);
    if (!rl.ok) return send(res, 429, { error: `Rate limit exceeded (${rl.limit} ${r.kind}/hour for ${rl.tier} callers)`, reset: rl.reset });
    try {
      const params = pathname.match(r.re).slice(1).map(decodeURIComponent);
      await r.handler(req, res, params, url.searchParams);
    } catch (err) {
      const status = err.status || (err instanceof URIError ? 400 : 500);
      if (status >= 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err.message || 'Internal error', ...(err.extra || {}) });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  serveStatic(req, res, pathname);
});

if (loadLocalList()) {
  console.log(`Loaded Tranco list: ${localListStatus().domains.toLocaleString()} domains`);
} else if (process.env.SITELENS_OFFLINE !== '1' && process.env.SITELENS_TRANCO_DOWNLOAD !== '0') {
  downloadList()
    .then((s) => console.log(`Downloaded Tranco list: ${s.domains.toLocaleString()} domains`))
    .catch((err) => console.warn(`Tranco list download skipped: ${err.message} (per-domain API still works)`));
}

server.listen(PORT, HOST, () => {
  console.log(`SiteLens ${VERSION} running at http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { index.flush(); process.exit(0); });
}
