// Spins up a local fixture website and the SiteLens server, then exercises the API.
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
      SITELENS_API_KEYS: `${KEY}:business,other-key,quota-key:starter,mon-key:starter`, SITELENS_ALLOWED_ORIGINS: 'https://sitelens.example.github.io/',
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
  const pages = await get(target, { origin: 'https://sitelens.example.github.io' });
  assert.equal(pages.status, 200);
  assert.equal(pages.headers.get('access-control-allow-origin'), 'https://sitelens.example.github.io');
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
  assert.equal(hook.headers['x-sitelens-event'], 'monitor.test');
  const expected = `sha256=${createHmac('sha256', created.body.secret).update(hook.body).digest('hex')}`;
  assert.equal(hook.headers['x-sitelens-signature'], expected, 'webhook signature verifies');

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
