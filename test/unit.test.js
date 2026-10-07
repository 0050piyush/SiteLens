import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHmac } from 'node:crypto';
import { normalizeDomain, registrableDomain, countryFromTld } from '../src/util.js';
import { extractPage, analyzeLinks } from '../src/html.js';
import { detectTechnologies } from '../src/tech.js';
import { parseRobots, parseSitemap, parseAdsTxt } from '../src/external.js';
import { isPrivateAddress, resolvePublic } from '../src/fetcher.js';
import { unzipFirst, visitsForRank, trafficEstimate } from '../src/rank.js';
import { securityAudit } from '../src/audits.js';
import { classify } from '../src/classify.js';
import { Cache } from '../src/store.js';
import { diffSnapshots, signPayload } from '../src/monitors.js';
import { hashPassword, verifyPassword } from '../src/accounts.js';
import { verificationEmail, resetEmail } from '../src/mailer.js';

const html = fs.readFileSync(new URL('./fixtures/shop.html', import.meta.url), 'utf8');

test('normalizeDomain accepts URLs and rejects junk', () => {
  assert.equal(normalizeDomain('https://www.Example.com/path?q=1'), 'www.example.com');
  assert.equal(normalizeDomain('  example.co.uk. '), 'example.co.uk');
  assert.equal(normalizeDomain('bücher.de'), 'xn--bcher-kva.de');
  assert.equal(normalizeDomain('example.com:8080', { allowPort: true }), 'example.com:8080');
  assert.equal(normalizeDomain('example.com:8080'), 'example.com');
  for (const bad of ['', 'nodot', '127.0.0.1', 'exa mple.com', '-bad.com', 'a..b.com']) {
    assert.throws(() => normalizeDomain(bad), /valid domain|required/, bad);
  }
});

test('registrableDomain handles multi-label suffixes', () => {
  assert.equal(registrableDomain('www.shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('blog.github.com'), 'github.com');
  assert.equal(registrableDomain('user.github.io'), 'user.github.io');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(countryFromTld('example.de'), 'Germany');
  assert.equal(countryFromTld('example.com'), null);
});

test('extractPage pulls metadata, headings, links and structured data', () => {
  const e = extractPage(html, 'https://acme-outdoor.example/');
  assert.equal(e.title, 'Acme Outdoor Gear – Shop Tents, Backpacks & Boots');
  assert.equal(e.lang, 'en-US');
  assert.match(e.meta.description, /^Shop durable/);
  assert.equal(e.canonical, 'https://acme-outdoor.example/');
  assert.equal(e.icon, 'https://acme-outdoor.example/favicon.png');
  assert.deepEqual(e.headings.h1, ['Outdoor gear built to last']);
  assert.equal(e.headings.h2.length, 2);
  assert.deepEqual(e.jsonLdTypes.sort(), ['OnlineStore', 'Organization']);
  assert.equal(e.hreflang.length, 4);
  assert.equal(e.images.length, 3);
  assert.ok(!e.anchors.some((a) => a.href.startsWith('mailto:')));
  const blocking = e.scripts.filter((s) => s.inHead && s.src && !s.async && !s.defer);
  assert.equal(blocking.length, 1); // jquery
});

test('analyzeLinks separates internal/external and finds social profiles', () => {
  const e = extractPage(html, 'https://acme-outdoor.example/');
  const l = analyzeLinks(e.anchors, 'acme-outdoor.example', registrableDomain);
  assert.equal(l.internal, 4);
  assert.deepEqual(l.social.map((s) => s.network).sort(), ['Instagram', 'X / Twitter', 'YouTube']); // share link skipped
  const partner = l.topOutbound.find((o) => o.domain === 'example.org');
  assert.deepEqual([partner.links, partner.nofollow, partner.sponsored], [2, 1, 1]);
});

test('detectTechnologies fingerprints html, scripts, headers, cookies and meta', () => {
  const e = extractPage(html, 'https://acme-outdoor.example/');
  const t = detectTechnologies({
    html,
    headers: { server: 'nginx/1.25.3', 'x-powered-by': 'PHP/8.2.1', 'cf-ray': 'abc' },
    cookies: ['PHPSESSID'],
    scriptSrcs: e.scripts.map((s) => s.src).filter(Boolean),
    meta: e.meta,
  });
  const names = Object.fromEntries(t.list.map((x) => [x.name, x]));
  for (const n of ['WordPress', 'WooCommerce', 'Google Analytics 4', 'Meta Pixel', 'Stripe', 'Hotjar', 'OneTrust', 'jQuery', 'Cloudflare', 'Nginx', 'PHP']) {
    assert.ok(names[n], `expected ${n}`);
  }
  assert.equal(names.WordPress.version, '6.5.2');
  assert.equal(names.Nginx.version, '1.25.3');
  assert.ok(!names['Google Analytics'], 'generic GA folded into GA4');
  assert.ok(!names.Shopify);
  assert.equal(t.byCategory.CMS[0].name, 'WordPress');
});

test('parseRobots reads groups, sitemaps and AI-bot blocks', () => {
  const r = parseRobots('User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nSitemap: https://x.com/sm.xml');
  assert.deepEqual(r.sitemaps, ['https://x.com/sm.xml']);
  assert.equal(r.blocksEverything, false);
  const blocked = r.aiBots.filter((b) => b.blocked).map((b) => b.bot);
  assert.deepEqual(blocked, ['GPTBot', 'CCBot']);
  const all = parseRobots('User-agent: *\nDisallow: /');
  assert.ok(all.blocksEverything);
  assert.ok(all.aiBots.every((b) => b.blocked));
});

test('parseSitemap and parseAdsTxt', () => {
  const s = parseSitemap('<urlset><url><loc>https://a/1</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://a/2</loc></url></urlset>');
  assert.deepEqual([s.isIndex, s.urls, s.latestUpdate], [false, 2, '2026-01-02']);
  const idx = parseSitemap('<sitemapindex><sitemap><loc>https://a/s1.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual([idx.isIndex, idx.children], [true, 1]);
  const ads = parseAdsTxt('# comment\ngoogle.com, pub-1, DIRECT, f08c\ngoogle.com, pub-2, RESELLER\nopenx.com, 5, DIRECT\nnot a line');
  assert.deepEqual([ads.sellers, ads.direct, ads.reseller], [3, 2, 1]);
  assert.deepEqual(ads.topSystems[0], { domain: 'google.com', count: 2 });
});

test('SSRF guard blocks private and metadata addresses', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '140.82.113.4', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  const prev = process.env.SITELENS_ALLOW_PRIVATE;
  delete process.env.SITELENS_ALLOW_PRIVATE;
  await assert.rejects(resolvePublic('localhost'), /private address/);
  if (prev !== undefined) process.env.SITELENS_ALLOW_PRIVATE = prev;
});

test('unzipFirst reads a deflated zip entry', () => {
  const content = Buffer.from('1,google.com\n2,youtube.com\n');
  const comp = zlib.deflateRawSync(content);
  const name = Buffer.from('top-1m.csv');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, comp, central, name, eocd]);
  assert.equal(unzipFirst(zip).toString(), content.toString());
});

test('traffic model is monotonic and refuses to guess for unranked sites', () => {
  assert.ok(visitsForRank(1) > visitsForRank(10));
  assert.ok(visitsForRank(1000) > 1e7 && visitsForRank(1000) < 1e8);
  assert.equal(trafficEstimate(null).available, false);
  const est = trafficEstimate({ rank: 500, history: [{ date: '2026-09-01', rank: 600 }, { date: '2026-09-30', rank: 500 }] });
  assert.ok(est.available && est.low < est.monthlyVisits && est.monthlyVisits < est.high);
  assert.ok(est.trendPct > 0);
});

test('securityAudit rewards good headers', () => {
  const page = {
    finalUrl: 'https://x.com/',
    httpRedirectsToHttps: true,
    headers: {
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=()',
    },
  };
  const tls = { authorized: true, daysRemaining: 60, protocol: 'TLSv1.3', issuer: 'X' };
  const dns = { spf: 'v=spf1 -all', dmarcPolicy: 'reject', dmarc: 'v=DMARC1; p=reject', caa: [{ issue: 'letsencrypt.org' }] };
  const good = securityAudit({ page, tls, dns, files: { securityTxt: { contact: 'x' } } });
  assert.equal(good.score, 100);
  const bad = securityAudit({ page: { finalUrl: 'http://x.com/', headers: { server: 'Apache/2.4.1' } }, tls: null, dns, files: null });
  assert.ok(bad.score < 40);
});

test('classify picks e-commerce for a shop page', () => {
  const e = extractPage(html, 'https://acme-outdoor.example/');
  assert.equal(classify(e, { list: [{ category: 'Payments' }] }).primary, 'E-commerce & Shopping');
});

test('Cache evicts least recently used and expired entries', () => {
  const c = new Cache({ max: 2, ttlMs: 1000 });
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('b'), null);
  assert.equal(c.get('a'), 1);
  const short = new Cache({ ttlMs: -1 });
  short.set('x', 1);
  assert.equal(short.get('x'), null);
});

test('diffSnapshots reports meaningful changes only', () => {
  const base = { reachable: true, title: 'Shop', rank: 1000, scores: { overall: 70, performance: 80, seo: 60, security: 50 }, tech: ['React', 'Stripe'], hosting: 'AWS', tlsIssuer: 'LE', tlsDaysRemaining: 60 };
  assert.deepEqual(diffSnapshots(null, base), [], 'no alert for the baseline');
  assert.deepEqual(diffSnapshots(base, { ...base, rank: 1040, scores: { ...base.scores, overall: 73 } }), [], 'small moves are ignored');
  const changed = diffSnapshots(base, {
    ...base, rank: 700, scores: { ...base.scores, security: 80 }, tech: ['React', 'Shopify'], hosting: 'Cloudflare', tlsDaysRemaining: 10,
  });
  const fields = changed.map((c) => c.field);
  for (const f of ['rank', 'scores.security', 'tech.added', 'tech.removed', 'hosting', 'tls.expiring']) assert.ok(fields.includes(f), f);
  assert.match(changed.find((c) => c.field === 'rank').message, /rose from #1000 to #700/);
  const down = diffSnapshots(base, { ...base, reachable: false });
  assert.deepEqual(down.map((c) => c.field), ['reachable']);
  const body = '{"event":"site.changed"}';
  assert.equal(signPayload('secret', body), `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`);
  assert.notEqual(signPayload('other', body), signPayload('secret', body));
});

test('password hashing and email templates', () => {
  const stored = hashPassword('correct horse');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(verifyPassword('correct horse', stored));
  assert.ok(!verifyPassword('wrong horse', stored));
  assert.ok(!verifyPassword('x', 'garbage'));
  const link = 'https://x.example/#/reset?token=abc&a=<b>';
  const r = resetEmail(link);
  assert.match(r.text, /expires in 1 hour/);
  assert.ok(r.html.includes('&lt;b&gt;') && !r.html.includes('<b>'), 'links are escaped in HTML');
  assert.match(verificationEmail('https://x').subject, /Confirm/);
});
