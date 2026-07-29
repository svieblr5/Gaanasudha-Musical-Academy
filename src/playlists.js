import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';

const FILE = 'playlists.json';

function load() {
  return readJson(FILE, []);
}
function save(list) {
  writeJson(FILE, list);
}

// Playlists owned by a user (admins still only see their own here).
export function listForUser(userId) {
  return load().filter((p) => p.ownerId === userId);
}

export function get(id) {
  return load().find((p) => p.id === id);
}

export function create(userId, name) {
  const list = load();
  const playlist = {
    id: crypto.randomUUID(),
    ownerId: userId,
    name: String(name || 'Untitled Playlist').slice(0, 120),
    trackIds: [],
    createdAt: new Date().toISOString(),
  };
  list.push(playlist);
  save(list);
  return playlist;
}

export function rename(id, userId, name) {
  const list = load();
  const p = list.find((x) => x.id === id && x.ownerId === userId);
  if (!p) return null;
  p.name = String(name || p.name).slice(0, 120);
  save(list);
  return p;
}

export function remove(id, userId) {
  const list = load();
  const next = list.filter((p) => !(p.id === id && p.ownerId === userId));
  if (next.length === list.length) return false;
  save(next);
  return true;
}

export function addTrack(id, userId, trackId) {
  const list = load();
  const p = list.find((x) => x.id === id && x.ownerId === userId);
  if (!p) return null;
  if (!p.trackIds.includes(trackId)) p.trackIds.push(trackId);
  save(list);
  return p;
}

export function removeTrack(id, userId, trackId) {
  const list = load();
  const p = list.find((x) => x.id === id && x.ownerId === userId);
  if (!p) return null;
  p.trackIds = p.trackIds.filter((t) => t !== trackId);
  save(list);
  return p;
}
