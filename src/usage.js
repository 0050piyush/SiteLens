import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.SITELENS_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

const monthOf = (d = new Date()) => d.toISOString().slice(0, 7); // "2026-10" (UTC)

/** Per-key monthly API usage, persisted so restarts don't reset quotas. */
export class UsageStore {
  constructor() {
    this.data = { month: monthOf(), counts: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
      if (raw && raw.month && raw.counts) this.data = raw;
    } catch { /* first run */ }
    this.timer = null;
  }

  rollover() {
    const now = monthOf();
    if (this.data.month !== now) this.data = { month: now, counts: {} };
  }

  month() { this.rollover(); return this.data.month; }

  resetsAt() {
    const [y, m] = this.month().split('-').map(Number);
    return new Date(Date.UTC(y, m, 1)).toISOString();
  }

  used(key) { this.rollover(); return this.data.counts[key] || 0; }

  add(key, n = 1) {
    this.rollover();
    this.data.counts[key] = (this.data.counts[key] || 0) + n;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 2000);
    this.timer.unref?.();
  }

  flush() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(`${USAGE_FILE}.tmp`, JSON.stringify(this.data));
      fs.renameSync(`${USAGE_FILE}.tmp`, USAGE_FILE);
    } catch (err) {
      console.error('Could not save usage:', err.message);
    }
  }
}
