import fs from 'node:fs';
import path from 'node:path';
import session from 'express-session';
import { DATA_DIR } from './config.js';

// A tiny file-backed session store so logins survive a service restart/reboot.
// Sessions live in data/sessions.json (same JSON + atomic-write pattern the rest
// of the app uses). Expired sessions are pruned on load and on a periodic sweep,
// so the file cannot grow without bound. No external dependency required.
const FILE = path.join(DATA_DIR, 'sessions.json');
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // prune expired hourly

function now() {
  return Date.now();
}

// A session's absolute expiry (ms epoch), or null if it never expires.
function expiryOf(sess) {
  const exp = sess?.cookie?.expires;
  if (!exp) return null;
  const t = new Date(exp).getTime();
  return Number.isNaN(t) ? null : t;
}

export class FileSessionStore extends session.Store {
  constructor() {
    super();
    this.sessions = this.#read();
    // Prune on boot, then on a low-frequency timer. unref() so the sweep never
    // keeps the process alive on its own.
    this.#prune();
    const timer = setInterval(() => this.#prune(), SWEEP_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  #read() {
    try {
      return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  #write() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.sessions));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      // Never let a persistence hiccup take down a request.
      console.error('Session store write failed:', e.message);
    }
  }

  // Drop expired entries; persist only if something actually changed.
  #prune() {
    const t = now();
    let changed = false;
    for (const [sid, sess] of Object.entries(this.sessions)) {
      const exp = expiryOf(sess);
      if (exp !== null && exp <= t) {
        delete this.sessions[sid];
        changed = true;
      }
    }
    if (changed) this.#write();
  }

  get(sid, cb) {
    const sess = this.sessions[sid];
    if (!sess) return cb(null, null);
    const exp = expiryOf(sess);
    if (exp !== null && exp <= now()) {
      delete this.sessions[sid];
      this.#write();
      return cb(null, null);
    }
    return cb(null, sess);
  }

  set(sid, sess, cb) {
    this.sessions[sid] = sess;
    this.#write();
    if (cb) cb(null);
  }

  destroy(sid, cb) {
    if (this.sessions[sid]) {
      delete this.sessions[sid];
      this.#write();
    }
    if (cb) cb(null);
  }

  // Called by express-session to refresh the cookie expiry on active sessions.
  touch(sid, sess, cb) {
    const existing = this.sessions[sid];
    if (existing) {
      existing.cookie = sess.cookie;
      this.#write();
    }
    if (cb) cb(null);
  }
}
