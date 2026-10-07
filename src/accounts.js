import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError } from './util.js';

const DATA_DIR = process.env.SITELENS_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_DAYS = 30;
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const newApiKey = () => `wv_live_${randomBytes(24).toString('hex')}`;
// Keys issued before the rename to Webvieu start with sl_live_ and keep working.
const KEY_PREFIXES = ['wv_live_', 'sl_live_'];

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

/**
 * User accounts, sessions and account API keys, stored in data/users.json.
 * Only hashes of passwords, session tokens and API keys are stored.
 */
export class Accounts {
  constructor() {
    this.data = { users: [], sessions: [], tokens: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(raw.users)) this.data = { users: raw.users, sessions: raw.sessions || [], tokens: raw.tokens || [] };
    } catch { /* first run */ }
    this.pruneSessions();
  }

  save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(`${USERS_FILE}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(`${USERS_FILE}.tmp`, USERS_FILE);
    } catch (err) {
      console.error('Could not save accounts:', err.message);
    }
  }

  pruneSessions() {
    const now = Date.now();
    this.data.sessions = this.data.sessions.filter((s) => Date.parse(s.expiresAt) > now);
    this.data.tokens = (this.data.tokens || []).filter((t) => Date.parse(t.expiresAt) > now && !t.usedAt);
  }

  byEmail(email) { return this.data.users.find((u) => u.email === String(email).trim().toLowerCase()) || null; }

  byId(id) { return this.data.users.find((u) => u.id === id) || null; }

  byStripeCustomer(customerId) { return this.data.users.find((u) => u.stripeCustomerId === customerId) || null; }

  signup(email, password) {
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (password.length > 200) throw new HttpError(400, 'Password is too long.');
    if (this.byEmail(e)) throw new HttpError(409, 'An account with this email already exists. Log in instead.');
    const user = {
      id: randomUUID(),
      email: e,
      password: hashPassword(password),
      emailVerified: false,
      createdAt: new Date().toISOString(),
      plan: null,
      status: null, // Stripe subscription status, or 'manual' for admin grants
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      apiKeyHash: null,
      apiKeyPrefix: null,
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  login(email, password) {
    const user = this.byEmail(email);
    // Hash even for unknown emails so response time doesn't reveal which emails exist.
    const ok = verifyPassword(String(password || ''), user?.password || hashPassword('x'.repeat(12), 'timing'));
    if (!user || !ok) throw new HttpError(401, 'Wrong email or password.');
    return user;
  }

  createSession(user) {
    const token = randomBytes(32).toString('hex');
    this.data.sessions.push({
      hash: sha256(token),
      userId: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
    });
    this.pruneSessions();
    this.save();
    return token;
  }

  userForSession(token) {
    if (!token) return null;
    const s = this.data.sessions.find((x) => x.hash === sha256(token));
    if (!s || Date.parse(s.expiresAt) <= Date.now()) return null;
    return this.byId(s.userId);
  }

  endSession(token) {
    const h = sha256(String(token || ''));
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.hash !== h);
    if (this.data.sessions.length !== before) this.save();
  }

  /**
   * One-time email tokens ("verify" or "reset"). Only a hash is stored, a new
   * token replaces older unused ones of the same type, and each works once.
   */
  createToken(user, type, ttlMs) {
    const token = randomBytes(32).toString('hex');
    this.pruneSessions();
    this.data.tokens = this.data.tokens.filter((t) => !(t.userId === user.id && t.type === type));
    this.data.tokens.push({ hash: sha256(token), userId: user.id, type, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlMs).toISOString() });
    this.save();
    return token;
  }

  /** When the user's last token of this type was issued (for throttling resends). */
  lastTokenAt(user, type) {
    const t = this.data.tokens.filter((x) => x.userId === user.id && x.type === type).at(-1);
    return t ? Date.parse(t.createdAt) : 0;
  }

  consumeToken(token, type) {
    const t = /^[0-9a-f]{64}$/.test(String(token || '')) && this.data.tokens.find((x) => x.hash === sha256(token) && x.type === type);
    if (!t || t.usedAt || Date.parse(t.expiresAt) <= Date.now()) {
      throw new HttpError(400, type === 'reset' ? 'This reset link is invalid or has expired. Request a new one.' : 'This confirmation link is invalid or has expired.');
    }
    const user = this.byId(t.userId);
    if (!user) throw new HttpError(400, 'This link is no longer valid.');
    t.usedAt = new Date().toISOString();
    this.pruneSessions();
    this.save();
    return user;
  }

  markVerified(user) {
    user.emailVerified = true;
    this.save();
  }

  /** Sets a new password and signs the user out everywhere. */
  setPassword(user, password) {
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (password.length > 200) throw new HttpError(400, 'Password is too long.');
    user.password = hashPassword(password);
    this.data.sessions = this.data.sessions.filter((s) => s.userId !== user.id);
    this.data.tokens = this.data.tokens.filter((t) => !(t.userId === user.id && t.type === 'reset'));
    this.save();
  }

  /** Issues a new API key (replacing any old one). Returns the plain key once. */
  rotateKey(user) {
    const key = newApiKey();
    user.apiKeyHash = sha256(key);
    user.apiKeyPrefix = key.slice(0, 16);
    this.save();
    return key;
  }

  userForApiKey(key) {
    if (!key || !KEY_PREFIXES.some((p) => String(key).startsWith(p))) return null;
    const h = sha256(key);
    return this.data.users.find((u) => u.apiKeyHash === h) || null;
  }

  isActive(user) {
    return !!(user && user.plan && (user.status === 'manual' || ACTIVE_STATUSES.has(user.status)));
  }

  setPlan(user, { plan, status, stripeCustomerId, stripeSubscriptionId }) {
    if (plan !== undefined) user.plan = plan;
    if (status !== undefined) user.status = status;
    if (stripeCustomerId !== undefined) user.stripeCustomerId = stripeCustomerId;
    if (stripeSubscriptionId !== undefined) user.stripeSubscriptionId = stripeSubscriptionId;
    this.save();
  }

  get size() { return this.data.users.length; }
}
