// Similarity / radio engine — computed entirely from the local library.
// Signals: same artist, same genre, same album, playlist co-occurrence,
// and overall popularity (play counts), with a little randomness for variety.
import { readJson } from './store.js';
import { allTracks, getTrack } from './library.js';
import { playCount } from './history.js';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function allPlaylists() {
  return readJson('playlists.json', []);
}

// For a seed track, how many playlists pair each other track with it.
function coOccurrence(seedId) {
  const counts = new Map();
  for (const pl of allPlaylists()) {
    if (!pl.trackIds.includes(seedId)) continue;
    for (const id of pl.trackIds) {
      if (id !== seedId) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

// Score every other track's similarity to the seed and return them, best first.
export function similarTracks(seedId, limit = 40) {
  const seed = getTrack(seedId);
  if (!seed) return [];
  const co = coOccurrence(seedId);
  const scored = [];
  for (const t of allTracks()) {
    if (t.id === seedId) continue;
    let score = 0;
    if (t.artist === seed.artist) score += 4;
    if (seed.genre && t.genre === seed.genre) score += 3;
    if (t.album === seed.album && t.artist === seed.artist) score += 1;
    const c = co.get(t.id);
    if (c) score += Math.min(5, c * 2);
    if (score === 0) continue; // unrelated — leave for random padding
    score += Math.log1p(playCount(t.id)) * 0.5; // gentle popularity nudge
    score += Math.random() * 1.5; // variety
    scored.push([score, t]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, t]) => t);
}

// Ensure a list reaches `limit` by padding with random unused tracks —
// keeps a radio station endless even in a small library.
function padRandom(list, limit, excludeIds) {
  const seen = new Set(excludeIds);
  const out = [];
  for (const t of list) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  if (out.length < limit) {
    for (const t of shuffle(allTracks())) {
      if (out.length >= limit) break;
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out.slice(0, limit);
}

// A station based on a single song. excludeSeed=true is used for autoplay
// (continue with *other* similar songs); false puts the seed first (song radio).
export function trackStation(seedId, { limit = 40, excludeSeed = false } = {}) {
  const seed = getTrack(seedId);
  if (!seed) return [];
  const similar = shuffle(similarTracks(seedId, limit * 2));
  const base = excludeSeed ? similar : [seed, ...similar];
  return padRandom(base, limit, excludeSeed ? [seedId] : []);
}

// A station based on an artist: their songs interleaved with same-genre songs
// by other artists, then padded to length.
export function artistRadio(artist, limit = 50) {
  const all = allTracks();
  const own = shuffle(all.filter((t) => t.artist === artist));
  const genres = new Set(own.map((t) => t.genre).filter(Boolean));
  const related = shuffle(
    all.filter((t) => t.artist !== artist && t.genre && genres.has(t.genre)),
  );

  // Interleave ~2 of the artist's songs to 1 related song.
  const mixed = [];
  let i = 0;
  let j = 0;
  while (i < own.length || j < related.length) {
    if (i < own.length) mixed.push(own[i++]);
    if (i < own.length) mixed.push(own[i++]);
    if (j < related.length) mixed.push(related[j++]);
  }
  return padRandom(mixed, limit, []);
}
