import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';

const USERS_FILE = 'users.json';

// --- Password hashing (scrypt, built into Node — no native deps) ---

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- User store ---

export function loadUsers() {
  return readJson(USERS_FILE, []);
}

export function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

export function findUser(username) {
  const target = String(username || '').toLowerCase();
  return loadUsers().find((u) => u.username.toLowerCase() === target);
}

export function findUserById(id) {
  return loadUsers().find((u) => u.id === id);
}

export function createUser({ username, password, displayName, role = 'user' }) {
  const users = loadUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('Username already exists');
  }
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: displayName || username,
    role: role === 'admin' ? 'admin' : 'user',
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return publicUser(user);
}

// Strip the password hash before sending a user object to the client.
export function publicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

// On first run, create a default admin so the operator can log in. The password
// comes from ADMIN_PASSWORD if set; otherwise a strong random one is generated
// and printed once. No credential is baked into the source.
export function seedAdmin() {
  const users = loadUsers();
  if (users.length > 0) return;
  const fromEnv = process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD);
  const password = fromEnv || crypto.randomBytes(9).toString('base64url');
  createUser({
    username: 'admin',
    password,
    displayName: 'Administrator',
    role: 'admin',
  });
  console.log('  Created default admin account:');
  console.log('     username: admin');
  if (fromEnv) {
    console.log('     password: (from ADMIN_PASSWORD)');
  } else {
    console.log(`     password: ${password}`);
    console.log('  >>> Shown once. Log in and change it now (My Account → Change password). <<<');
  }
}

// Guard for installs seeded with the old public default: warn loudly at startup
// if the admin account still uses it, so it can't quietly linger in production.
export function warnIfDefaultAdminPassword() {
  const admin = findUser('admin');
  if (admin && verifyPassword('admin123', admin.password)) {
    console.warn('  >>> SECURITY: the "admin" account still uses the old default password.');
    console.warn('  >>> Change it now (My Account → Change password) — this default is public.');
  }
}

// --- Express middleware ---

export function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

export function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Administrator access required' });
}
