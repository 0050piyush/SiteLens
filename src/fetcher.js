import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import zlib from 'node:zlib';
import { HttpError } from './util.js';

export const USER_AGENT =
  'Mozilla/5.0 (compatible; WebvieuBot/1.0; +https://github.com/0050piyush/SiteLens)';

// Addresses the analyzer must never connect to (SSRF protection): loopback,
// RFC 1918, link-local/cloud metadata, CGNAT, multicast, reserved.
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

export function isPrivateAddress(ip) {
  const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
  if (family === 'ipv6') {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
  }
  return blocked.check(ip, family);
}

const allowPrivate = () => process.env.SITELENS_ALLOW_PRIVATE === '1';

/** Resolves a hostname and refuses private/internal targets. */
export async function resolvePublic(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  let records;
  if (net.isIP(host)) {
    records = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  } else {
    try {
      records = await dns.lookup(host, { all: true, verbatim: false });
    } catch (err) {
      throw new HttpError(404, `Could not resolve ${host} (${err.code || err.message})`);
    }
  }
  if (!records.length) throw new HttpError(404, `Could not resolve ${host}`);
  if (!allowPrivate()) {
    const bad = records.find((r) => isPrivateAddress(r.address));
    if (bad) throw new HttpError(403, `${host} resolves to a private address (${bad.address}); refusing to fetch it`);
  }
  return records[0];
}

/**
 * GETs a URL following redirects by hand so every hop is re-validated against
 * the SSRF block list. Returns body text plus timing and header details.
 */
export async function fetchUrl(url, opts = {}) {
  const {
    maxRedirects = 6,
    timeout = 12000,
    maxBytes = 3 * 1024 * 1024,
    accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    headers: extraHeaders = {},
    raw = false,
  } = opts;
  const redirects = [];
  let current = new URL(url);
  const started = performance.now();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!['http:', 'https:'].includes(current.protocol)) {
      throw new HttpError(400, `Unsupported redirect to ${current.protocol}`);
    }
    const res = await requestOnce(current, { timeout, maxBytes, accept, extraHeaders, raw });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      redirects.push({ url: current.href, status: res.status });
      current = new URL(res.headers.location, current);
      continue;
    }
    return {
      ...res,
      requestedUrl: url,
      finalUrl: current.href,
      redirects,
      totalMs: Math.round(performance.now() - started),
    };
  }
  throw new HttpError(508, `Too many redirects (>${maxRedirects})`);
}

async function requestOnce(url, { timeout, maxBytes, accept, extraHeaders, raw }) {
  const t0 = performance.now();
  const { address, family } = await resolvePublic(url.hostname);
  const dnsMs = performance.now() - t0;
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const timings = { dns: Math.round(dnsMs) };
    const req = lib.request(
      url,
      {
        method: 'GET',
        // Pin the connection to the address we validated above.
        lookup: (_h, options, cb) => (options?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
        headers: {
          'user-agent': USER_AGENT,
          accept,
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          ...extraHeaders,
        },
        timeout,
        rejectUnauthorized: false, // we report certificate problems ourselves instead of failing
        agent: false,
      },
      (res) => {
        timings.ttfb = Math.round(performance.now() - t0);
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            chunks.push(c);
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          timings.total = Math.round(performance.now() - t0);
          const wire = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
          let body = wire;
          try {
            if (encoding.includes('br')) body = zlib.brotliDecompressSync(wire);
            else if (encoding.includes('gzip')) body = zlib.gunzipSync(wire, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
            else if (encoding.includes('deflate')) body = zlib.inflateSync(wire, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
          } catch {
            body = wire; // truncated or mislabelled; keep what we have
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            httpVersion: res.httpVersion,
            ip: address,
            transferBytes: wire.length,
            bytes: body.length,
            truncated: size > maxBytes,
            encoding: encoding || null,
            body: raw ? body : decodeBody(body, res.headers['content-type']),
            timings,
          });
        };
        res.on('end', finish);
        res.on('close', () => { if (!res.complete) finish(); });
        res.on('error', reject);
      },
    );
    req.on('socket', (socket) => {
      socket.once('connect', () => { timings.connect = Math.round(performance.now() - t0); });
      socket.once('secureConnect', () => { timings.tls = Math.round(performance.now() - t0); });
    });
    req.on('timeout', () => req.destroy(new HttpError(504, `Timed out fetching ${url.href}`)));
    req.on('error', (err) => reject(err instanceof HttpError ? err : new HttpError(502, `${url.hostname}: ${err.code || err.message}`)));
    req.end();
  });
}

function decodeBody(buf, contentType = '') {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Fetches JSON from a public API; returns null on any failure. */
export async function fetchJson(url, { timeout = 8000 } = {}) {
  try {
    const res = await fetchUrl(url, { timeout, accept: 'application/json, application/rdap+json', maxBytes: 2 * 1024 * 1024 });
    if (res.status !== 200) return null;
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/**
 * POSTs JSON to a public https URL (used for webhooks). The target is
 * resolved and checked against the private-address block list, and the
 * connection is pinned to the checked address. Redirects are not followed.
 */
export async function postJson(url, payload, { timeout = 10000, headers = {} } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' && !(allowPrivate() && target.protocol === 'http:')) {
    throw new HttpError(400, 'Webhook URL must use https://');
  }
  const { address, family } = await resolvePublic(target.hostname);
  const body = Buffer.from(JSON.stringify(payload));
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: 'POST',
      lookup: (_h, options, cb) => (options?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json', 'content-length': body.length, ...headers },
      timeout,
      agent: false,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new HttpError(504, 'Webhook timed out')));
    req.on('error', (err) => reject(err instanceof HttpError ? err : new HttpError(502, `Webhook failed: ${err.code || err.message}`)));
    req.end(body);
  });
}
