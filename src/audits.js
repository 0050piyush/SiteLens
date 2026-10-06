import { clamp, grade } from './util.js';

// Each audit returns { score, grade, checks: [{ id, label, pass, weight, detail }] }.
// `pass` is true / false / null (not applicable). Score = weighted pass share.

function summarize(checks) {
  let total = 0;
  let got = 0;
  for (const c of checks) {
    if (c.pass === null) continue;
    total += c.weight;
    if (c.pass === true) got += c.weight;
    else if (typeof c.pass === 'number') got += c.weight * c.pass; // partial credit 0..1
  }
  const score = total ? Math.round((got / total) * 100) : 0;
  return {
    score,
    grade: grade(score),
    passed: checks.filter((c) => c.pass === true || (typeof c.pass === 'number' && c.pass >= 0.75)).length,
    failed: checks.filter((c) => c.pass === false || (typeof c.pass === 'number' && c.pass < 0.75)).length,
    checks,
  };
}

const check = (id, label, pass, weight, detail) => ({ id, label, pass, weight, detail });

export function securityAudit({ page, tls, dns, files }) {
  const h = page?.headers || {};
  const https = page?.finalUrl?.startsWith('https://');
  const hsts = h['strict-transport-security'];
  const hstsAge = Number(/max-age=(\d+)/i.exec(hsts || '')?.[1] || 0);
  const csp = h['content-security-policy'];
  const serverLeak = /\d+\.\d+/.test(h.server || '') || !!h['x-powered-by'];
  const checks = [
    check('https', 'Serves over HTTPS', !!https, 15, https ? 'Final URL uses HTTPS' : 'Site does not end on HTTPS'),
    check('http-redirect', 'Redirects HTTP to HTTPS', page?.httpRedirectsToHttps ?? null, 6,
      page?.httpRedirectsToHttps == null ? null : page.httpRedirectsToHttps ? 'http:// upgrades to https://' : 'http:// version does not redirect to https://'),
    check('cert-valid', 'Valid, trusted certificate', tls && !tls.error ? tls.authorized : (https ? false : null), 15,
      tls?.authorizationError || (tls?.authorized ? `Issued by ${tls.issuer}` : tls?.error)),
    check('cert-expiry', 'Certificate not expiring within 14 days', tls && !tls.error ? tls.daysRemaining > 14 : null, 5,
      tls?.daysRemaining != null ? `${tls.daysRemaining} days remaining` : null),
    check('tls13', 'TLS 1.3 supported', tls && !tls.error ? tls.protocol === 'TLSv1.3' : null, 5, tls?.protocol),
    check('hsts', 'HSTS enabled (≥ 6 months)', hsts ? (hstsAge >= 15552000 ? true : 0.5) : false, 10,
      hsts ? `${hsts}${/preload/i.test(hsts) ? ' (preload)' : ''}` : 'No Strict-Transport-Security header'),
    check('csp', 'Content-Security-Policy', csp ? (/unsafe-inline|unsafe-eval/.test(csp) ? 0.6 : true) : (h['content-security-policy-report-only'] ? 0.3 : false), 10,
      csp ? `${csp.length} chars${/unsafe-inline|unsafe-eval/.test(csp) ? ', allows unsafe-inline/eval' : ''}` : 'Not set'),
    check('xcto', 'X-Content-Type-Options: nosniff', /nosniff/i.test(h['x-content-type-options'] || ''), 5, h['x-content-type-options'] || 'Not set'),
    check('framing', 'Clickjacking protection', !!h['x-frame-options'] || /frame-ancestors/i.test(csp || ''), 6,
      h['x-frame-options'] ? `X-Frame-Options: ${h['x-frame-options']}` : (/frame-ancestors/i.test(csp || '') ? 'CSP frame-ancestors' : 'Not set')),
    check('referrer', 'Referrer-Policy', !!h['referrer-policy'], 4, h['referrer-policy'] || 'Not set'),
    check('permissions', 'Permissions-Policy', !!h['permissions-policy'], 3, h['permissions-policy'] ? 'Set' : 'Not set'),
    check('server-leak', 'No server version disclosure', !serverLeak, 3,
      serverLeak ? [h.server, h['x-powered-by']].filter(Boolean).join(' / ') : 'Versions hidden'),
    check('spf', 'SPF record', dns && !dns.error ? !!dns.spf : null, 4, dns?.spf || 'None'),
    check('dmarc', 'DMARC enforcing (quarantine/reject)', dns && !dns.error ? (dns.dmarcPolicy ? (/reject|quarantine/i.test(dns.dmarcPolicy) ? true : 0.4) : false) : null, 5,
      dns?.dmarc || 'None'),
    check('caa', 'CAA record restricts certificate issuers', dns && !dns.error ? dns.caa.length > 0 : null, 2,
      dns?.caa?.length ? dns.caa.map((c) => c.issue || c.issuewild || c.iodef).filter(Boolean).join(', ') : 'None'),
    check('securitytxt', 'security.txt published', files ? !!files.securityTxt : null, 2,
      files?.securityTxt ? '/.well-known/security.txt' : 'Not found'),
  ];
  return summarize(checks);
}

export function seoAudit({ page, extract, files }) {
  const e = extract;
  if (!e) return summarize([check('reachable', 'Homepage reachable', false, 100, 'Could not load the homepage')]);
  const titleLen = e.title?.length || 0;
  const desc = e.meta.description || e.meta['og:description'];
  const descLen = desc?.length || 0;
  const h1 = e.headings.h1.length;
  const imgs = e.images.length;
  const withAlt = e.images.filter((i) => i.alt != null && i.alt.trim() !== '').length;
  const robotsMeta = (e.meta.robots || '') + ' ' + (page?.headers?.['x-robots-tag'] || '');
  const ogTags = ['og:title', 'og:description', 'og:image'].filter((k) => e.meta[k]).length;
  const checks = [
    check('status', 'Homepage returns 200', page?.status === 200, 10, `HTTP ${page?.status}`),
    check('indexable', 'Indexable (no noindex)', !/noindex/i.test(robotsMeta), 10, robotsMeta.trim() || 'No robots directives'),
    check('title', 'Title tag 10–65 chars', titleLen ? (titleLen >= 10 && titleLen <= 65 ? true : 0.5) : false, 10,
      e.title ? `"${e.title}" (${titleLen})` : 'Missing'),
    check('description', 'Meta description 50–165 chars', descLen ? (descLen >= 50 && descLen <= 165 ? true : 0.5) : false, 8,
      desc ? `${descLen} chars` : 'Missing'),
    check('h1', 'Exactly one H1', h1 === 1 ? true : h1 > 1 ? 0.5 : false, 6, h1 ? `${h1} H1: "${e.headings.h1[0].slice(0, 70)}"` : 'No H1'),
    check('canonical', 'Canonical URL', !!e.canonical, 5, e.canonical || 'Missing'),
    check('lang', 'Language declared', !!e.lang, 4, e.lang || 'Missing <html lang>'),
    check('viewport', 'Mobile viewport', /width=device-width/.test(e.meta.viewport || ''), 7, e.meta.viewport || 'Missing'),
    check('og', 'Open Graph tags', ogTags === 3 ? true : ogTags / 3, 5, `${ogTags}/3 (title, description, image)`),
    check('twitter', 'Twitter/X card', !!e.meta['twitter:card'], 2, e.meta['twitter:card'] || 'Missing'),
    check('schema', 'Structured data (JSON-LD)', e.jsonLdTypes.length > 0, 6, e.jsonLdTypes.join(', ') || 'None'),
    check('alt', 'Images have alt text', imgs ? withAlt / imgs : null, 5, imgs ? `${withAlt}/${imgs} images` : 'No images'),
    check('content', 'Enough indexable text (≥ 250 words)', e.wordCount >= 250 ? true : e.wordCount / 250, 5, `${e.wordCount} words`),
    check('robots', 'robots.txt present', files ? !!files.robots : null, 4, files?.robots ? `${files.robots.rules} rules` : 'Not found'),
    check('sitemap', 'XML sitemap', files ? !!files.sitemap : null, 5,
      files?.sitemap ? `${files.sitemap.url} (${files.sitemap.urls ?? '?'} URLs${files.sitemap.isIndex ? `, ${files.sitemap.children} sub-sitemaps` : ''})` : 'Not found'),
    check('favicon', 'Favicon', !!e.icon, 2, e.icon ? 'Declared' : 'Not declared in <head>'),
    check('https', 'HTTPS', page?.finalUrl?.startsWith('https://'), 4, page?.finalUrl),
    check('internal-links', 'Internal linking (≥ 10 links)', e.anchors.length >= 10, 3, `${e.anchors.length} links on homepage`),
    check('hreflang', 'hreflang for international versions', e.hreflang.length ? true : null, 1, e.hreflang.length ? `${e.hreflang.length} alternates` : null),
    check('amp-pwa', 'Web app manifest', !!e.manifest, 1, e.manifest ? 'Present' : 'None'),
  ];
  return summarize(checks);
}

export function performanceAudit({ page, extract, tls }) {
  if (!page || page.error) return summarize([check('reachable', 'Homepage reachable', false, 100, page?.error)]);
  const t = page.timings || {};
  const ttfb = t.ttfb ?? page.totalMs;
  const htmlKb = page.bytes / 1024;
  const blocking = extract ? extract.scripts.filter((s) => s.inHead && s.src && !s.async && !s.defer && !s.module).length : 0;
  const extScripts = extract ? extract.scripts.filter((s) => s.src).length : 0;
  const lazy = extract ? extract.images.filter((i) => i.loading === 'lazy').length : 0;
  const imgs = extract?.images.length || 0;
  const thirdPartyHosts = extract
    ? new Set(extract.scripts.filter((s) => s.src).map((s) => { try { return new URL(s.src).hostname; } catch { return ''; } })
      .filter((hn) => hn && hn !== new URL(page.finalUrl).hostname)).size
    : 0;
  const cc = page.headers['cache-control'] || '';
  const checks = [
    check('ttfb', 'Server response time (TTFB)', ttfb <= 200 ? true : ttfb >= 1800 ? 0 : clamp(1 - (ttfb - 200) / 1600, 0, 1), 25, `${ttfb} ms`),
    check('redirects', 'Few redirects', page.redirects.length <= 1 ? true : page.redirects.length === 2 ? 0.5 : false, 8,
      `${page.redirects.length} redirect(s)`),
    check('compression', 'Text compression (gzip/brotli)', page.encoding ? true : false, 10, page.encoding || 'Uncompressed'),
    check('html-size', 'HTML size under 150 KB', htmlKb <= 150 ? true : htmlKb >= 600 ? 0 : clamp(1 - (htmlKb - 150) / 450, 0, 1), 10,
      `${htmlKb.toFixed(1)} KB (${(page.transferBytes / 1024).toFixed(1)} KB transferred)`),
    check('http2', 'HTTP/2 or HTTP/3', tls && !tls.error ? (tls.http2 || /h3/.test(page.headers['alt-svc'] || '')) : null, 10,
      tls?.alpn ? `ALPN: ${tls.alpn}${/h3/.test(page.headers['alt-svc'] || '') ? ', h3 advertised' : ''}` : null),
    check('render-blocking', 'No render-blocking scripts in <head>', blocking === 0 ? true : blocking <= 2 ? 0.5 : false, 10, `${blocking} blocking script(s)`),
    check('script-count', 'Moderate script count (≤ 20)', extScripts <= 20 ? true : extScripts >= 50 ? 0 : clamp(1 - (extScripts - 20) / 30, 0, 1), 8,
      `${extScripts} external scripts`),
    check('third-party', 'Limited third-party origins (≤ 8)', thirdPartyHosts <= 8 ? true : thirdPartyHosts >= 20 ? 0 : clamp(1 - (thirdPartyHosts - 8) / 12, 0, 1), 7,
      `${thirdPartyHosts} third-party script hosts`),
    check('lazy-images', 'Lazy-loads images', imgs > 4 ? (lazy / imgs >= 0.3 ? true : lazy > 0 ? 0.5 : false) : null, 5, `${lazy}/${imgs} lazy`),
    check('cache', 'Cache-Control header', !!cc, 4, cc || 'Not set'),
    check('preconnect', 'Resource hints (preconnect/dns-prefetch)', extract ? extract.preconnect.length > 0 : null, 3,
      extract ? `${extract.preconnect.length} hint(s)` : null),
  ];
  return { ...summarize(checks), metrics: { ttfb, ...t, totalMs: page.totalMs, htmlKb: Math.round(htmlKb * 10) / 10, extScripts, thirdPartyHosts, blocking } };
}
