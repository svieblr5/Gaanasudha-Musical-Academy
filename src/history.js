import { readJson, writeJson } from './store.js';

const FILE = 'history.json';
const RECENT_LIMIT = 60;

// Shape: { counts: { [trackId]: n }, recent: { [userId]: [ { id, at } ] } }
function load() {
  const d = readJson(FILE, {});
  return { counts: d.counts || {}, recent: d.recent || {} };
}
function save(data) {
  writeJson(FILE, data);
}

// Record a play: bump the global count and prepend to the user's recent list.
export function recordPlay(userId, trackId) {
  const data = load();
  data.counts[trackId] = (data.counts[trackId] || 0) + 1;
  const list = (data.recent[userId] || []).filter((e) => e.id !== trackId);
  list.unshift({ id: trackId, at: new Date().toISOString() });
  data.recent[userId] = list.slice(0, RECENT_LIMIT);
  save(data);
  return data.counts[trackId];
}

export function recentIds(userId) {
  return (load().recent[userId] || []).map((e) => e.id);
}

export function playCount(trackId) {
  return load().counts[trackId] || 0;
}

// Track ids sorted by global play count (descending), most-played first.
export function topIds(limit = 50) {
  const { counts } = load();
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}
