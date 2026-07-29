import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';
import { hashPassword, verifyPassword } from './auth.js';

const FILE = 'shares.json';

function load() {
  return readJson(FILE, []);
}
function save(list) {
  writeJson(FILE, list);
}

// A short, URL-safe token used in public /share/<token> links.
function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

export function listForUser(userId) {
  return load()
    .filter((s) => s.createdBy === userId)
    .map(publicShare);
}

export function get(token) {
  return load().find((s) => s.token === token);
}

// type: 'track' | 'playlist'; refId: track id or playlist id
export function create({ type, refId, title, createdBy, expiresInDays, password }) {
  const list = load();
  const now = Date.now();
  const share = {
    token: makeToken(),
    type,
    refId,
    title: title || 'Shared music',
    createdBy,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresInDays ? new Date(now + expiresInDays * 86400000).toISOString() : null,
    password: password ? hashPassword(password) : null,
  };
  list.push(share);
  save(list);
  return publicShare(share);
}

export function remove(token, userId) {
  const list = load();
  const next = list.filter((s) => !(s.token === token && s.createdBy === userId));
  if (next.length === list.length) return false;
  save(next);
  return true;
}

export function isExpired(share) {
  return !!share.expiresAt && Date.now() > new Date(share.expiresAt).getTime();
}

export function checkPassword(share, password) {
  if (!share.password) return true;
  return verifyPassword(String(password || ''), share.password);
}

// Client-safe view: never expose the password hash.
export function publicShare(share) {
  return {
    token: share.token,
    type: share.type,
    refId: share.refId,
    title: share.title,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    hasPassword: !!share.password,
    url: `/share/${share.token}`,
  };
}
