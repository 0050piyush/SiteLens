import { decodeEntities } from './util.js';

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttrs(str) {
  const attrs = {};
  if (!str) return attrs;
  for (const m of str.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function tags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  return [...html.matchAll(re)].map((m) => parseAttrs(m[1]));
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Pulls everything the analyzers need out of a page with plain regexes: fast,
 * dependency-free, and tolerant of broken markup.
 */
export function extractPage(html, baseUrl) {
  const base = new URL(baseUrl);
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const headEnd = noComments.search(/<\/head>|<body\b/i);
  const head = headEnd > 0 ? noComments.slice(0, headEnd) : noComments.slice(0, 20000);

  const title = stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(noComments)?.[1] || '') || null;
  const htmlAttrs = parseAttrs(/<html\b([^>]*)>/i.exec(noComments)?.[1]);

  const meta = {};
  for (const a of tags(noComments, 'meta')) {
    const key = (a.name || a.property || a['http-equiv'] || a.itemprop || '').toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = a.content.trim();
    if (a.charset) meta.charset = a.charset;
  }

  const links = tags(noComments, 'link');
  const relOf = (l) => (l.rel || '').toLowerCase().split(/\s+/);
  const abs = (href) => { try { return new URL(href, base).href; } catch { return null; } };
  const canonical = links.find((l) => relOf(l).includes('canonical'))?.href;
  const icon = links.find((l) => relOf(l).some((r) => r === 'icon' || r === 'apple-touch-icon'))?.href;
  const hreflang = links
    .filter((l) => relOf(l).includes('alternate') && l.hreflang)
    .map((l) => ({ lang: l.hreflang.toLowerCase(), href: abs(l.href) }));
  const manifest = links.find((l) => relOf(l).includes('manifest'))?.href;
  const feeds = links
    .filter((l) => relOf(l).includes('alternate') && /rss|atom/i.test(l.type || ''))
    .map((l) => abs(l.href)).filter(Boolean);
  const preconnect = links.filter((l) => relOf(l).some((r) => r === 'preconnect' || r === 'dns-prefetch')).map((l) => l.href);

  // Scripts: external sources, and whether head scripts block rendering.
  const scripts = [];
  for (const m of noComments.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const a = parseAttrs(m[1]);
    scripts.push({
      src: a.src ? abs(a.src) : null,
      type: a.type || null,
      async: 'async' in a,
      defer: 'defer' in a,
      module: a.type === 'module',
      inHead: m.index < headEnd,
      inline: a.src ? null : m[2],
    });
  }
  const stylesheets = links.filter((l) => relOf(l).includes('stylesheet')).map((l) => abs(l.href)).filter(Boolean);

  const jsonLdTypes = new Set();
  for (const s of scripts) {
    if (s.type === 'application/ld+json' && s.inline) {
      for (const t of s.inline.matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
        for (const v of t[1].matchAll(/"([^"]+)"/g)) jsonLdTypes.add(v[1]);
      }
    }
  }

  const headings = {};
  for (const level of [1, 2, 3, 4, 5, 6]) {
    headings[`h${level}`] = [...noComments.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, 'gi'))]
      .map((m) => stripTags(m[1])).filter(Boolean);
  }

  const images = tags(noComments, 'img');
  const anchors = [];
  for (const m of noComments.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = parseAttrs(m[1]);
    if (!a.href || /^(javascript:|mailto:|tel:|#)/i.test(a.href)) continue;
    const href = abs(a.href);
    if (!href) continue;
    anchors.push({ href, rel: (a.rel || '').toLowerCase(), text: stripTags(m[2]).slice(0, 80) });
  }

  const bodyText = stripTags(
    noComments
      .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' '),
  );
  const words = bodyText ? bodyText.split(/\s+/).filter((w) => /\p{L}/u.test(w)) : [];

  return {
    title,
    lang: htmlAttrs.lang || null,
    dir: htmlAttrs.dir || null,
    meta,
    canonical: canonical ? abs(canonical) : null,
    icon: icon ? abs(icon) : null,
    manifest: manifest ? abs(manifest) : null,
    hreflang,
    feeds,
    preconnect,
    scripts,
    stylesheets,
    jsonLdTypes: [...jsonLdTypes],
    headings,
    images: images.map((i) => ({ src: i.src || i['data-src'] || null, alt: i.alt, loading: i.loading || null })),
    anchors,
    iframes: tags(noComments, 'iframe').map((f) => f.src).filter(Boolean),
    forms: (noComments.match(/<form\b/gi) || []).length,
    inlineStyles: (noComments.match(/<style\b/gi) || []).length,
    wordCount: words.length,
    textSample: bodyText.slice(0, 5000),
    head,
  };
}

const SOCIAL = [
  ['Facebook', /(^|\.)facebook\.com$|(^|\.)fb\.com$/],
  ['X / Twitter', /(^|\.)(twitter|x)\.com$/],
  ['Instagram', /(^|\.)instagram\.com$/],
  ['LinkedIn', /(^|\.)linkedin\.com$/],
  ['YouTube', /(^|\.)youtube\.com$|(^|\.)youtu\.be$/],
  ['TikTok', /(^|\.)tiktok\.com$/],
  ['GitHub', /(^|\.)github\.com$/],
  ['Pinterest', /(^|\.)pinterest\.[a-z.]+$/],
  ['Reddit', /(^|\.)reddit\.com$/],
  ['Discord', /(^|\.)discord\.(gg|com)$/],
  ['Telegram', /(^|\.)t\.me$|(^|\.)telegram\.me$/],
  ['WhatsApp', /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/],
  ['Threads', /(^|\.)threads\.net$/],
  ['Mastodon', /mastodon|(^|\.)mstdn\./],
  ['Bluesky', /(^|\.)bsky\.app$/],
  ['Medium', /(^|\.)medium\.com$/],
  ['Twitch', /(^|\.)twitch\.tv$/],
  ['Snapchat', /(^|\.)snapchat\.com$/],
  ['Tumblr', /(^|\.)tumblr\.com$/],
  ['Vimeo', /(^|\.)vimeo\.com$/],
  ['Dribbble', /(^|\.)dribbble\.com$/],
  ['Behance', /(^|\.)behance\.net$/],
];

/** Groups a page's links: internal vs external, top outbound domains, social profiles. */
export function analyzeLinks(anchors, siteRegistrable, registrableOf) {
  const internal = [];
  const external = [];
  const outbound = new Map();
  const social = new Map();
  for (const a of anchors) {
    let host;
    try { host = new URL(a.href).hostname.toLowerCase(); } catch { continue; }
    const reg = registrableOf(host);
    if (reg === siteRegistrable) { internal.push(a); continue; }
    external.push(a);
    const entry = outbound.get(reg) || { domain: reg, links: 0, nofollow: 0, sponsored: 0 };
    entry.links++;
    if (a.rel.includes('nofollow')) entry.nofollow++;
    if (a.rel.includes('sponsored')) entry.sponsored++;
    outbound.set(reg, entry);
    const net = SOCIAL.find(([, re]) => re.test(host));
    if (net && !social.has(net[0])) {
      const path = new URL(a.href).pathname;
      if (path && path !== '/' && !/\/(sharer|share|intent|home)\b/.test(path)) social.set(net[0], a.href);
    }
  }
  return {
    total: anchors.length,
    internal: internal.length,
    external: external.length,
    uniqueInternalPaths: new Set(internal.map((a) => { try { return new URL(a.href).pathname; } catch { return a.href; } })).size,
    topOutbound: [...outbound.values()].sort((a, b) => b.links - a.links).slice(0, 15),
    social: [...social].map(([network, url]) => ({ network, url })),
  };
}
