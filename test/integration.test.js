// Spins up a local fixture website and the Webvieu server, then exercises the API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const html = fs.readFileSync(new URL('./fixtures/shop.html', import.meta.url));
let site;
let hookServer;
let hookPort;
const hooks = [];
let server;
let sitePort;
let apiPort;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitelens-test-'));
const KEY = 'test-key-123';
const ADMIN_TOKEN = 'admin-token-0123456789abcdef';
const WHSEC = 'whsec_test_secret';
let stripeServer;
let stripePort;
const stripeCalls = [];
let mailServer;
let mailPort;
const emails = [];
// The newest email sent to an address, and the token in its link.
const lastEmailTo = (to) => emails.filter((e) => e.to[0] === to).at(-1);
const tokenIn = (email) => /token=([0-9a-f]{64})/.exec(email.text)?.[1];

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

before(async () => {
  site = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /cart/\nSitemap: /sitemap.xml\n'); }
    if (req.url === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end('<urlset><url><loc>http://x/a</loc></url><url><loc>http://x/b</loc></url></urlset>'); }
    if (req.url === '/old') { res.writeHead(301, { location: '/' }); return res.end(); }
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip', server: 'nginx', 'x-content-type-options': 'nosniff' });
      return res.end(zlib.gzipSync(html));
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<!doctype html><html>404</html>');
  });
  sitePort = await listen(site);

  // Receives monitor webhooks.
  hookServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { hooks.push({ headers: req.headers, body }); res.end('ok'); });
  });
  hookPort = await listen(hookServer);

  // A stand-in for the Stripe API.
  stripeServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      stripeCalls.push({ path: req.url, auth: req.headers.authorization, body: new URLSearchParams(body) });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }));
      if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ id: 'bps_1', url: 'https://billing.stripe.test/bps_1' }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  stripePort = await listen(stripeServer);

  // A stand-in for the Resend email API.
  mailServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      emails.push({ ...JSON.parse(body), auth: req.headers.authorization, path: req.url });
      res.setHeader('content-type', 'application/json');
      res.end('{"id":"email_1"}');
    });
  });
  mailPort = await listen(mailServer);

  // quota-key starts one analysis short of the Starter plan's monthly quota.
  fs.writeFileSync(path.join(dataDir, 'usage.json'), JSON.stringify({ month: new Date().toISOString().slice(0, 7), counts: { 'quota-key': 999 } }));

  const probe = http.createServer();
  apiPort = await listen(probe);
  await new Promise((r) => probe.close(r));
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', SITELENS_ALLOW_PRIVATE: '1', SITELENS_OFFLINE: '1', SITELENS_DATA_DIR: dataDir,
      SITELENS_ANON_PER_HOUR: '100', SITELENS_FREE_PER_DAY: '5', SITELENS_TRUST_PROXY: '1', SITELENS_MONITOR_TICK_MS: '200',
      SITELENS_API_KEYS: `${KEY}:business,other-key,quota-key:starter,mon-key:starter`, SITELENS_ALLOWED_ORIGINS: 'https://webvieu.example.github.io/',
      SITELENS_ADMIN_TOKEN: ADMIN_TOKEN, SITELENS_AUTH_PER_15MIN: '50',
      STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: `http://127.0.0.1:${stripePort}`,
      STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_BUSINESS: 'price_business',
      SITELENS_CONTACT: 'owner@webvieu.test', SITELENS_CONTACT_PER_HOUR: '3',
      RESEND_API_KEY: 're_test', SITELENS_EMAIL_FROM: 'Webvieu <noreply@webvieu.test>', EMAIL_API_BASE: `http://127.0.0.1:${mailPort}`,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('running at')) resolve(); });
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(() => {
  server?.kill();
  site?.close();
  hookServer?.close();
  stripeServer?.close();
  mailServer?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// API calls carry a key unless a test overrides the headers.
const get = async (p, headers = { 'x-api-key': KEY }) => {
  const res = await fetch(`http://127.0.0.1:${apiPort}${p}`, { headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
};

test('analyze returns a full report and caches it', async () => {
  const target = `localhost:${sitePort}`;
  const r = await get(`/api/v1/analyze/${target}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-cache'), 'MISS');
  assert.equal(r.body.reachable, true);
  assert.equal(r.body.site.title, 'Acme Outdoor Gear – Shop Tents, Backpacks & Boots');
  assert.equal(r.body.http.encoding, 'gzip');
  assert.ok(r.body.tech.list.some((t) => t.name === 'WordPress'));
  assert.equal(r.body.files.sitemap.urls, 2);
  assert.equal(r.body.category.primary, 'E-commerce & Shopping');
  assert.ok(r.body.scores.overall > 0);

  const again = await get(`/api/v1/analyze/${target}?fields=scores,tech.count`);
  assert.equal(again.headers.get('x-cache'), 'HIT');
  assert.deepEqual(Object.keys(again.body).sort(), ['domain', 'scores', 'tech']);
  assert.deepEqual(Object.keys(again.body.tech), ['count']);
});

test('csv export, recent list, leaderboard, status and openapi', async () => {
  const csv = await get(`/api/v1/analyze/localhost:${sitePort}?format=csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body.split('\n')[0], /^domain,title,category/);
  // API analyses stay private; website analyses appear in "Recently analyzed".
  assert.equal((await get('/api/v1/recent')).body.sites.length, 0);
  await get(`/api/v1/analyze/localhost:${sitePort}`, { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.30' });
  const recent = await get('/api/v1/recent');
  assert.equal(recent.body.sites[0].domain, 'localhost');
  const lb = await get('/api/v1/leaderboard?sort=score');
  assert.equal(lb.body.sites.length, 1);
  const status = await get('/api/v1/status');
  assert.equal(status.body.status, 'ok');
  const spec = await get('/api/openapi.json');
  assert.equal(spec.body.openapi, '3.1.0');
  assert.ok(spec.body.paths['/api/v1/analyze/{domain}']);
});

test('input validation and errors', async () => {
  assert.equal((await get('/api/v1/analyze/not_a_domain')).status, 400);
  assert.equal((await get('/api/v1/compare?domains=one.com')).status, 400);
  assert.equal((await get('/api/v1/nope')).status, 404);
  const missing = await get('/api/v1/analyze/does-not-exist.invalid');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.reachable, false);
});

test('static files, SPA fallback and traversal protection', async () => {
  const index = await get('/');
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await get('/site/whatever')).status, 200);
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/v1/analyze/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/v1/status')).status, 200, 'server survived malformed paths');
  for (const p of ['/%2e%2e/server.js', '/..%2fserver.js', '/%2e%2e%2fpackage.json']) {
    const r = await get(p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(String(r.body), /createServer|"scripts"/);
  }
});

test('API requires a key except for the site itself', async () => {
  const target = `/api/v1/summary/localhost:${sitePort}`;
  const anon = await get(target, {});
  assert.equal(anon.status, 401);
  assert.match(anon.body.error, /API key is required/);
  assert.equal((await get(target, { 'x-api-key': 'wrong' })).status, 401);
  assert.equal((await get(`${target}?api_key=${KEY}`, {})).status, 200);
  // Another website's browser: refused, and no CORS grant.
  const foreign = await get(target, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 401);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  // Health check and docs stay open.
  assert.equal((await get('/api/v1/status', {})).status, 200);
  assert.equal((await get('/api/openapi.json', {})).status, 200);
});

test('own website may call the API without a key', async () => {
  const target = `/api/v1/summary/localhost:${sitePort}`;
  const pages = await get(target, { origin: 'https://webvieu.example.github.io' });
  assert.equal(pages.status, 200);
  assert.equal(pages.headers.get('access-control-allow-origin'), 'https://webvieu.example.github.io');
  assert.equal((await get(target, { 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await get(target, { referer: `http://127.0.0.1:${apiPort}/#/site/x` })).status, 200);
  assert.equal((await get(target, { origin: `http://127.0.0.1:${apiPort}` })).status, 200);
});

test('free website visitors get a daily allowance; key holders get plan limits', async () => {
  const visitor = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.50' };
  // Failed lookups don't use the allowance.
  assert.equal((await get('/api/v1/summary/does-not-exist.invalid', visitor)).status, 404);
  let last;
  for (let i = 0; i < 5; i++) {
    last = await get(`/api/v1/summary/localhost:${sitePort}`, visitor);
    assert.equal(last.status, 200, `report ${i + 1}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(last.headers.get('x-free-remaining'), '0');
  const over = await get(`/api/v1/summary/localhost:${sitePort}`, visitor);
  assert.equal(over.status, 429);
  assert.equal(over.body.upgrade, true);
  assert.match(over.body.error, /Daily free limit reached \(5 reports a day\)/);
  // Another visitor is unaffected; cheap endpoints don't count.
  assert.equal((await get(`/api/v1/summary/localhost:${sitePort}`, { ...visitor, 'x-forwarded-for': '203.0.113.51' })).status, 200);
  assert.equal((await get('/api/v1/recent', visitor)).status, 200);
  const keyed = await get(`/api/v1/summary/localhost:${sitePort}`, { 'x-api-key': 'other-key' });
  assert.equal(keyed.status, 200);
  assert.equal(keyed.headers.get('x-plan'), 'starter'); // keys without a plan default to Starter
  assert.equal(keyed.headers.get('x-ratelimit-limit'), '200');
  const biz = await get(`/api/v1/summary/localhost:${sitePort}`);
  assert.equal(biz.headers.get('x-plan'), 'business');
  assert.equal(biz.headers.get('x-ratelimit-limit'), '5000');
  assert.equal(biz.headers.get('x-quota-limit'), '50000');
});

test('monthly plan quota is enforced and only successful calls count', async () => {
  const q = { 'x-api-key': 'quota-key' };
  // A failed request (unreachable domain) must not use quota.
  const failed = await get('/api/v1/summary/does-not-exist.invalid', q);
  assert.equal(failed.status, 404);
  let usage = await get('/api/v1/usage', q);
  assert.deepEqual([usage.body.plan, usage.body.used, usage.body.limit, usage.body.remaining], ['starter', 999, 1000, 1]);
  const last = await get(`/api/v1/summary/localhost:${sitePort}`, q);
  assert.equal(last.status, 200);
  assert.equal(last.headers.get('x-quota-remaining'), '0');
  await new Promise((r) => setTimeout(r, 50)); // usage is recorded when the response finishes
  const over = await get(`/api/v1/summary/localhost:${sitePort}`, q);
  assert.equal(over.status, 429);
  assert.match(over.body.error, /Monthly quota reached for the Starter plan/);
  usage = await get('/api/v1/usage', q);
  assert.equal(usage.body.used, 1000);
  // A comparison costs one unit per site.
  const before = (await get('/api/v1/usage', { 'x-api-key': 'other-key' })).body.used;
  await get(`/api/v1/compare?domains=localhost:${sitePort},localhost:${sitePort}`, { 'x-api-key': 'other-key' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await get('/api/v1/usage', { 'x-api-key': 'other-key' })).body.used, before + 2);
  // Website visitors have no key, so no usage endpoint.
  assert.equal((await get('/api/v1/usage', { 'sec-fetch-site': 'same-origin' })).status, 401);
});

const post = async (p, body, headers = { 'x-api-key': KEY }) => {
  const res = await fetch(`http://127.0.0.1:${apiPort}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
};

test('bulk jobs: key only, plan size limit, dedupe, results and CSV', async () => {
  const target = `localhost:${sitePort}`;
  assert.equal((await post('/api/v1/bulk', { domains: [target] }, { 'sec-fetch-site': 'same-origin' })).status, 403);
  const tooMany = await post('/api/v1/bulk', { domains: Array.from({ length: 101 }, (_, i) => `site${i}.com`) }, { 'x-api-key': 'other-key' });
  assert.equal(tooMany.status, 413);
  assert.match(tooMany.body.error, /up to 100 domains/);

  const before = (await get('/api/v1/usage')).body.used;
  const created = await post('/api/v1/bulk', { domains: [target, 'does-not-exist.invalid', 'not a domain', target] });
  assert.equal(created.status, 202);
  assert.equal(created.body.total, 2);
  assert.deepEqual(created.body.invalid, ['not a domain']);
  const job = await until(async () => {
    const r = await get(created.body.poll);
    return r.body.status === 'completed' && r.body;
  });
  assert.deepEqual([job.succeeded, job.failed, job.skipped], [1, 1, 0]);
  assert.equal(job.results.find((x) => x.status === 'ok').title, 'Acme Outdoor Gear – Shop Tents, Backpacks & Boots');
  assert.equal((await get('/api/v1/usage')).body.used, before + 1, 'only the successful site is charged');
  const csv = await get(`${created.body.poll}?format=csv`);
  assert.equal(csv.body.trim().split('\n').length, 2);
  assert.equal((await get(created.body.poll, { 'x-api-key': 'other-key' })).status, 404, 'jobs are private to their key');
  // Plain-text body works too.
  assert.equal((await post('/api/v1/bulk', `${target}\nexample.invalid`, { 'x-api-key': KEY, 'content-type': 'text/plain' })).status, 202);
});

test('monitors: baseline check, signed test webhook, plan limit, delete', async () => {
  const h = { 'x-api-key': 'mon-key' };
  assert.equal((await post('/api/v1/monitors', { domain: 'a.com', webhook: 'https://x.example/h' }, { 'sec-fetch-site': 'same-origin' })).status, 403);
  assert.equal((await post('/api/v1/monitors', { domain: 'a.com', webhook: 'ftp://x/h' }, h)).status, 400);
  assert.equal((await post('/api/v1/monitors', { domain: 'a.com', webhook: 'https://x.example/h', interval: 'hourly' }, h)).status, 400);

  const created = await post('/api/v1/monitors', { domain: `localhost:${sitePort}`, webhook: `http://127.0.0.1:${hookPort}/hook`, interval: 'daily' }, h);
  assert.equal(created.status, 201);
  assert.match(created.body.secret, /^[0-9a-f]{48}$/);
  const id = created.body.id;
  const baseline = await until(async () => {
    const r = await get(`/api/v1/monitors/${id}`, h);
    return r.body.lastCheckedAt && r.body;
  });
  assert.equal(baseline.lastStatus, 'baseline recorded');
  assert.equal(baseline.current.title, 'Acme Outdoor Gear – Shop Tents, Backpacks & Boots');
  assert.equal(baseline.secret, undefined, 'secret is only shown once');
  assert.equal(hooks.length, 0, 'no alert for the baseline');

  const test1 = await post(`/api/v1/monitors/${id}/test`, {}, h);
  assert.equal(test1.status, 200);
  assert.equal(hooks.length, 1);
  const hook = hooks[0];
  assert.equal(hook.headers['x-webvieu-event'], 'monitor.test');
  const expected = `sha256=${createHmac('sha256', created.body.secret).update(hook.body).digest('hex')}`;
  assert.equal(hook.headers['x-webvieu-signature'], expected, 'webhook signature verifies');

  // Starter allows 5 monitors.
  for (let i = 0; i < 4; i++) assert.equal((await post('/api/v1/monitors', { domain: `site${i}.invalid`, webhook: 'https://x.example/h' }, h)).status, 201);
  const sixth = await post('/api/v1/monitors', { domain: 'six.invalid', webhook: 'https://x.example/h' }, h);
  assert.equal(sixth.status, 403);
  assert.match(sixth.body.error, /allows 5 monitors/);
  assert.equal((await get('/api/v1/monitors', h)).body.monitors.length, 5);
  assert.equal((await get(`/api/v1/monitors/${id}`)).status, 404, 'monitors are private to their key');
  const del = await fetch(`http://127.0.0.1:${apiPort}/api/v1/monitors/${id}`, { method: 'DELETE', headers: h });
  assert.equal(del.status, 200);
  assert.equal((await get('/api/v1/monitors', h)).body.monitors.length, 4);
});

test('accounts: signup, login, Stripe checkout, webhook activation, API key, portal', async () => {
  const site = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.7' };
  const email = 'buyer@example.com';
  assert.equal((await post('/api/v1/auth/signup', { email: 'nope', password: 'longenough' }, site)).status, 400);
  assert.equal((await post('/api/v1/auth/signup', { email, password: 'short' }, site)).status, 400);
  const signup = await post('/api/v1/auth/signup', { email, password: 'correct horse battery' }, site);
  assert.equal(signup.status, 201);
  assert.match(signup.body.token, /^[0-9a-f]{64}$/);
  assert.equal(signup.body.account.active, false);
  assert.equal((await post('/api/v1/auth/signup', { email, password: 'correct horse battery' }, site)).status, 409);
  assert.equal((await post('/api/v1/auth/login', { email, password: 'wrong password' }, site)).status, 401);
  const login = await post('/api/v1/auth/login', { email: 'Buyer@Example.com ', password: 'correct horse battery' }, site);
  assert.equal(login.status, 200);
  const auth = { ...site, authorization: `Bearer ${login.body.token}` };

  const acct = await get('/api/v1/account', auth);
  assert.deepEqual([acct.body.email, acct.body.active, acct.body.billing.enabled, acct.body.emailVerified], [email, false, true, false]);

  // Checkout needs a confirmed email; the signup email carries the link.
  const blocked = await post('/api/v1/billing/checkout', { plan: 'pro' }, auth);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'verify_email');
  const welcome = lastEmailTo(email);
  assert.equal(welcome.subject, 'Confirm your Webvieu email');
  assert.equal(welcome.auth, 'Bearer re_test');
  assert.equal(welcome.from, 'Webvieu <noreply@webvieu.test>');
  assert.equal((await post('/api/v1/auth/verify', { token: tokenIn(welcome) }, site)).status, 200);
  assert.equal((await post('/api/v1/auth/verify', { token: tokenIn(welcome) }, site)).status, 400, 'links work once');
  assert.equal((await get('/api/v1/account', auth)).body.emailVerified, true);
  assert.equal((await get('/api/v1/account', site)).status, 401);
  assert.equal((await post('/api/v1/account/key', {}, auth)).status, 402, 'no key without a plan');

  // Checkout goes to Stripe with the right price, user and return URL.
  const co = await post('/api/v1/billing/checkout', { plan: 'pro', returnTo: `http://127.0.0.1:${apiPort}/#/pricing` }, auth);
  assert.equal(co.status, 200);
  assert.equal(co.body.url, 'https://checkout.stripe.test/cs_1');
  const call = stripeCalls.at(-1);
  assert.equal(call.auth, 'Bearer sk_test_fake');
  assert.equal(call.body.get('line_items[0][price]'), 'price_pro');
  assert.equal(call.body.get('mode'), 'subscription');
  assert.equal(call.body.get('customer_email'), email);
  assert.equal(call.body.get('success_url'), `http://127.0.0.1:${apiPort}/#/account?checkout=success`);
  const userId = call.body.get('client_reference_id');
  // A foreign return URL is not used.
  await post('/api/v1/billing/checkout', { plan: 'pro', returnTo: 'https://evil.example/' }, auth);
  assert.doesNotMatch(stripeCalls.at(-1).body.get('success_url'), /evil/);
  assert.equal((await post('/api/v1/billing/checkout', { plan: 'gold' }, auth)).status, 400);

  // Webhooks must be signed.
  const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: userId, customer: 'cus_1', subscription: 'sub_1', metadata: { userId, plan: 'pro' } } } });
  const sendHook = (body, sig) => fetch(`http://127.0.0.1:${apiPort}/api/v1/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': sig, 'content-type': 'application/json' }, body });
  assert.equal((await sendHook(event, 't=1,v1=deadbeef')).status, 400);
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', WHSEC).update(`${t}.${event}`).digest('hex')}`;
  assert.equal((await sendHook(event, sig)).status, 200);

  const active = await get('/api/v1/account', auth);
  assert.deepEqual([active.body.active, active.body.plan.id, active.body.billing.canManage], [true, 'pro', true]);
  assert.equal(active.body.apiKey, null, 'no key until the customer creates one');

  // Rotating shows the full key once; it works as an X-API-Key on the Pro plan.
  const k = await post('/api/v1/account/key', {}, auth);
  assert.match(k.body.apiKey, /^wv_live_[0-9a-f]{48}$/);
  assert.equal(k.body.account.apiKey.prefix, k.body.apiKey.slice(0, 16));
  const k2 = await post('/api/v1/account/key', {}, auth);
  assert.equal((await get(`/api/v1/summary/localhost:${sitePort}`, { 'x-api-key': k2.body.apiKey })).status, 200);
  assert.equal((await get(`/api/v1/summary/localhost:${sitePort}`, { 'x-api-key': k.body.apiKey })).status, 401, 'old key stops working');
  k.body.apiKey = k2.body.apiKey;
  const used = await get(`/api/v1/summary/localhost:${sitePort}`, { 'x-api-key': k.body.apiKey });
  assert.equal(used.status, 200);
  assert.equal(used.headers.get('x-plan'), 'pro');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await get('/api/v1/account', auth)).body.usage.used, 2, 'one call with each key');
  // On the website, logged-in customers use the same free terms as everyone.
  const viaSite = await get(`/api/v1/summary/localhost:${sitePort}`, auth);
  assert.equal(viaSite.headers.get('x-plan'), null);
  assert.equal(viaSite.headers.get('x-free-limit'), '5');

  // Billing portal.
  const portal = await post('/api/v1/billing/portal', { returnTo: `http://127.0.0.1:${apiPort}/` }, auth);
  assert.equal(portal.body.url, 'https://billing.stripe.test/bps_1');
  assert.equal(stripeCalls.at(-1).body.get('customer'), 'cus_1');

  // Cancellation deactivates the key.
  const cancel = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } });
  const t2 = Math.floor(Date.now() / 1000);
  await sendHook(cancel, `t=${t2},v1=${createHmac('sha256', WHSEC).update(`${t2}.${cancel}`).digest('hex')}`);
  assert.equal((await get(`/api/v1/summary/localhost:${sitePort}`, { 'x-api-key': k.body.apiKey })).status, 402);

  // Logout ends the session.
  await post('/api/v1/auth/logout', {}, auth);
  assert.equal((await get('/api/v1/account', auth)).status, 401);
});

test('admin can grant a plan for manual payments', async () => {
  const site = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.8' };
  const s1 = await post('/api/v1/auth/signup', { email: 'manual@example.com', password: 'another good password' }, site);
  const auth = { ...site, authorization: `Bearer ${s1.body.token}` };
  assert.equal((await post('/api/v1/admin/grant', { email: 'manual@example.com', plan: 'starter' }, { 'x-admin-token': 'wrong' })).status, 401);
  const g = await post('/api/v1/admin/grant', { email: 'manual@example.com', plan: 'starter' }, { 'x-admin-token': ADMIN_TOKEN });
  assert.equal(g.status, 200);
  assert.equal(g.body.account.plan.id, 'starter');
  const k = await post('/api/v1/account/key', {}, auth);
  assert.equal(k.status, 200);
  const r = await get(`/api/v1/summary/localhost:${sitePort}`, { 'x-api-key': k.body.apiKey });
  assert.equal(r.headers.get('x-plan'), 'starter');
});

test('email verification resend and password reset', async () => {
  const site = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.9' };
  const email = 'forgetful@example.com';
  const signup = await post('/api/v1/auth/signup', { email, password: 'first password 1', returnTo: 'https://webvieu.example.github.io/SiteLens/#/login' }, site);
  assert.equal(signup.body.verificationSent, true);
  const first = lastEmailTo(email);
  // Links point back to the page the visitor came from (here: a Pages sub-path).
  assert.match(first.text, /https:\/\/webvieu\.example\.github\.io\/SiteLens\/#\/verify\?token=[0-9a-f]{64}/);
  assert.match(first.html, /Confirm email/);
  const auth = { ...site, authorization: `Bearer ${signup.body.token}` };
  assert.equal((await post('/api/v1/auth/resend-verification', {}, auth)).status, 429, 'resends are throttled');

  // Unknown emails get the same answer and no email.
  const before = emails.length;
  const unknown = await post('/api/v1/auth/forgot', { email: 'nobody@example.com' }, site);
  assert.equal(unknown.status, 200);
  assert.equal(emails.length, before);

  const forgot = await post('/api/v1/auth/forgot', { email: 'Forgetful@Example.com', returnTo: `http://127.0.0.1:${apiPort}/` }, site);
  assert.equal(forgot.body.message, unknown.body.message);
  const resetMail = lastEmailTo(email);
  assert.equal(resetMail.subject, 'Reset your Webvieu password');
  const token = tokenIn(resetMail);
  assert.match(resetMail.text, new RegExp(`http://127\\.0\\.0\\.1:${apiPort}/#/reset\\?token=`));

  assert.equal((await post('/api/v1/auth/reset', { token, password: 'short' }, site)).status, 400);
  assert.equal((await post('/api/v1/auth/reset', { token: 'f'.repeat(64), password: 'new password 22' }, site)).status, 400);
  const reset = await post('/api/v1/auth/reset', { token, password: 'new password 22' }, site);
  assert.equal(reset.status, 200);
  assert.match(reset.body.token, /^[0-9a-f]{64}$/);
  assert.equal(reset.body.account.emailVerified, true, 'reset proves the inbox');
  assert.equal((await post('/api/v1/auth/reset', { token, password: 'another one 333' }, site)).status, 400, 'reset links work once');
  assert.equal((await get('/api/v1/account', auth)).status, 401, 'old sessions are signed out');
  assert.equal((await post('/api/v1/auth/login', { email, password: 'first password 1' }, site)).status, 401);
  assert.equal((await post('/api/v1/auth/login', { email, password: 'new password 22' }, site)).status, 200);
});

test('contact form: validation, honeypot, forwarding and rate limit', async () => {
  const site = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.20' };
  const msg = { name: 'Asha', email: 'asha@example.com', topic: 'API plans & sales', message: 'Do you offer annual billing for the Pro plan?' };
  assert.equal((await post('/api/v1/contact', { ...msg, email: 'not-an-email' }, site)).status, 400);
  assert.equal((await post('/api/v1/contact', { ...msg, message: 'hi' }, site)).status, 400);
  // Bots that fill the hidden field get a quiet "ok" and nothing is sent.
  const before = emails.length;
  assert.equal((await post('/api/v1/contact', { ...msg, website: 'spam.example' }, site)).status, 200);
  assert.equal(emails.length, before);

  const sent = await post('/api/v1/contact', msg, site);
  assert.equal(sent.status, 201);
  assert.match(sent.body.message, /Thanks/);
  const fwd = lastEmailTo('owner@webvieu.test');
  assert.equal(fwd.reply_to, 'asha@example.com', 'Reply goes to the sender');
  assert.match(fwd.subject, /API plans & sales: message from Asha/);
  assert.match(fwd.text, /annual billing/);
  // Unknown topics fall back to the default one.
  await post('/api/v1/contact', { ...msg, topic: '<script>' }, site);
  assert.match(lastEmailTo('owner@webvieu.test').subject, /General question/);
  // Accepted messages (and bot hits) count toward the limit: 5 per hour in production, 3 here.
  assert.equal((await post('/api/v1/contact', msg, site)).status, 429);
  assert.equal((await post('/api/v1/contact', msg, { ...site, 'x-forwarded-for': '198.51.100.21' })).status, 201, 'other visitors unaffected');
  // Outsiders without the website's headers can't post.
  assert.equal((await post('/api/v1/contact', msg, {})).status, 401);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'messages.json'), 'utf8')).messages;
  assert.equal(saved.at(-1).email, 'asha@example.com');
});

test('paid API responses never include website-only data', async () => {
  const target = `localhost:${sitePort}`;
  const site = { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.31' };
  const web = await get(`/api/v1/analyze/${target}?fresh=1`, site);
  for (const k of ['rank', 'traffic', 'domainInfo']) assert.ok(k in web.body, `website report has ${k}`);
  assert.equal(web.body.dataScope, undefined);

  const apiRep = await get(`/api/v1/analyze/${target}`);
  for (const k of ['rank', 'traffic', 'domainInfo']) assert.ok(!(k in apiRep.body), `API report has no ${k}`);
  assert.equal(apiRep.body.dataScope.mode, 'api');
  assert.deepEqual(apiRep.body.dataScope.excluded, ['popularity', 'registration', 'archive']);
  assert.ok(apiRep.body.tech.count > 0, 'own analysis is still there');
  assert.ok(apiRep.body.seo && apiRep.body.security && apiRep.body.performance);
  // Even ?fields= can't reach them.
  assert.deepEqual(Object.keys((await get(`/api/v1/analyze/${target}?fields=rank,traffic,scores`)).body).sort(), ['domain', 'scores']);

  const csvHead = (await get(`/api/v1/analyze/${target}?format=csv`)).body.split('\n')[0];
  for (const col of ['tranco_rank', 'est_monthly_visits', 'domain_created', 'registrar', 'first_archived']) assert.ok(!csvHead.includes(col), col);
  assert.match((await get(`/api/v1/analyze/${target}?format=csv`, site)).body.split('\n')[0], /tranco_rank/);

  const sum = await get(`/api/v1/summary/${target}`);
  assert.ok(!('rank' in sum.body) && !('monthlyVisits' in sum.body) && !('traffic' in sum.body));

  const cmp = await get(`/api/v1/compare?domains=${target},${target}`);
  for (const k of ['rank', 'monthlyVisits', 'traffic', 'domainAge', 'firstSeen', 'rankHistory']) assert.ok(!(k in cmp.body.sites[0]), k);

  for (const p of ['/api/v1/rank/example.com', '/api/v1/top']) {
    const r = await get(p);
    assert.equal(r.status, 403, p);
    assert.equal(r.body.code, 'website_only');
  }
  assert.equal((await get('/api/v1/rank/example.com', site)).status, 200, 'the website still gets rank');

  const lb = await get('/api/v1/leaderboard?sort=rank');
  assert.equal(lb.body.sort, 'score');
  assert.ok(lb.body.sites.every((x) => !('rank' in x)));

  const job = await post('/api/v1/bulk', { domains: [target] });
  const done = await until(async () => { const r = await get(job.body.poll); return r.body.status === 'completed' && r.body; });
  assert.ok(!('rank' in done.results[0]) && !('monthlyVisits' in done.results[0]));
  assert.doesNotMatch((await get(`${job.body.poll}?format=csv`)).body.split('\n')[0], /tranco_rank/);

  const status = await get('/api/v1/status');
  assert.equal(status.body.dataPolicy.websiteOnly.length, 3);
});
