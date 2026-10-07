import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { fetchJson, fetchUrl } from './fetcher.js';

// Popularity comes from the Tranco list (https://tranco-list.eu), a research-grade
// ranking that averages Chrome UX Report, Cloudflare Radar, Umbrella, Majestic
// and Farsight data over 30 days and is designed to resist manipulation.

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const LIST_FILE = path.join(DATA_DIR, 'tranco.csv');
const TRANCO_ZIP = 'https://tranco-list.eu/top-1m.csv.zip';

let local = null; // { byDomain: Map, top: string[], loadedAt }
let loading = null;

export function localListStatus() {
  return local ? { loaded: true, domains: local.byDomain.size, loadedAt: local.loadedAt } : { loaded: false };
}

export function loadLocalList() {
  if (!fs.existsSync(LIST_FILE)) return false;
  const limit = Number(process.env.SITELENS_TRANCO_LIMIT || 1_000_000);
  const byDomain = new Map();
  const top = [];
  const text = fs.readFileSync(LIST_FILE, 'utf8');
  let start = 0;
  while (start < text.length && byDomain.size < limit) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const rank = Number(line.slice(0, comma));
    const domain = line.slice(comma + 1);
    if (!rank || !domain) continue;
    byDomain.set(domain, rank);
    if (top.length < 1000) top.push(domain);
  }
  local = { byDomain, top, loadedAt: fs.statSync(LIST_FILE).mtime.toISOString() };
  return true;
}

/** Minimal ZIP reader: returns the first entry's bytes (stored or deflated). */
export function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('Bad central directory');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported zip compression method ${method}`);
}

/** Downloads the latest Tranco top-1M list into data/tranco.csv. */
export async function downloadList() {
  if (loading) return loading;
  loading = (async () => {
    const res = await fetchUrl(TRANCO_ZIP, { raw: true, maxBytes: 64 * 1024 * 1024, timeout: 120000, accept: 'application/zip' });
    if (res.status !== 200) throw new Error(`Tranco download failed: HTTP ${res.status}`);
    const csv = unzipFirst(res.body);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LIST_FILE, csv);
    loadLocalList();
    return localListStatus();
  })().finally(() => { loading = null; });
  return loading;
}

export function topSites(limit = 100, offset = 0) {
  if (!local) return null;
  return local.top.slice(offset, offset + limit).map((domain, i) => ({ rank: offset + i + 1, domain }));
}

// The public Tranco API allows about one request per second; queue calls.
let chain = Promise.resolve();
function throttled(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

/**
 * Current rank and recent rank history for a domain. Uses the local list when
 * loaded (instant, no rate limit), and the Tranco API for history.
 */
export async function getRank(domain) {
  const localRank = local?.byDomain.get(domain) ?? null;
  const api = process.env.SITELENS_OFFLINE === '1'
    ? null
    : await throttled(() => fetchJson(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { timeout: 8000 }));
  const history = Array.isArray(api?.ranks)
    ? api.ranks
      .filter((r) => r && r.date && Number(r.rank) > 0)
      .map((r) => ({ date: String(r.date).slice(0, 10), rank: Number(r.rank) }))
      .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const rank = history.at(-1)?.rank ?? localRank;
  return {
    source: 'Tranco',
    rank: rank ?? null,
    inTop1M: rank != null,
    history,
    change: history.length > 1 ? history[0].rank - history.at(-1).rank : null, // positive = climbing
    percentile: rank ? Math.max(0, 100 - (Math.log10(rank) / 6) * 100) : null,
    apiReachable: api != null,
  };
}

export { visitsForRank, trafficEstimate } from '../public/shared/traffic.js';
