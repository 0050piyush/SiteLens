// Browser-only analysis, used when no SiteLens API server is available (for
// example on GitHub Pages). It relies on public services that allow
// cross-origin requests: DNS-over-HTTPS, RDAP, the Internet Archive and Tranco.
// Anything that needs the site's own HTML or headers requires the API server.

import {
  MAIL_PROVIDERS, DNS_PROVIDERS, TXT_SERVICES, SPF_SENDERS, matchAll, uniq, hostingFromOrg, parseCymruOrigin, parseCymruAsName,
} from './shared/signals.js';
import { trafficEstimate } from './shared/traffic.js';

const DOH = 'https://dns.google/resolve';
const TYPES = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };

async function getJson(url, { timeout = 9000, headers } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function dnsQuery(name, type) {
  const data = await getJson(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`);
  if (!data) return { ok: false, records: [] };
  return {
    ok: true,
    nxdomain: data.Status === 3,
    records: (data.Answer || []).filter((a) => a.type === TYPES[type]).map((a) => a.data),
  };
}

// TXT answers arrive quoted and possibly split into 255-byte chunks.
const unquoteTxt = (s) => {
  const parts = s.match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('') : s;
};
const stripDot = (s) => s.replace(/\.$/, '').toLowerCase();

async function liteDns(domain) {
  const [a, aaaa, mx, ns, txt, caa, dmarc, www] = await Promise.all([
    dnsQuery(domain, 'A'), dnsQuery(domain, 'AAAA'), dnsQuery(domain, 'MX'), dnsQuery(domain, 'NS'),
    dnsQuery(domain, 'TXT'), dnsQuery(domain, 'CAA'), dnsQuery(`_dmarc.${domain}`, 'TXT'), dnsQuery(`www.${domain}`, 'CNAME'),
  ]);
  if (!a.ok && !ns.ok) return { error: 'DNS-over-HTTPS lookup failed' };
  const txtFlat = txt.records.map(unquoteTxt);
  const spf = txtFlat.find((t) => /^v=spf1/i.test(t)) || null;
  const dmarcRec = dmarc.records.map(unquoteTxt).find((t) => /^v=DMARC1/i.test(t)) || null;
  const mxHosts = mx.records
    .map((r) => r.split(' '))
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map((r) => stripDot(r[1] || ''))
    .filter(Boolean);
  const nsHosts = ns.records.map(stripDot).sort();
  const ip = a.records.find((r) => /^\d+\.\d+\.\d+\.\d+$/.test(r)) || null;

  let network = ip ? { ip } : null;
  if (ip) {
    const rev = ip.split('.').reverse().join('.');
    const origin = await dnsQuery(`${rev}.origin.asn.cymru.com`, 'TXT');
    if (origin.records[0]) {
      const parsed = parseCymruOrigin(unquoteTxt(origin.records[0]));
      const desc = await dnsQuery(`AS${parsed.asn}.asn.cymru.com`, 'TXT');
      network = { ...parsed, org: parseCymruAsName(desc.records[0] ? unquoteTxt(desc.records[0]) : null), ip, ptr: null };
    }
  }
  return {
    nxdomain: a.nxdomain && ns.nxdomain,
    a: a.records.filter((r) => /^\d+\.\d+\.\d+\.\d+$/.test(r)),
    aaaa: aaaa.records.filter((r) => r.includes(':')),
    ipv6: aaaa.records.some((r) => r.includes(':')),
    mx: mxHosts,
    ns: nsHosts,
    txt: txtFlat,
    caa: caa.records.map((r) => {
      const m = /^\d+\s+(\w+)\s+"?([^"]*)"?$/.exec(r);
      return m ? { [m[1]]: m[2] } : { raw: r };
    }),
    wwwCname: www.records[0] ? stripDot(www.records[0]) : null,
    spf,
    dmarc: dmarcRec,
    dmarcPolicy: dmarcRec ? (/;\s*p=(\w+)/i.exec(dmarcRec)?.[1] || null) : null,
    providers: {
      email: uniq(mxHosts.flatMap((h) => matchAll(MAIL_PROVIDERS, h))),
      dns: uniq(nsHosts.flatMap((h) => matchAll(DNS_PROVIDERS, h))),
      hosting: hostingFromOrg(network?.org),
      emailSenders: spf ? uniq(matchAll(SPF_SENDERS, spf)) : [],
      verifiedServices: uniq(txtFlat.flatMap((t) => matchAll(TXT_SERVICES, t))),
    },
    network,
  };
}

async function liteRank(domain) {
  const api = await getJson(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`);
  const history = Array.isArray(api?.ranks)
    ? api.ranks
      .filter((r) => r && r.date && Number(r.rank) > 0)
      .map((r) => ({ date: String(r.date).slice(0, 10), rank: Number(r.rank) }))
      .sort((x, y) => x.date.localeCompare(y.date))
    : [];
  const rank = history.at(-1)?.rank ?? null;
  return {
    source: 'Tranco',
    rank,
    inTop1M: rank != null,
    history,
    change: history.length > 1 ? history[0].rank - history.at(-1).rank : null,
    apiReachable: api != null,
  };
}

async function liteRdap(domain) {
  const data = await getJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: 'application/rdap+json, application/json' } });
  if (!data) return null;
  const event = (name) => data.events?.find((e) => e.eventAction === name)?.eventDate || null;
  const registrar = data.entities?.find((e) => e.roles?.includes('registrar'));
  const created = event('registration');
  return {
    registrar: registrar?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || registrar?.publicIds?.[0]?.identifier || null,
    created,
    expires: event('expiration'),
    updated: event('last changed'),
    ageYears: created ? Math.round(((Date.now() - new Date(created)) / (365.25 * 86400000)) * 10) / 10 : null,
    status: data.status || [],
    dnssec: data.secureDNS?.delegationSigned ?? null,
  };
}

async function liteWayback(domain) {
  const toIso = (ts) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  const rows = await getJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp&collapse=timestamp:4&filter=statuscode:200`, { timeout: 12000 });
  if (Array.isArray(rows) && rows.length > 1) {
    const stamps = rows.slice(1).map((r) => r[0]);
    return { firstSeen: toIso(stamps[0]), lastSeen: toIso(stamps.at(-1)), yearsArchived: stamps.map((s) => Number(s.slice(0, 4))), url: `https://web.archive.org/web/*/${domain}` };
  }
  const avail = await getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=19960101`);
  const ts = avail?.archived_snapshots?.closest?.timestamp;
  return ts ? { firstSeen: toIso(ts), lastSeen: null, yearsArchived: [], url: `https://web.archive.org/web/*/${domain}` } : null;
}

function emailSecurityAudit(dns) {
  const checks = [
    { id: 'spf', label: 'SPF record', pass: !!dns.spf, weight: 4, detail: dns.spf || 'None' },
    { id: 'spf-strict', label: 'SPF ends in -all or ~all', pass: dns.spf ? /[-~]all\b/.test(dns.spf) : false, weight: 2, detail: dns.spf ? (/-all\b/.test(dns.spf) ? 'Hard fail (-all)' : /~all\b/.test(dns.spf) ? 'Soft fail (~all)' : 'Permissive') : 'No SPF' },
    { id: 'dmarc', label: 'DMARC enforcing (quarantine/reject)', pass: dns.dmarcPolicy ? (/reject|quarantine/i.test(dns.dmarcPolicy) ? true : 0.4) : false, weight: 5, detail: dns.dmarc || 'None' },
    { id: 'caa', label: 'CAA record restricts certificate issuers', pass: dns.caa.length > 0, weight: 2, detail: dns.caa.map((c) => c.issue || c.issuewild || c.iodef || c.raw).filter(Boolean).join(', ') || 'None' },
    { id: 'ipv6', label: 'IPv6 (AAAA record)', pass: dns.ipv6, weight: 1, detail: dns.aaaa[0] || 'None' },
  ];
  let total = 0;
  let got = 0;
  for (const c of checks) {
    total += c.weight;
    got += c.pass === true ? c.weight : typeof c.pass === 'number' ? c.weight * c.pass : 0;
  }
  const score = Math.round((got / total) * 100);
  const grade = score >= 95 ? 'A+' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  return {
    score, grade, checks,
    passed: checks.filter((c) => c.pass === true).length,
    failed: checks.filter((c) => c.pass !== true).length,
  };
}

/** Builds a partial report with the same field names as the server's. */
export async function analyzeLite(domain) {
  const started = Date.now();
  const [dns, rank, rdap, wayback] = await Promise.all([liteDns(domain), liteRank(domain), liteRdap(domain), liteWayback(domain)]);
  if (dns.nxdomain) return { domain, reachable: false, error: `${domain} does not exist (no DNS records).` };
  const okDns = dns.error ? null : dns;
  return {
    mode: 'lite',
    domain,
    host: domain,
    url: `https://${domain}/`,
    reachable: true,
    site: { icon: `https://${domain}/favicon.ico` },
    rank,
    traffic: trafficEstimate(rank),
    dns: okDns,
    emailSecurity: okDns ? emailSecurityAudit(okDns) : null,
    domainInfo: { rdap, wayback },
    meta: { analyzedAt: new Date().toISOString(), durationMs: Date.now() - started, version: 'lite' },
  };
}
