import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.SITELENS_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'monitors.json');
const INTERVALS = { daily: 24 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 };
const HISTORY_MAX = 52;

/** The fields we keep from each check and compare between checks. */
export function snapshotOf(report) {
  return {
    at: report.meta?.analyzedAt || new Date().toISOString(),
    reachable: !!report.reachable,
    title: report.site?.title || null,
    rank: report.rank?.rank ?? null,
    monthlyVisits: report.traffic?.monthlyVisits ?? null,
    scores: report.scores || null,
    tech: (report.tech?.list || []).map((t) => t.name).sort(),
    hosting: report.dns?.providers?.hosting || null,
    tlsIssuer: report.tls && !report.tls.error ? report.tls.issuer : null,
    tlsDaysRemaining: report.tls && !report.tls.error ? report.tls.daysRemaining : null,
  };
}

/** What changed between two snapshots, as human-readable entries. */
export function diffSnapshots(prev, cur) {
  if (!prev) return [];
  const changes = [];
  const add = (field, from, to, message) => changes.push({ field, from, to, message });
  if (prev.reachable !== cur.reachable) {
    add('reachable', prev.reachable, cur.reachable, cur.reachable ? 'Site is reachable again' : 'Site is down or unreachable');
  }
  if (!cur.reachable) return changes;
  if (prev.rank && cur.rank) {
    const delta = prev.rank - cur.rank;
    if (Math.abs(delta) >= Math.max(5, prev.rank * 0.1)) {
      add('rank', prev.rank, cur.rank, `Global rank ${delta > 0 ? 'rose' : 'fell'} from #${prev.rank} to #${cur.rank}`);
    }
  } else if (!prev.rank !== !cur.rank) {
    add('rank', prev.rank, cur.rank, cur.rank ? `Entered the top 1M at #${cur.rank}` : 'Dropped out of the top 1M');
  }
  for (const k of ['overall', 'performance', 'seo', 'security']) {
    const a = prev.scores?.[k];
    const b = cur.scores?.[k];
    if (a != null && b != null && Math.abs(b - a) >= 5) add(`scores.${k}`, a, b, `${k[0].toUpperCase()}${k.slice(1)} score ${b > a ? 'up' : 'down'} from ${a} to ${b}`);
  }
  const before = new Set(prev.tech || []);
  const after = new Set(cur.tech || []);
  const added = [...after].filter((t) => !before.has(t));
  const removed = [...before].filter((t) => !after.has(t));
  if (added.length) add('tech.added', null, added, `Started using ${added.join(', ')}`);
  if (removed.length) add('tech.removed', removed, null, `Stopped using ${removed.join(', ')}`);
  if (prev.hosting && cur.hosting && prev.hosting !== cur.hosting) add('hosting', prev.hosting, cur.hosting, `Moved hosting from ${prev.hosting} to ${cur.hosting}`);
  if (prev.tlsIssuer && cur.tlsIssuer && prev.tlsIssuer !== cur.tlsIssuer) add('tls.issuer', prev.tlsIssuer, cur.tlsIssuer, `Certificate issuer changed to ${cur.tlsIssuer}`);
  if (cur.tlsDaysRemaining != null && cur.tlsDaysRemaining <= 14 && (prev.tlsDaysRemaining == null || prev.tlsDaysRemaining > 14)) {
    add('tls.expiring', prev.tlsDaysRemaining, cur.tlsDaysRemaining, `TLS certificate expires in ${cur.tlsDaysRemaining} days`);
  }
  if (prev.title && cur.title && prev.title !== cur.title) add('title', prev.title, cur.title, `Homepage title changed to "${cur.title}"`);
  return changes;
}

export const signPayload = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/**
 * Sites that API customers watch. Each monitor is re-checked daily or weekly;
 * when something changes, a signed JSON webhook is POSTed to the customer.
 */
export class Monitors {
  constructor({ getReport, usage, planFor, sendWebhook, tickMs = 5 * 60 * 1000 }) {
    this.getReport = getReport;
    this.usage = usage;
    this.planFor = planFor; // key -> plan, or null if the key was revoked
    this.sendWebhook = sendWebhook;
    this.items = [];
    this.running = false;
    try {
      this.items = JSON.parse(fs.readFileSync(FILE, 'utf8')).monitors || [];
    } catch { /* first run */ }
    this.timer = setInterval(() => this.tick().catch((err) => console.error('Monitor tick failed:', err.message)), tickMs);
    this.timer.unref();
  }

  save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ monitors: this.items }));
      fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (err) {
      console.error('Could not save monitors:', err.message);
    }
  }

  listFor(key) { return this.items.filter((m) => m.key === key).map((m) => this.view(m)); }

  get(id, key) { return this.items.find((m) => m.id === id && m.key === key) || null; }

  countFor(key) { return this.items.filter((m) => m.key === key).length; }

  create({ key, domain, webhook, interval }) {
    const m = {
      id: randomUUID(),
      key,
      domain,
      webhook,
      interval,
      secret: randomBytes(24).toString('hex'),
      createdAt: new Date().toISOString(),
      nextCheckAt: new Date().toISOString(), // first check (the baseline) runs right away
      lastCheckedAt: null,
      lastStatus: 'pending',
      lastAlert: null,
      last: null,
      history: [],
    };
    this.items.push(m);
    this.save();
    queueMicrotask(() => this.tick().catch(() => {}));
    return m;
  }

  remove(id, key) {
    const before = this.items.length;
    this.items = this.items.filter((m) => !(m.id === id && m.key === key));
    if (this.items.length !== before) this.save();
    return this.items.length !== before;
  }

  /** Runs every monitor that is due, one at a time. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      for (const m of this.items.filter((x) => Date.parse(x.nextCheckAt) <= now)) {
        if (!this.items.includes(m)) continue; // deleted meanwhile
        await this.check(m);
      }
    } finally {
      this.running = false;
    }
  }

  async check(m) {
    const plan = this.planFor(m.key);
    const step = INTERVALS[m.interval] || INTERVALS.weekly;
    if (!plan) {
      m.lastStatus = 'paused: API key no longer valid';
      m.nextCheckAt = new Date(Date.now() + INTERVALS.daily).toISOString();
      this.save();
      return;
    }
    if (this.usage.used(m.key) >= plan.monthly) {
      m.lastStatus = 'skipped: monthly quota reached';
      m.nextCheckAt = new Date(Date.now() + INTERVALS.daily).toISOString();
      this.save();
      return;
    }
    this.usage.add(m.key, 1);
    let report;
    try {
      report = await this.getReport(m.domain);
    } catch (err) {
      report = { reachable: false, error: err.message };
    }
    const snap = snapshotOf(report);
    const changes = diffSnapshots(m.last, snap);
    m.history.push({ at: snap.at, reachable: snap.reachable, rank: snap.rank, scores: snap.scores, changes: changes.length });
    if (m.history.length > HISTORY_MAX) m.history.splice(0, m.history.length - HISTORY_MAX);
    const isBaseline = !m.last;
    m.last = snap;
    m.lastCheckedAt = new Date().toISOString();
    m.nextCheckAt = new Date(Date.now() + step).toISOString();
    m.lastStatus = isBaseline ? 'baseline recorded' : changes.length ? `${changes.length} change(s) found` : 'no changes';
    if (changes.length) await this.notify(m, 'site.changed', { changes, snapshot: snap });
    this.save();
  }

  async notify(m, event, data) {
    const payload = { event, monitorId: m.id, domain: m.domain, checkedAt: m.lastCheckedAt, ...data };
    try {
      const res = await this.sendWebhook(m.webhook, payload, m.secret, event);
      m.lastAlert = { at: new Date().toISOString(), event, status: res.status, ok: res.status >= 200 && res.status < 300 };
    } catch (err) {
      m.lastAlert = { at: new Date().toISOString(), event, ok: false, error: err.message };
    }
    this.save();
    return m.lastAlert;
  }

  view(m, { secret = false } = {}) {
    return {
      id: m.id,
      domain: m.domain,
      webhook: m.webhook,
      interval: m.interval,
      createdAt: m.createdAt,
      lastCheckedAt: m.lastCheckedAt,
      nextCheckAt: m.nextCheckAt,
      lastStatus: m.lastStatus,
      lastAlert: m.lastAlert,
      current: m.last,
      history: m.history,
      ...(secret ? { secret: m.secret } : {}),
    };
  }
}
