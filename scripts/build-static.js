#!/usr/bin/env node
// Builds the site for a static host (GitHub Pages) with every page
// prerendered as real HTML, plus sitemap.xml, robots.txt, llms.txt and 404.html.
//
//   node scripts/build-static.js --out _site --site-url https://user.github.io/Repo/ [--version abc123]
//
// Search-console verification tags come from SITELENS_GOOGLE_VERIFICATION and
// SITELENS_BING_VERIFICATION when set.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderPage, renderShell, renderSitemap, renderRobots, renderLlms, sitemapEntries } from '../src/prerender.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const out = path.resolve(args.out || '_site');
const siteUrl = String(args['site-url'] || '').replace(/\/?$/, '/');
const version = args.version || '';
if (!/^https?:\/\/[^/]+\//.test(siteUrl)) {
  console.error('Pass --site-url, the public URL of the site (e.g. https://user.github.io/Repo/)');
  process.exit(1);
}

const { API_BASE, CONTACT } = await import(pathToFileURL(path.join(PUBLIC, 'config.js')).href);
const backend = !!API_BASE;
const opts = { siteUrl, backend, contact: CONTACT, version };

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(PUBLIC, out, { recursive: true });

// Fresh module URLs on every deploy, so browsers never mix new and cached scripts.
if (version) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(out).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, src.replace(/(from '\.{1,2}\/[^'?]+\.js)'/g, `$1?v=${version}'`));
  }
}

const write = (rel, body) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

const paths = sitemapEntries({ backend }).map((e) => e.path);
if (backend) paths.push('login/', 'account/', 'forgot/', 'reset/', 'verify/');
for (const p of paths) {
  const r = await renderPage(p, opts);
  if (r.status !== 200) throw new Error(`${p} rendered with status ${r.status}`);
  write(path.join(p, 'index.html'), r.html);
}
write('404.html', renderShell(opts));
write('sitemap.xml', renderSitemap({ siteUrl, backend }));
write('robots.txt', renderRobots({ siteUrl, backend }));
write('llms.txt', renderLlms({ siteUrl, backend }));
write('.nojekyll', '');
console.log(`Built ${paths.length} pages for ${siteUrl} into ${path.relative(ROOT, out) || out} (${backend ? 'with API server' : 'lite mode'})`);
