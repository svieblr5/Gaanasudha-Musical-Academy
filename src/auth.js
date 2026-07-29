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

// On first run, create a default admin so the operator can log in.
export function seedAdmin() {
  const users = loadUsers();
  if (users.length > 0) return;
  createUser({
    username: 'admin',
    password: 'admin123',
    displayName: 'Administrator',
    role: 'admin',
  });
  console.log('  Created default admin account:');
  console.log('     username: admin');
  console.log('     password: admin123');
  console.log('  >>> Log in and change this password immediately. <<<');
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
