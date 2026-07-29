import { readJson, writeJson } from './store.js';

const FILE = 'favorites.json';

// Shape: { [userId]: [trackId, ...] }
function load() {
  return readJson(FILE, {});
}
function save(data) {
  writeJson(FILE, data);
}

export function listIds(userId) {
  return load()[userId] || [];
}

export function isFavorite(userId, trackId) {
  return listIds(userId).includes(trackId);
}

export function add(userId, trackId) {
  const data = load();
  const set = new Set(data[userId] || []);
  set.add(trackId);
  data[userId] = [...set];
  save(data);
  return data[userId];
}

export function remove(userId, trackId) {
  const data = load();
  data[userId] = (data[userId] || []).filter((id) => id !== trackId);
  save(data);
  return data[userId];
}
