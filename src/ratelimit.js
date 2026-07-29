// In-memory login throttling to blunt brute-force attempts now that the portal
// is exposed to the public internet. Keyed by client IP + attempted username so
// one attacker cannot lock out every account, and a single account cannot be
// hammered from one host. Successful logins clear the counter.
//
// Deliberately in-memory (no persistence): a restart resetting counters is an
// acceptable trade-off, and it keeps the store dependency-free.

const MAX_ATTEMPTS = 8; // failures allowed within the window before lockout
const WINDOW_MS = 15 * 60 * 1000; // rolling window / lockout duration
const attempts = new Map(); // key -> { count, first, blockedUntil }

function keyFor(ip, username) {
  return `${ip || 'unknown'}::${String(username || '').toLowerCase()}`;
}

// Periodically drop stale entries so the map cannot grow unbounded.
const sweep = setInterval(() => {
  const t = Date.now();
  for (const [k, v] of attempts) {
    const active = (v.blockedUntil && v.blockedUntil > t) || t - v.first < WINDOW_MS;
    if (!active) attempts.delete(k);
  }
}, WINDOW_MS);
if (typeof sweep.unref === 'function') sweep.unref();

// Returns { blocked, retryAfter } — retryAfter is seconds until the next try.
export function check(ip, username) {
  const rec = attempts.get(keyFor(ip, username));
  if (rec?.blockedUntil && rec.blockedUntil > Date.now()) {
    return { blocked: true, retryAfter: Math.ceil((rec.blockedUntil - Date.now()) / 1000) };
  }
  return { blocked: false, retryAfter: 0 };
}

// Record a failed attempt; returns the same shape as check().
export function recordFailure(ip, username) {
  const key = keyFor(ip, username);
  const t = Date.now();
  let rec = attempts.get(key);
  // Start a fresh window if none exists or the previous one has fully elapsed.
  if (!rec || (t - rec.first > WINDOW_MS && (!rec.blockedUntil || rec.blockedUntil <= t))) {
    rec = { count: 0, first: t, blockedUntil: 0 };
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.blockedUntil = t + WINDOW_MS;
  }
  attempts.set(key, rec);
  return check(ip, username);
}

export function recordSuccess(ip, username) {
  attempts.delete(keyFor(ip, username));
}
