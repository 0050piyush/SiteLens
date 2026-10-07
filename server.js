import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDomain, summarize, VERSION } from './src/analyze.js';
import { Cache, SiteIndex } from './src/store.js';
import { normalizeDomain, registrableDomain, HttpError } from './src/util.js';
import { getRank, trafficEstimate, loadLocalList, downloadList, localListStatus, topSites } from './src/rank.js';
import { openapi } from './src/openapi.js';
import { PLANS, DEFAULT_PLAN, FREE_DAILY_REPORTS } from './public/shared/plans.js';
import { UsageStore } from './src/usage.js';
import { BulkJobs } from './src/bulk.js';
import { Monitors, signPayload } from './src/monitors.js';
import { postJson } from './src/fetcher.js';
import { Accounts } from './src/accounts.js';
import {
  billingEnabled, priceFor, createCheckoutSession, createPortalSession, verifyWebhook, applyStripeEvent,
} from './src/stripe.js';
import { timingSafeEqual } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const cache = new Cache({ max: 500, ttlMs: Number(process.env.SITELENS_CACHE_HOURS || 6) * 3600 * 1000 });
const index = new SiteIndex();
const inflight = new Map();
const startedAt = Date.now();
const stats = { analyses: 0, cacheHits: 0, requests: 0 };

// Access policy. The API is private by default: SiteLens's own web pages may
// call it (same origin, or an origin listed in SITELENS_ALLOWED_ORIGINS) with
// per-visitor limits, and every other caller needs a key from SITELENS_API_KEYS.
// SITELENS_PUBLIC_API=1 opens it to everyone (with the anonymous limits).
const csv = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
// SITELENS_API_KEYS entries are "key" or "key:plan" (starter, pro, business).
const API_KEYS = new Map(csv(process.env.SITELENS_API_KEYS).map((entry) => {
  const i = entry.lastIndexOf(':');
  const plan = i > 0 ? entry.slice(i + 1).toLowerCase() : '';
  if (i > 0 && !PLANS[plan]) throw new Error(`Unknown plan "${plan}" in SITELENS_API_KEYS (use ${Object.keys(PLANS).join(', ')})`);
  return i > 0 ? [entry.slice(0, i), plan] : [entry, DEFAULT_PLAN];
}));
const usage = new UsageStore();
const PUBLIC_API = process.env.SITELENS_PUBLIC_API === '1';
const ALLOWED_ORIGINS = new Set(csv(process.env.SITELENS_ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, '').toLowerCase()));
// Open to anyone: health checks, docs, and endpoints that carry their own
// authentication (Stripe's signed webhook, the admin token).
const OPEN_ROUTES = new Set(['/api/v1/status', '/api/openapi.json', '/api/v1/billing/webhook', '/api/v1/admin/grant']);
const accounts = new Accounts();
const CONTACT = process.env.SITELENS_CONTACT || null;
// Hourly limits. Key holders also have a monthly quota from their plan.
const LIMITS = {
  anon: { analyses: Number(process.env.SITELENS_ANON_PER_HOUR || 60), requests: 600 },
};
// The free website: full reports per visitor (IP) per UTC day.
const FREE_PER_DAY = Number(process.env.SITELENS_FREE_PER_DAY || FREE_DAILY_REPORTS);
const freeDaily = new Map(); // ip -> { day, used }
const today = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
function freeUsed(ip) {
  const b = freeDaily.get(ip);
  return b && b.day === today() ? b.used : 0;
}
function freeAdd(ip, n) {
  freeDaily.set(ip, { day: today(), used: freeUsed(ip) + n });
}
const limitFor = (caller, kind) => (caller.tier === 'key'
  ? (kind === 'analyses' ? PLANS[caller.plan].hourly : PLANS[caller.plan].hourly * 10)
  : LIMITS.anon[kind]);
const buckets = new Map();

const originOf = (value) => {
  try { return new URL(value).origin.toLowerCase(); } catch { return null; }
};

/**
 * Who is calling: a key holder, SiteLens's own website, or an outsider.
 * Browser headers can be forged by scripts, so the per-IP limits on the
 * "site" tier remain the backstop; keys are what unlock real volume.
 */
const sessionTokenOf = (req) => /^Bearer\s+([0-9a-f]{64})$/i.exec(req.headers.authorization || '')?.[1] || null;

function callerOf(req) {
  const key = apiKeyOf(req);
  if (key) {
    if (API_KEYS.has(key)) return { tier: 'key', key, plan: API_KEYS.get(key) };
    const owner = accounts.userForApiKey(key);
    if (owner) {
      return accounts.isActive(owner) ? { tier: 'key', key: `user:${owner.id}`, plan: owner.plan, user: owner } : { tier: 'inactive' };
    }
    return { tier: 'invalid' };
  }
  // Logged-in customers with an active plan use their plan on the website too.
  const user = accounts.userForSession(sessionTokenOf(req));
  if (user && accounts.isActive(user)) return { tier: 'key', key: `user:${user.id}`, plan: user.plan, user };
  const host = String(req.headers.host || '').toLowerCase();
  const isOwn = (origin) => !!origin && (ALLOWED_ORIGINS.has(origin) || new URL(origin).host === host);
  const origin = req.headers.origin ? originOf(req.headers.origin) : null;
  if (origin) return isOwn(origin) ? { tier: 'site', origin } : { tier: PUBLIC_API ? 'anon' : 'none' };
  if (req.headers['sec-fetch-site'] === 'same-origin') return { tier: 'site' };
  const referer = req.headers.referer ? originOf(req.headers.referer) : null;
  if (referer && isOwn(referer)) return { tier: 'site', origin: referer };
  return { tier: PUBLIC_API ? 'anon' : 'none' };
}

function rateLimit(req, kind, caller) {
  const tier = caller.tier === 'key' ? 'key' : 'anon';
  const id = tier === 'key' ? `k:${caller.key}` : `ip:${clientIp(req)}`;
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || now > b.reset) b = { reset: now + 3600_000, analyses: 0, requests: 0 };
  b[kind]++;
  buckets.set(id, b);
  const limit = limitFor(caller, kind);
  return { ok: b[kind] <= limit, limit, remaining: Math.max(0, limit - b[kind]), reset: Math.ceil(b.reset / 1000), tier };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
  for (const [ip, b] of freeDaily) if (b.day !== today()) freeDaily.delete(ip);
}, 600_000).unref();

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

// Plan for a usage owner: an env key, or "user:<id>" for account keys.
function planFor(owner) {
  if (API_KEYS.has(owner)) return PLANS[API_KEYS.get(owner)];
  if (String(owner).startsWith('user:')) {
    const u = accounts.byId(owner.slice(5));
    return u && accounts.isActive(u) ? PLANS[u.plan] : null;
  }
  return null;
}

const bulk = new BulkJobs({
  getReport: (domain) => getReport(domain).then((x) => x.report),
  usage,
  summarizeRow: (report) => ({ ...summarize(report), traffic: report.traffic?.available ? { monthlyVisits: report.traffic.monthlyVisits, low: report.traffic.low, high: report.traffic.high } : null }),
  csvRow: (report) => reportToCsvRows([report])[1],
});

async function sendWebhook(url, payload, secret, event) {
  const body = JSON.stringify(payload);
  return postJson(url, payload, { headers: { 'x-sitelens-event': event, 'x-sitelens-signature': signPayload(secret, body) } });
}

const monitors = new Monitors({
  getReport: (domain) => getReport(domain, { fresh: true }).then((x) => x.report),
  usage,
  planFor,
  sendWebhook,
  tickMs: Number(process.env.SITELENS_MONITOR_TICK_MS || 5 * 60 * 1000),
});

/** Reads a request body (JSON or plain text), up to maxBytes. */
function readRaw(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (/json/i.test(req.headers['content-type'] || '') || /^\s*[[{]/.test(text)) {
        try { resolve(text.trim() ? JSON.parse(text) : {}); } catch { reject(new HttpError(400, 'Body is not valid JSON')); }
      } else resolve(text);
    });
    req.on('error', reject);
  });
}

function requireKey(caller, feature) {
  if (caller.tier !== 'key') throw new HttpError(403, `${feature} is available on paid API plans. Send your API key in the X-API-Key header.`);
  return PLANS[caller.plan];
}

const allowPortInput = () => process.env.SITELENS_ALLOW_PRIVATE === '1';

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
      'cache-control': 'no-cache', // always revalidate so deploys show up immediately
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
    access: PUBLIC_API ? 'public' : 'API key required (X-API-Key header)',
    accounts: true,
    billing: billingEnabled(),
    contact: CONTACT,
    limits: { ...LIMITS, freeReportsPerDay: FREE_PER_DAY },
    plans: Object.values(PLANS).map(({ id, name, price, monthly, hourly, bulkMax, monitors: m }) => ({ id, name, price, monthly, hourly, bulkMax, monitors: m })),
  });
});

route('GET', '/api/v1/usage', 'requests', async (req, res, _m, _q, caller) => {
  if (caller.tier !== 'key') throw new HttpError(401, 'Send your API key in the X-API-Key header to see its usage.');
  const plan = PLANS[caller.plan];
  const used = usage.used(caller.key);
  send(res, 200, {
    plan: plan.id, planName: plan.name, pricePerMonth: plan.price,
    month: usage.month(), used, limit: plan.monthly, remaining: Math.max(0, plan.monthly - used),
    resetsAt: usage.resetsAt(), hourlyLimit: plan.hourly,
  });
});

// ---- accounts & billing ----

const authAttempts = new Map(); // ip -> { reset, n }
function throttleAuth(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let a = authAttempts.get(ip);
  if (!a || now > a.reset) a = { reset: now + 15 * 60 * 1000, n: 0 };
  a.n++;
  authAttempts.set(ip, a);
  if (a.n > Number(process.env.SITELENS_AUTH_PER_15MIN || 20)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}

function requireUser(req) {
  const user = accounts.userForSession(sessionTokenOf(req));
  if (!user) throw new HttpError(401, 'Please log in.');
  return user;
}

function accountView(user) {
  const active = accounts.isActive(user);
  const plan = user.plan ? PLANS[user.plan] : null;
  const owner = `user:${user.id}`;
  return {
    email: user.email,
    createdAt: user.createdAt,
    plan: plan ? { id: plan.id, name: plan.name, price: plan.price, monthly: plan.monthly, bulkMax: plan.bulkMax, monitors: plan.monitors } : null,
    status: user.status,
    active,
    apiKey: user.apiKeyPrefix ? { prefix: user.apiKeyPrefix } : null,
    usage: active ? { month: usage.month(), used: usage.used(owner), limit: plan.monthly, resetsAt: usage.resetsAt() } : null,
    monitors: monitors.countFor(owner),
    billing: { enabled: billingEnabled(), canManage: billingEnabled() && !!user.stripeCustomerId },
  };
}

// Where Stripe sends people back to: the page that started checkout, if it is
// one of our own origins.
function returnUrlFrom(req, requested) {
  const host = String(req.headers.host || '').toLowerCase();
  try {
    const u = new URL(String(requested || ''));
    const origin = u.origin.toLowerCase();
    if ((ALLOWED_ORIGINS.has(origin) || u.host === host) && /^https?:$/.test(u.protocol)) return `${u.origin}${u.pathname}`;
  } catch { /* fall through */ }
  if (process.env.SITELENS_APP_URL) return process.env.SITELENS_APP_URL.replace(/#.*$/, '');
  const proto = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http';
  return `${proto}://${host}/`;
}

route('POST', '/api/v1/auth/signup', 'requests', async (req, res) => {
  throttleAuth(req);
  const body = await readBody(req, 16 * 1024);
  const user = accounts.signup(body?.email, body?.password);
  const token = accounts.createSession(user);
  send(res, 201, { token, account: accountView(user) });
});

route('POST', '/api/v1/auth/login', 'requests', async (req, res) => {
  throttleAuth(req);
  const body = await readBody(req, 16 * 1024);
  const user = accounts.login(body?.email, body?.password);
  const token = accounts.createSession(user);
  send(res, 200, { token, account: accountView(user) });
});

route('POST', '/api/v1/auth/logout', 'requests', async (req, res) => {
  accounts.endSession(sessionTokenOf(req));
  send(res, 200, { ok: true });
});

route('GET', '/api/v1/account', 'requests', async (req, res) => {
  send(res, 200, accountView(requireUser(req)));
});

route('POST', '/api/v1/account/key', 'requests', async (req, res) => {
  const user = requireUser(req);
  if (!accounts.isActive(user)) throw new HttpError(402, 'Choose a plan to get an API key.');
  const apiKey = accounts.rotateKey(user);
  send(res, 200, { apiKey, note: 'Copy this key now: it is shown only once. Any previous key stops working.', account: accountView(user) });
});

route('POST', '/api/v1/billing/checkout', 'requests', async (req, res) => {
  const user = requireUser(req);
  if (!billingEnabled()) throw new HttpError(503, 'Online payments are not set up yet.');
  const body = await readBody(req, 16 * 1024);
  const plan = String(body?.plan || '');
  if (!PLANS[plan] || !priceFor(plan)) throw new HttpError(400, 'Unknown plan');
  if (accounts.isActive(user) && user.stripeSubscriptionId) {
    throw new HttpError(409, 'You already have a subscription. Use "Manage billing" to change plans.');
  }
  const base = returnUrlFrom(req, body?.returnTo);
  const session = await createCheckoutSession({
    user, plan, successUrl: `${base}#/account?checkout=success`, cancelUrl: `${base}#/pricing`,
  });
  send(res, 200, { url: session.url });
});

route('POST', '/api/v1/billing/portal', 'requests', async (req, res) => {
  const user = requireUser(req);
  if (!billingEnabled() || !user.stripeCustomerId) throw new HttpError(400, 'No billing account yet.');
  const body = await readBody(req, 16 * 1024);
  const session = await createPortalSession({ user, returnUrl: `${returnUrlFrom(req, body?.returnTo)}#/account` });
  send(res, 200, { url: session.url });
});

route('POST', '/api/v1/billing/webhook', 'requests', async (req, res) => {
  const raw = await readRaw(req, 1024 * 1024);
  const event = verifyWebhook(raw, req.headers['stripe-signature']);
  const result = applyStripeEvent(event, accounts);
  send(res, 200, { received: true, result });
});

// For payments taken outside Stripe (bank transfer, UPI…): grant a plan by hand.
route('POST', '/api/v1/admin/grant', 'requests', async (req, res) => {
  const token = process.env.SITELENS_ADMIN_TOKEN || '';
  const given = String(req.headers['x-admin-token'] || '');
  const ok = token.length >= 16 && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (!ok) throw new HttpError(401, 'Admin token required');
  const body = await readBody(req, 16 * 1024);
  const user = accounts.byEmail(body?.email || '');
  if (!user) throw new HttpError(404, 'No account with that email');
  const plan = body?.plan == null ? null : String(body.plan);
  if (plan && !PLANS[plan]) throw new HttpError(400, 'Unknown plan');
  accounts.setPlan(user, { plan, status: plan ? 'manual' : 'canceled' });
  send(res, 200, { email: user.email, account: accountView(user) });
});

// ---- bulk analysis (paid) ----

route('POST', '/api/v1/bulk', 'requests', async (req, res, _m, _q, caller) => {
  const plan = requireKey(caller, 'Bulk analysis');
  const body = await readBody(req);
  const raw = Array.isArray(body) ? body : Array.isArray(body?.domains) ? body.domains
    : typeof body === 'string' ? body.split(/[\s,;]+/) : [];
  const inputs = raw.map((d) => String(d).trim()).filter(Boolean);
  if (!inputs.length) throw new HttpError(400, 'Send {"domains": ["a.com", "b.com"]} or a newline-separated list.');
  if (inputs.length > plan.bulkMax) throw new HttpError(413, `Your ${plan.name} plan allows up to ${plan.bulkMax} domains per bulk job (got ${inputs.length}).`);
  const domains = [];
  const invalid = [];
  for (const input of inputs) {
    try {
      const d = normalizeDomain(input, { allowPort: allowPortInput() });
      if (!domains.includes(d)) domains.push(d);
    } catch { invalid.push(input); }
  }
  if (!domains.length) throw new HttpError(400, 'None of the domains are valid.', { invalid });
  const remaining = plan.monthly - usage.used(caller.key);
  if (domains.length > remaining) {
    throw new HttpError(429, `This job needs ${domains.length} analyses but your ${plan.name} plan has ${Math.max(0, remaining)} left this month.`, { remaining: Math.max(0, remaining) });
  }
  if (bulk.activeFor(caller.key) >= BulkJobs.maxActivePerKey) {
    throw new HttpError(429, `You already have ${BulkJobs.maxActivePerKey} bulk jobs running. Wait for one to finish.`);
  }
  const job = bulk.create({ key: caller.key, plan, domains });
  send(res, 202, { ...bulk.view(job, { results: false }), invalid, poll: `/api/v1/bulk/${job.id}` });
});

route('GET', '/api/v1/bulk', 'requests', async (req, res, _m, _q, caller) => {
  requireKey(caller, 'Bulk analysis');
  send(res, 200, { jobs: bulk.listFor(caller.key) });
});

route('GET', '/api/v1/bulk/([^/]+)', 'requests', async (req, res, [id], q, caller) => {
  requireKey(caller, 'Bulk analysis');
  const job = bulk.get(id, caller.key);
  if (!job) throw new HttpError(404, 'No such bulk job (jobs are kept for 24 hours).');
  if (q.get('format') === 'csv') {
    const header = reportToCsvRows([])[0];
    return sendCsv(res, `sitelens-bulk-${id.slice(0, 8)}.csv`, [header, ...job.csvRows.filter(Boolean)]);
  }
  send(res, 200, bulk.view(job));
});

// ---- monitoring (paid) ----

route('POST', '/api/v1/monitors', 'requests', async (req, res, _m, _q, caller) => {
  const plan = requireKey(caller, 'Monitoring');
  const body = await readBody(req);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Send JSON: {"domain": "example.com", "webhook": "https://…", "interval": "weekly"}');
  const domain = normalizeDomain(String(body.domain || ''), { allowPort: allowPortInput() });
  const interval = body.interval || 'weekly';
  if (!['daily', 'weekly'].includes(interval)) throw new HttpError(400, 'interval must be "daily" or "weekly"');
  let webhook;
  try { webhook = new URL(String(body.webhook || '')); } catch { throw new HttpError(400, 'webhook must be a URL'); }
  if (webhook.protocol !== 'https:' && !(allowPortInput() && webhook.protocol === 'http:')) throw new HttpError(400, 'webhook must use https://');
  if (webhook.href.length > 500) throw new HttpError(400, 'webhook URL is too long');
  if (monitors.countFor(caller.key) >= plan.monitors) {
    throw new HttpError(403, `Your ${plan.name} plan allows ${plan.monitors} monitors. Delete one or upgrade.`);
  }
  const m = monitors.create({ key: caller.key, domain, webhook: webhook.href, interval });
  // The secret is shown once: use it to verify the X-SiteLens-Signature header.
  send(res, 201, { ...monitors.view(m, { secret: true }), note: 'Store the secret: webhooks are signed with HMAC-SHA256 in the X-SiteLens-Signature header.' });
});

route('GET', '/api/v1/monitors', 'requests', async (req, res, _m, _q, caller) => {
  const plan = requireKey(caller, 'Monitoring');
  send(res, 200, { limit: plan.monitors, monitors: monitors.listFor(caller.key) });
});

route('GET', '/api/v1/monitors/([^/]+)', 'requests', async (req, res, [id], _q, caller) => {
  requireKey(caller, 'Monitoring');
  const m = monitors.get(id, caller.key);
  if (!m) throw new HttpError(404, 'No such monitor');
  send(res, 200, monitors.view(m));
});

route('DELETE', '/api/v1/monitors/([^/]+)', 'requests', async (req, res, [id], _q, caller) => {
  requireKey(caller, 'Monitoring');
  if (!monitors.remove(id, caller.key)) throw new HttpError(404, 'No such monitor');
  send(res, 200, { deleted: id });
});

route('POST', '/api/v1/monitors/([^/]+)/test', 'requests', async (req, res, [id], _q, caller) => {
  requireKey(caller, 'Monitoring');
  const m = monitors.get(id, caller.key);
  if (!m) throw new HttpError(404, 'No such monitor');
  const alert = await monitors.notify(m, 'monitor.test', { message: 'Test webhook from SiteLens', snapshot: m.last });
  send(res, alert.ok ? 200 : 502, { delivered: alert.ok, ...alert });
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
    // Browsers on other websites only get CORS access when the API is public
    // or their origin is one of ours.
    const reqOrigin = req.headers.origin ? originOf(req.headers.origin) : null;
    res.setHeader('vary', 'Origin');
    if (PUBLIC_API) res.setHeader('access-control-allow-origin', '*');
    else if (reqOrigin && ALLOWED_ORIGINS.has(reqOrigin)) res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('access-control-allow-headers', 'x-api-key, content-type, authorization');
    res.setHeader('access-control-expose-headers', 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-cache, x-plan, x-quota-limit, x-quota-remaining, x-free-limit, x-free-remaining');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const r = routes.find((rt) => rt.method === req.method && rt.re.test(pathname));
    if (!r) return send(res, 404, { error: `No route for ${req.method} ${pathname}`, docs: '/api/openapi.json' });
    const caller = OPEN_ROUTES.has(pathname) ? { tier: 'anon' } : callerOf(req);
    if (caller.tier === 'invalid') return send(res, 401, { error: 'Invalid API key' });
    if (caller.tier === 'inactive') return send(res, 402, { error: 'This API key belongs to an account without an active plan. Renew it on your account page.' });
    if (caller.tier === 'none') {
      return send(res, 401, {
        error: 'An API key is required. Send it in the X-API-Key header.',
        ...(CONTACT ? { contact: CONTACT } : {}),
        docs: '/api/openapi.json',
      }, { 'www-authenticate': 'ApiKey header="X-API-Key"' });
    }
    const rl = rateLimit(req, r.kind, caller);
    res.setHeader('x-ratelimit-limit', rl.limit);
    res.setHeader('x-ratelimit-remaining', rl.remaining);
    res.setHeader('x-ratelimit-reset', rl.reset);
    if (!rl.ok) return send(res, 429, { error: `Rate limit exceeded (${rl.limit} ${r.kind}/hour)`, reset: rl.reset });
    const cost = r.kind !== 'analyses' ? 0 : pathname === '/api/v1/compare'
      ? Math.min(5, Math.max(1, (url.searchParams.get('domains') || '').split(',').filter((d) => d.trim()).length))
      : 1;
    // Free website visitors: a daily allowance of reports (successful ones count).
    if (caller.tier !== 'key' && cost) {
      const ip = clientIp(req);
      const used = freeUsed(ip);
      res.setHeader('x-free-limit', FREE_PER_DAY);
      if (used + cost > FREE_PER_DAY) {
        res.setHeader('x-free-remaining', Math.max(0, FREE_PER_DAY - used));
        return send(res, 429, {
          error: `Daily free limit reached (${FREE_PER_DAY} reports a day). It resets at midnight UTC, or get an API plan for more.`,
          upgrade: true, limit: FREE_PER_DAY, resetsAt: tomorrowIso(),
        });
      }
      res.setHeader('x-free-remaining', FREE_PER_DAY - used - cost);
      res.once('finish', () => { if (res.statusCode < 400) freeAdd(ip, cost); });
    }
    // Monthly plan quota: one unit per analyzed site (a comparison counts each site).
    if (caller.tier === 'key' && cost) {
      const plan = PLANS[caller.plan];
      const used = usage.used(caller.key);
      res.setHeader('x-plan', plan.id);
      res.setHeader('x-quota-limit', plan.monthly);
      if (used + cost > plan.monthly) {
        res.setHeader('x-quota-remaining', Math.max(0, plan.monthly - used));
        return send(res, 429, { error: `Monthly quota reached for the ${plan.name} plan (${plan.monthly} analyses). Upgrade or wait until ${usage.resetsAt()}.`, plan: plan.id, resetsAt: usage.resetsAt() });
      }
      res.setHeader('x-quota-remaining', plan.monthly - used - cost);
      // Only successful responses use up quota.
      res.once('finish', () => { if (res.statusCode < 400) usage.add(caller.key, cost); });
    }
    try {
      const params = pathname.match(r.re).slice(1).map(decodeURIComponent);
      await r.handler(req, res, params, url.searchParams, caller);
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
  process.on(sig, () => { index.flush(); usage.flush(); process.exit(0); });
}
