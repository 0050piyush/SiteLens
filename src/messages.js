import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.SITELENS_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'messages.json');
const MAX = 5000;

/** Contact-form messages, kept in data/messages.json (newest last, capped). */
export class Messages {
  constructor() {
    this.items = [];
    try { this.items = JSON.parse(fs.readFileSync(FILE, 'utf8')).messages || []; } catch { /* first run */ }
  }

  add({ name, email, topic, message, ip }) {
    const m = { id: randomUUID(), at: new Date().toISOString(), name, email, topic, message, ip };
    this.items.push(m);
    if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ messages: this.items }, null, 1), { mode: 0o600 });
      fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (err) {
      console.error('Could not save message:', err.message);
    }
    return m;
  }
}
