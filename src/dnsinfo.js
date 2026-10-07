import dns from 'node:dns/promises';
import net from 'node:net';
import {
  MAIL_PROVIDERS, DNS_PROVIDERS, TXT_SERVICES, SPF_SENDERS, matchAll, uniq, hostingFromOrg, parseCymruOrigin, parseCymruAsName,
} from '../public/shared/signals.js';

const resolver = new dns.Resolver({ timeout: 4000, tries: 2 });

async function q(fn, name) {
  try {
    return await fn.call(resolver, name);
  } catch {
    return [];
  }
}

/** Team Cymru's DNS interface maps an IP to its ASN and network owner. */
async function asnLookup(ip) {
  if (!ip || !net.isIPv4(ip)) return null;
  const rev = ip.split('.').reverse().join('.');
  const origin = (await q(resolver.resolveTxt, `${rev}.origin.asn.cymru.com`))[0]?.join('');
  if (!origin) return null;
  const parsed = parseCymruOrigin(origin);
  const desc = (await q(resolver.resolveTxt, `AS${parsed.asn}.asn.cymru.com`))[0]?.join('');
  return { ...parsed, org: parseCymruAsName(desc) };
}

export async function dnsInfo(domain) {
  const apex = domain;
  const [a, aaaa, mx, ns, txt, caa, dmarc, wwwCname, soa] = await Promise.all([
    q(resolver.resolve4, apex),
    q(resolver.resolve6, apex),
    q(resolver.resolveMx, apex),
    q(resolver.resolveNs, apex),
    q(resolver.resolveTxt, apex),
    q(resolver.resolveCaa, apex),
    q(resolver.resolveTxt, `_dmarc.${apex}`),
    q(resolver.resolveCname, `www.${apex}`),
    resolver.resolveSoa(apex).catch(() => null),
  ]);

  const txtFlat = txt.map((parts) => parts.join(''));
  const spf = txtFlat.find((t) => /^v=spf1/i.test(t)) || null;
  const dmarcRec = dmarc.map((p) => p.join('')).find((t) => /^v=DMARC1/i.test(t)) || null;
  const dmarcPolicy = dmarcRec ? (/;\s*p=(\w+)/i.exec(dmarcRec)?.[1] || null) : null;
  const mxHosts = mx.sort((x, y) => x.priority - y.priority).map((m) => m.exchange.toLowerCase());

  const ip = a[0] || null;
  const [network, ptr] = await Promise.all([
    asnLookup(ip).catch(() => null),
    ip ? resolver.reverse(ip).then((r) => r[0] || null).catch(() => null) : null,
  ]);
  const hostingProvider = hostingFromOrg(network?.org);

  return {
    a,
    aaaa,
    ipv6: aaaa.length > 0,
    mx: mxHosts,
    ns: ns.map((n) => n.toLowerCase()).sort(),
    txt: txtFlat,
    caa: caa.map((c) => ({ critical: c.critical, ...Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'critical')) })),
    soa: soa ? { primary: soa.nsname, admin: soa.hostmaster, serial: soa.serial } : null,
    wwwCname: wwwCname[0] || null,
    spf,
    dmarc: dmarcRec,
    dmarcPolicy,
    providers: {
      email: uniq(mxHosts.flatMap((h) => matchAll(MAIL_PROVIDERS, h))),
      dns: uniq(ns.flatMap((h) => matchAll(DNS_PROVIDERS, h))),
      hosting: hostingProvider,
      emailSenders: spf ? uniq(matchAll(SPF_SENDERS, spf)) : [],
      verifiedServices: uniq(txtFlat.flatMap((t) => matchAll(TXT_SERVICES, t))),
    },
    network: network ? { ...network, ip, ptr } : (ip ? { ip, ptr } : null),
  };
}
