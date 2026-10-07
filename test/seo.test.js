// SEO: clean URLs, prerendered pages, structured data and crawler files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPath, parsePath } from '../public/shared/routes.js';
import { renderPage, renderShell, renderSitemap, renderRobots, renderLlms, sitemapEntries } from '../src/prerender.js';
import { POPULAR_DOMAINS } from '../public/shared/seo.js';
import { extractPage } from '../src/html.js';
import { seoAudit } from '../src/audits.js';

const SITE = 'https://example.github.io/Repo/';
const opts = { siteUrl: SITE, backend: false };
const pick = (html, re) => html.match(re)?.[1];
const jsonLd = (html) => JSON.parse(pick(html, /<script type="application\/ld\+json">(.*?)<\/script>/));

test('clean URL helpers map old hash links and reject non-pages', () => {
  assert.equal(toPath('#/'), '');
  assert.equal(toPath('#/pricing'), 'pricing/');
  assert.equal(toPath('#/site/github.com'), 'site/github.com/');
  assert.equal(toPath('#/login?next=buy:pro'), 'login/?next=buy:pro');
  assert.equal(toPath('#/top/score'), 'rankings/score/');
  assert.equal(toPath('#/api'), 'api-docs/');
  assert.deepEqual(parsePath('site/github.com/'), { view: 'site', arg: 'github.com' });
  assert.deepEqual(parsePath(''), { view: '', arg: '' });
  assert.equal(parsePath('styles.css'), null);
  assert.equal(parsePath('api/v1/status'), null);
  assert.equal(parsePath('pricing/extra'), null);
});

test('every listed page prerenders with unique metadata, one H1 and real content', async () => {
  const titles = new Set();
  for (const { path } of sitemapEntries({ backend: false })) {
    const r = await renderPage(path, opts);
    assert.equal(r.status, 200, path);
    const title = pick(r.html, /<title>(.*?)<\/title>/);
    const desc = pick(r.html, /<meta name="description" content="([^"]*)"/);
    assert.ok(title && title.length <= 75, `${path} title length ${title?.length}`);
    assert.ok(!titles.has(title), `${path} duplicate title`);
    titles.add(title);
    assert.ok(desc.length >= 50 && desc.length <= 170, `${path} description length ${desc.length}`);
    assert.equal(pick(r.html, /<link rel="canonical" href="([^"]*)"/), SITE + path);
    assert.match(r.html, /<meta name="robots" content="index,follow/);
    const main = pick(r.html, /<main[^>]*>([\s\S]*)<\/main>/);
    assert.equal((main.match(/<h1[\s>]/g) || []).length, 1, `${path} has one h1`);
    assert.doesNotMatch(r.html, /href="#\//, `${path} has no hash links left`);
    assert.ok(jsonLd(r.html)['@graph'].length > 0, `${path} structured data`);
  }
});

test('home page passes Webvieu’s own SEO audit', async () => {
  const { html } = await renderPage('', opts);
  const extract = extractPage(html, SITE);
  const audit = seoAudit({ page: { status: 200, finalUrl: SITE, headers: {} }, extract, files: { robots: { rules: 2 }, sitemap: { urls: 60 } } });
  const failed = audit.checks.filter((c) => c.pass === false).map((c) => c.id);
  assert.deepEqual(failed, [], `failed checks: ${failed.join(', ')}`);
  assert.ok(audit.score >= 95, `score ${audit.score}`);
});

test('structured data: organization, FAQ answers and breadcrumbs', async () => {
  const graph = (r) => jsonLd(r.html)['@graph'];
  const types = (r) => graph(r).map((n) => n['@type']);
  const home = await renderPage('', opts);
  assert.deepEqual(types(home), ['Organization', 'WebSite', 'WebApplication', 'WebPage']);
  assert.equal(graph(home)[1].potentialAction.target.urlTemplate, `${SITE}site/{domain}/`);
  const faq = graph(await renderPage('faq/', opts))[0];
  assert.equal(faq['@type'], 'FAQPage');
  assert.ok(faq.mainEntity.length >= 15 && faq.mainEntity.every((q) => q.name && q.acceptedAnswer.text));
  const site = graph(await renderPage('site/github.com/', opts))[0];
  assert.deepEqual(site.breadcrumb.itemListElement.map((i) => i.name), ['Home', 'github.com']);
  assert.equal(site.about.url, 'https://github.com/');
});

test('report pages: popular sites indexed, others noindex; server data shows up', async () => {
  const popular = await renderPage('site/github.com/', opts);
  assert.match(popular.html, /<title>github\.com Traffic, Rank &amp; Tech Stack · Webvieu<\/title>/);
  assert.match(popular.html, /How much traffic does github\.com get\?/);
  const other = await renderPage('site/some-small-site.com/', opts);
  assert.match(other.html, /content="noindex,follow"/);
  const index = { get: (d) => (d === 'some-small-site.com' ? { domain: d, rank: 54321, monthlyVisits: 300000, tech: ['WordPress', 'Cloudflare'], scores: { overall: 80, performance: 70, seo: 90, security: 85 }, analyzedAt: '2026-10-01T00:00:00Z' } : null), leaderboard: () => [] };
  const known = await renderPage('site/some-small-site.com/', { ...opts, backend: true, index });
  assert.match(known.html, /content="index,follow/);
  assert.match(known.html, /#54,321/);
  assert.match(known.html, /WordPress, Cloudflare/);
  assert.equal((await renderPage('site/<script>/', opts)).status, 404);
  assert.deepEqual(await renderPage('about', opts), { redirect: '/Repo/about/' });
});

test('lite builds hide server-only pages; 404 shell is noindex', async () => {
  assert.equal((await renderPage('rankings/', opts)).status, 404);
  assert.equal((await renderPage('rankings/', { ...opts, backend: true })).status, 200);
  const home = (await renderPage('', opts)).html;
  assert.match(home, /href="\/Repo\/rankings\/" data-needs-server hidden/);
  assert.match(home, /href="\/Repo\/styles\.css"/);
  const shell = renderShell(opts);
  assert.match(shell, /content="noindex,follow"/);
  assert.doesNotMatch(shell, /rel="canonical"/);
});

test('sitemap, robots.txt and llms.txt', () => {
  const xml = renderSitemap({ siteUrl: SITE, backend: false });
  assert.match(xml, /<loc>https:\/\/example\.github\.io\/Repo\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.github\.io\/Repo\/methodology\/<\/loc>/);
  assert.doesNotMatch(xml, /rankings|api-docs/);
  assert.equal((xml.match(/\/site\//g) || []).length, POPULAR_DOMAINS.length);
  const robots = renderRobots({ siteUrl: SITE, backend: true });
  assert.match(robots, /User-agent: GPTBot/);
  assert.match(robots, /User-agent: ClaudeBot/);
  assert.match(robots, /Disallow: \/Repo\/api\/v1\//);
  assert.match(robots, /Sitemap: https:\/\/example\.github\.io\/Repo\/sitemap\.xml/);
  const llms = renderLlms({ siteUrl: SITE, backend: false });
  assert.match(llms, /^# Webvieu\n\n> /);
  assert.match(llms, /rank\^-1\.15/);
  assert.match(llms, /\[Methodology\]\(https:\/\/example\.github\.io\/Repo\/methodology\/\)/);
});
