// Spins up a local fixture website and the SiteLens server, then exercises the API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const html = fs.readFileSync(new URL('./fixtures/shop.html', import.meta.url));
let site;
let server;
let sitePort;
let apiPort;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitelens-test-'));

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

  const probe = http.createServer();
  apiPort = await listen(probe);
  await new Promise((r) => probe.close(r));
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', SITELENS_ALLOW_PRIVATE: '1', SITELENS_OFFLINE: '1', SITELENS_DATA_DIR: dataDir, SITELENS_ANON_PER_HOUR: '10' },
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
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const get = async (p) => {
  const res = await fetch(`http://127.0.0.1:${apiPort}${p}`);
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

test('rate limit applies per hour for analyses', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await get(`/api/v1/summary/localhost:${sitePort}`);
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('x-ratelimit-remaining'), '0');
});
