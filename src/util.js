import { domainToASCII } from 'node:url';

// Common multi-label public suffixes. Not the full Public Suffix List, but it
// covers the registrable-domain cases people actually type.
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'gov.in', 'edu.in',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.za', 'org.za', 'gov.za',
  'com.mx', 'org.mx', 'gob.mx',
  'com.tr', 'org.tr', 'gov.tr',
  'co.kr', 'or.kr', 'go.kr',
  'com.sg', 'edu.sg', 'gov.sg',
  'com.hk', 'org.hk', 'gov.hk',
  'com.tw', 'org.tw', 'gov.tw',
  'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec',
  'com.my', 'com.ph', 'com.pk', 'com.ng', 'com.eg', 'com.sa', 'com.ua',
  'co.id', 'or.id', 'ac.id', 'go.id', 'co.il', 'org.il', 'co.th', 'in.th',
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'herokuapp.com',
  'blogspot.com', 'wordpress.com', 'web.app', 'firebaseapp.com', 'azurewebsites.net',
]);

const COUNTRY_TLDS = {
  uk: 'United Kingdom', in: 'India', de: 'Germany', fr: 'France', jp: 'Japan', cn: 'China',
  br: 'Brazil', ru: 'Russia', it: 'Italy', es: 'Spain', nl: 'Netherlands', au: 'Australia',
  ca: 'Canada', us: 'United States', mx: 'Mexico', kr: 'South Korea', se: 'Sweden',
  no: 'Norway', dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  be: 'Belgium', pt: 'Portugal', ie: 'Ireland', nz: 'New Zealand', za: 'South Africa',
  ar: 'Argentina', cl: 'Chile', co: 'Colombia', tr: 'Turkey', ua: 'Ukraine', cz: 'Czechia',
  gr: 'Greece', hu: 'Hungary', ro: 'Romania', il: 'Israel', sg: 'Singapore', hk: 'Hong Kong',
  tw: 'Taiwan', id: 'Indonesia', my: 'Malaysia', th: 'Thailand', vn: 'Vietnam', ph: 'Philippines',
  pk: 'Pakistan', bd: 'Bangladesh', ng: 'Nigeria', eg: 'Egypt', sa: 'Saudi Arabia', ae: 'UAE',
  ir: 'Iran', ke: 'Kenya', pe: 'Peru', sk: 'Slovakia', bg: 'Bulgaria', lt: 'Lithuania',
  lv: 'Latvia', ee: 'Estonia', si: 'Slovenia', hr: 'Croatia', rs: 'Serbia', by: 'Belarus', kz: 'Kazakhstan',
};

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Turns whatever the user typed ("https://www.Example.com/path?q", "example.com:8080")
 * into a bare ASCII hostname, or throws.
 */
export function normalizeDomain(input, { allowPort = false } = {}) {
  if (typeof input !== 'string') throw new HttpError(400, 'domain is required');
  let s = input.trim().toLowerCase();
  if (!s) throw new HttpError(400, 'domain is required');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '');
  let port = '';
  const m = s.match(/^(.*):(\d{1,5})$/);
  if (m) { s = m[1]; port = m[2]; }
  s = s.replace(/\.$/, '');
  const ascii = domainToASCII(s);
  if (!ascii) throw new HttpError(400, `"${input}" is not a valid domain`);
  const labels = ascii.split('.');
  const isLocal = ascii === 'localhost';
  if (!isLocal && (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l)) || /^\d+$/.test(labels.at(-1)))) {
    throw new HttpError(400, `"${input}" is not a valid domain`);
  }
  if (ascii.length > 253) throw new HttpError(400, 'domain is too long');
  return allowPort && port ? `${ascii}:${port}` : ascii;
}

/** "www.shop.example.co.uk" -> "example.co.uk" */
export function registrableDomain(host) {
  const h = host.replace(/:\d+$/, '');
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const last2 = labels.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

export function countryFromTld(host) {
  const tld = host.replace(/:\d+$/, '').split('.').at(-1);
  return COUNTRY_TLDS[tld] || null;
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Resolves to the promise's value, or to `fallback` after `ms`. Never rejects. */
export function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch((err) => ({ error: err?.message || String(err) })),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Runs fn, returning { error } instead of throwing. */
export async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

export function grade(score) {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}
