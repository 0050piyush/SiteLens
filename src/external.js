import { fetchJson, fetchUrl } from './fetcher.js';

const offline = () => process.env.SITELENS_OFFLINE === '1';

/** Registration data via RDAP (the JSON successor to WHOIS). */
export async function rdapInfo(domain) {
  if (offline()) return null;
  const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeout: 9000 });
  if (!data) return null;
  const event = (name) => data.events?.find((e) => e.eventAction === name)?.eventDate || null;
  const registrar = data.entities?.find((e) => e.roles?.includes('registrar'));
  const registrarName = registrar?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3]
    || registrar?.publicIds?.[0]?.identifier || null;
  const created = event('registration');
  return {
    registrar: registrarName,
    created,
    expires: event('expiration'),
    updated: event('last changed'),
    ageYears: created ? Math.round(((Date.now() - new Date(created)) / (365.25 * 86400000)) * 10) / 10 : null,
    status: data.status || [],
    dnssec: data.secureDNS?.delegationSigned ?? null,
    nameservers: (data.nameservers || []).map((n) => n.ldhName?.toLowerCase()).filter(Boolean),
  };
}

/** First and latest Internet Archive captures, plus captures per year. */
export async function waybackInfo(domain) {
  if (offline()) return null;
  const rows = await fetchJson(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp&collapse=timestamp:4&filter=statuscode:200`,
    { timeout: 10000 },
  );
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const stamps = rows.slice(1).map((r) => r[0]);
  const toIso = (ts) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  return {
    firstSeen: toIso(stamps[0]),
    lastSeen: toIso(stamps.at(-1)),
    yearsArchived: stamps.map((s) => Number(s.slice(0, 4))),
    url: `https://web.archive.org/web/*/${domain}`,
  };
}

async function getText(url, maxBytes = 512 * 1024) {
  try {
    const res = await fetchUrl(url, { timeout: 7000, maxBytes, accept: 'text/plain,application/xml,text/xml,*/*' });
    if (res.status !== 200) return null;
    // Soft-404s: an HTML page served for a text file.
    if (/text\/html/i.test(res.headers['content-type'] || '') && /<html|<!doctype/i.test(res.body.slice(0, 500))) return null;
    return { body: res.body, url: res.finalUrl };
  } catch {
    return null;
  }
}

const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'CCBot',
  'Google-Extended', 'PerplexityBot', 'Bytespider', 'Applebot-Extended', 'meta-externalagent', 'Amazonbot', 'cohere-ai'];

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  const sitemaps = [];
  let rules = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'sitemap') { sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], disallow: [], allow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow') { rules++; if (value) current.disallow.push(value); }
    if (key === 'allow') { rules++; current.allow.push(value); }
  }
  const blocksAll = (agent) => {
    const g = groups.find((gr) => gr.agents.includes(agent.toLowerCase()));
    return !!g && g.disallow.includes('/');
  };
  const star = groups.find((g) => g.agents.includes('*'));
  return {
    rules,
    groups: groups.length,
    sitemaps,
    blocksEverything: !!star && star.disallow.includes('/'),
    aiBots: AI_BOTS.map((bot) => ({ bot, blocked: blocksAll(bot) || (!!star && star.disallow.includes('/') && !groups.some((g) => g.agents.includes(bot.toLowerCase()))) })),
  };
}

export function parseSitemap(xml) {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  const lastmods = [...xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)].map((m) => m[1]).sort();
  return {
    isIndex,
    urls: isIndex ? null : locs.length,
    children: isIndex ? locs.length : 0,
    childUrls: isIndex ? locs.slice(0, 5) : [],
    latestUpdate: lastmods.at(-1) || null,
  };
}

export function parseAdsTxt(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter((l) => l.includes(','));
  const systems = new Map();
  let direct = 0;
  let reseller = 0;
  for (const l of lines) {
    const [sys, , rel] = l.split(',').map((s) => s.trim().toLowerCase());
    if (!sys) continue;
    systems.set(sys, (systems.get(sys) || 0) + 1);
    if (rel === 'direct') direct++;
    else if (rel === 'reseller') reseller++;
  }
  return {
    sellers: lines.length,
    direct,
    reseller,
    topSystems: [...systems].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, count]) => ({ domain, count })),
  };
}

/** robots.txt, sitemap, ads.txt, security.txt, llms.txt and the http→https redirect. */
export async function siteFiles(origin, host) {
  const [robotsRes, adsRes, securityRes, llmsRes, httpRedirect] = await Promise.all([
    getText(`${origin}/robots.txt`),
    getText(`${origin}/ads.txt`),
    getText(`${origin}/.well-known/security.txt`).then((r) => r || getText(`${origin}/security.txt`)),
    getText(`${origin}/llms.txt`, 256 * 1024),
    origin.startsWith('https://')
      ? fetchUrl(`http://${host}/`, { timeout: 6000, maxRedirects: 3, maxBytes: 64 * 1024 })
        .then((r) => r.finalUrl.startsWith('https://')).catch(() => null)
      : Promise.resolve(false),
  ]);

  const robots = robotsRes ? parseRobots(robotsRes.body) : null;
  let sitemapUrl = `${origin}/sitemap.xml`;
  try { if (robots?.sitemaps[0]) sitemapUrl = new URL(robots.sitemaps[0], origin).href; } catch { /* keep default */ }
  let sitemap = null;
  const sm = await getText(sitemapUrl, 8 * 1024 * 1024);
  if (sm && /<(urlset|sitemapindex)\b/i.test(sm.body)) sitemap = { url: sm.url, ...parseSitemap(sm.body) };

  const adsValid = adsRes && /,\s*(direct|reseller)/i.test(adsRes.body);
  return {
    robots,
    sitemap,
    adsTxt: adsValid ? parseAdsTxt(adsRes.body) : null,
    securityTxt: securityRes && /contact:/i.test(securityRes.body)
      ? { contact: /contact:\s*(.+)/i.exec(securityRes.body)?.[1].trim() || null }
      : null,
    llmsTxt: llmsRes ? { bytes: llmsRes.body.length, title: /^#\s+(.+)$/m.exec(llmsRes.body)?.[1] || null } : null,
    httpRedirectsToHttps: httpRedirect,
  };
}
