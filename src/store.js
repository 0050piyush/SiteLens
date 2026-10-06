import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.SITELENS_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

/** Small TTL + LRU cache for full reports. */
export class Cache {
  constructor({ max = 500, ttlMs = 6 * 3600 * 1000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) { this.map.delete(key); return null; }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}

/**
 * Persistent index of every site analyzed: powers "recently analyzed",
 * the leaderboard, and similar-site suggestions.
 */
export class SiteIndex {
  constructor() {
    this.sites = new Map();
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      for (const s of raw.sites || []) this.sites.set(s.domain, s);
    } catch { /* first run */ }
  }

  upsert(summary) {
    this.sites.set(summary.domain, summary);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
    this.timer.unref?.();
  }

  flush() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${INDEX_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sites: [...this.sites.values()] }));
      fs.renameSync(tmp, INDEX_FILE);
    } catch (err) {
      console.error('Could not save index:', err.message);
    }
  }

  get(domain) { return this.sites.get(domain) || null; }

  recent(limit = 12) {
    return [...this.sites.values()].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt)).slice(0, limit);
  }

  leaderboard({ category, sort = 'rank', limit = 50 } = {}) {
    let list = [...this.sites.values()];
    if (category) list = list.filter((s) => s.category === category);
    const key = {
      rank: (s) => s.rank ?? Infinity,
      score: (s) => -(s.scores?.overall ?? 0),
      performance: (s) => -(s.scores?.performance ?? 0),
      seo: (s) => -(s.scores?.seo ?? 0),
      security: (s) => -(s.scores?.security ?? 0),
    }[sort] || ((s) => s.rank ?? Infinity);
    return list.sort((a, b) => key(a) - key(b)).slice(0, limit);
  }

  categories() {
    const counts = {};
    for (const s of this.sites.values()) if (s.category) counts[s.category] = (counts[s.category] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
  }

  /** Sites sharing category, tech stack and outbound links, scored by weighted Jaccard. */
  similar(summary, limit = 8) {
    const jac = (a = [], b = []) => {
      const A = new Set(a);
      const B = new Set(b);
      const inter = [...A].filter((x) => B.has(x)).length;
      const union = new Set([...A, ...B]).size;
      return union ? inter / union : 0;
    };
    return [...this.sites.values()]
      .filter((s) => s.domain !== summary.domain)
      .map((s) => {
        const score = (s.category === summary.category ? 0.45 : 0)
          + 0.25 * jac(s.topics, summary.topics)
          + 0.2 * jac(s.tech, summary.tech)
          + 0.1 * jac(s.outbound, summary.outbound);
        return { domain: s.domain, title: s.title, icon: s.icon, category: s.category, rank: s.rank, similarity: Math.round(score * 100) };
      })
      .filter((s) => s.similarity >= 20)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  get size() { return this.sites.size; }
}
