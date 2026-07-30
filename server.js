import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import compression from 'compression';
import QRCode from 'qrcode';

import {
  PORT, PUBLIC_DIR, MUSIC_DIR, SESSION_SECRET, MIME,
} from './src/config.js';
import * as auth from './src/auth.js';
import * as lib from './src/library.js';
import * as playlists from './src/playlists.js';
import * as shares from './src/shares.js';
import * as favorites from './src/favorites.js';
import * as history from './src/history.js';
import * as recommend from './src/recommend.js';
import * as ratelimit from './src/ratelimit.js';
import { FileSessionStore } from './src/session-store.js';

const app = express();
// Behind the ngrok tunnel the real client address arrives via X-Forwarded-For;
// trusting it makes req.ip reflect the actual visitor (used for login throttling).
app.set('trust proxy', true);
app.disable('x-powered-by');

// Gzip text responses (HTML/CSS/JS/JSON/SVG). Audio (audio/*) is not in the
// compressible list, so range streaming is passed through untouched.
app.use(compression());

// Security headers on every response (the portal is public via the tunnel).
// CSP allows 'unsafe-inline' because the UI relies on inline handlers/styles;
// everything else is locked to same-origin.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Mic is allowed for same-origin (the Studio mixer needs it); camera/geo stay off.
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(self)');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      // blob: needed for uploaded-file playback + recorded-mix download in Studio.
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "worker-src 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    store: new FileSessionStore(),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // secure: 'auto' (with trust proxy) → Secure cookie over HTTPS (ngrok / the
    // Caddy domain), plain cookie over http://localhost, so all setups work.
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 3600 * 1000 },
  }),
);

// ---------------------------------------------------------------------------
// Audio streaming with HTTP Range support (required for seeking + mobile).
// ---------------------------------------------------------------------------
function streamAudio(req, res, filePath, ext) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
  const total = stat.size;
  const mime = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end) {
      return res.status(416).set('Content-Range', `bytes */${total}`).end();
    }
    res.status(206).set({
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.status(200).set({
    'Content-Length': total,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  });
  return fs.createReadStream(filePath).pipe(res);
}

function sendArt(res, artFile) {
  if (!artFile) return res.status(404).end();
  const p = lib.artPath(artFile);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  return res.sendFile(p);
}

// ===========================================================================
// Auth routes
// ===========================================================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  // Reject early if this IP+username is currently locked out.
  const gate = ratelimit.check(req.ip, username);
  if (gate.blocked) {
    return res
      .status(429)
      .set('Retry-After', String(gate.retryAfter))
      .json({
        error: `Too many failed attempts. Try again in ${Math.ceil(gate.retryAfter / 60)} minute(s).`,
      });
  }

  const user = auth.findUser(username);
  if (!user || !auth.verifyPassword(String(password || ''), user.password)) {
    const after = ratelimit.recordFailure(req.ip, username);
    if (after.blocked) {
      return res
        .status(429)
        .set('Retry-After', String(after.retryAfter))
        .json({
          error: `Too many failed attempts. Try again in ${Math.ceil(after.retryAfter / 60)} minute(s).`,
        });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  ratelimit.recordSuccess(req.ip, username);
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ user: auth.publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: auth.publicUser(auth.findUserById(req.session.userId)) });
});

app.post('/api/me/password', auth.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const users = auth.loadUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user || !auth.verifyPassword(String(currentPassword || ''), user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  user.password = auth.hashPassword(String(newPassword));
  auth.saveUsers(users);
  res.json({ ok: true });
});

// ===========================================================================
// Library + streaming (authenticated)
// ===========================================================================
app.get('/api/stats', auth.requireAuth, (req, res) => {
  res.json({ ...lib.stats(), scanning: lib.isScanning() });
});

app.get('/api/tracks', auth.requireAuth, (req, res) => {
  const { q, sort, limit, offset } = req.query;
  res.json(lib.search({ q, sort, limit, offset }));
});

// Unified search: songs + albums + artists.
app.get('/api/search', auth.requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 6, 20);
  res.json(lib.searchAll(req.query.q || '', limit));
});

app.get('/api/tracks/:id', auth.requireAuth, (req, res) => {
  const track = lib.getTrack(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json(track);
});

app.get('/api/stream/:id', auth.requireAuth, (req, res) => {
  const track = lib.getTrack(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  streamAudio(req, res, lib.absPath(track), track.ext);
});

app.get('/api/art/:id', auth.requireAuth, (req, res) => {
  const track = lib.getTrack(req.params.id);
  sendArt(res, track && track.art);
});

// Force-download a track with a friendly filename.
app.get('/api/download/:id', auth.requireAuth, (req, res) => {
  const track = lib.getTrack(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const safe = `${track.artist} - ${track.title}.${track.ext}`.replace(/[/\\?%*:|"<>]/g, '_');
  res.download(lib.absPath(track), safe);
});

// Browse by album / artist (aggregated from the library).
app.get('/api/albums', auth.requireAuth, (req, res) => res.json(lib.getAlbums()));

app.get('/api/albums/:key', auth.requireAuth, (req, res) => {
  const album = lib.getAlbumTracks(req.params.key);
  if (!album) return res.status(404).json({ error: 'Album not found' });
  res.json(album);
});

app.get('/api/artists', auth.requireAuth, (req, res) => res.json(lib.getArtists()));

app.get('/api/artists/:name/tracks', auth.requireAuth, (req, res) => {
  res.json(lib.getArtistTracks(req.params.name));
});

app.get('/api/recently-added', auth.requireAuth, (req, res) => {
  res.json(lib.getRecentlyAdded(30));
});

app.get('/api/genres', auth.requireAuth, (req, res) => res.json(lib.getGenres()));

app.get('/api/genres/:name/tracks', auth.requireAuth, (req, res) => {
  res.json(lib.getGenreTracks(req.params.name));
});

app.get('/api/lyrics/:id', auth.requireAuth, async (req, res) => {
  const track = lib.getTrack(req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  res.json((await lib.getLyrics(track)) || { source: null, text: '' });
});

// Radio / autoplay stations.
app.get('/api/radio/track/:id', auth.requireAuth, (req, res) => {
  if (!lib.getTrack(req.params.id)) return res.status(404).json({ error: 'Track not found' });
  res.json(
    recommend.trackStation(req.params.id, {
      limit: Math.min(Number(req.query.limit) || 40, 100),
      excludeSeed: req.query.excludeSeed === '1',
    }),
  );
});

app.get('/api/radio/artist/:name', auth.requireAuth, (req, res) => {
  res.json(recommend.artistRadio(req.params.name, Math.min(Number(req.query.limit) || 50, 100)));
});

// A single call that fills the Home page shelves (mix of global + per-user).
app.get('/api/home', auth.requireAuth, (req, res) => {
  const favIds = favorites.listIds(req.session.userId);
  const recentIds = history.recentIds(req.session.userId);
  res.json({
    recentlyAdded: lib.getRecentlyAdded(20),
    mostPlayed: lib
      .tracksByIds(history.topIds(20))
      .map((t) => ({ ...t, plays: history.playCount(t.id) })),
    favorites: lib.tracksByIds(favIds).slice(0, 20),
    recentlyPlayed: lib.tracksByIds(recentIds).slice(0, 20),
    discover: lib.randomTracks(20),
  });
});

// ---- Favorites (per user) ----
app.get('/api/favorites', auth.requireAuth, (req, res) => {
  res.json(lib.tracksByIds(favorites.listIds(req.session.userId)));
});

app.get('/api/favorites/ids', auth.requireAuth, (req, res) => {
  res.json(favorites.listIds(req.session.userId));
});

app.put('/api/favorites/:trackId', auth.requireAuth, (req, res) => {
  if (!lib.getTrack(req.params.trackId)) return res.status(404).json({ error: 'Track not found' });
  favorites.add(req.session.userId, req.params.trackId);
  res.json({ ok: true, favorite: true });
});

app.delete('/api/favorites/:trackId', auth.requireAuth, (req, res) => {
  favorites.remove(req.session.userId, req.params.trackId);
  res.json({ ok: true, favorite: false });
});

// ---- Play history + counts ----
app.post('/api/plays/:trackId', auth.requireAuth, (req, res) => {
  if (!lib.getTrack(req.params.trackId)) return res.status(404).json({ error: 'Track not found' });
  const count = history.recordPlay(req.session.userId, req.params.trackId);
  res.json({ ok: true, count });
});

app.get('/api/history/recent', auth.requireAuth, (req, res) => {
  res.json(lib.tracksByIds(history.recentIds(req.session.userId)));
});

app.get('/api/history/top', auth.requireAuth, (req, res) => {
  const top = lib.tracksByIds(history.topIds(50));
  res.json(top.map((t) => ({ ...t, plays: history.playCount(t.id) })));
});

// ===========================================================================
// Playlists (authenticated, per-user)
// ===========================================================================
app.get('/api/playlists', auth.requireAuth, (req, res) => {
  res.json(playlists.listForUser(req.session.userId));
});

app.post('/api/playlists', auth.requireAuth, (req, res) => {
  res.json(playlists.create(req.session.userId, req.body?.name));
});

app.get('/api/playlists/:id', auth.requireAuth, (req, res) => {
  const p = playlists.get(req.params.id);
  if (!p || p.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Playlist not found' });
  }
  const tracks = p.trackIds.map((id) => lib.getTrack(id)).filter(Boolean);
  res.json({ ...p, tracks });
});

app.patch('/api/playlists/:id', auth.requireAuth, (req, res) => {
  const p = playlists.rename(req.params.id, req.session.userId, req.body?.name);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  res.json(p);
});

app.delete('/api/playlists/:id', auth.requireAuth, (req, res) => {
  const ok = playlists.remove(req.params.id, req.session.userId);
  if (!ok) return res.status(404).json({ error: 'Playlist not found' });
  res.json({ ok: true });
});

app.post('/api/playlists/:id/tracks', auth.requireAuth, (req, res) => {
  const p = playlists.addTrack(req.params.id, req.session.userId, req.body?.trackId);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  res.json(p);
});

app.delete('/api/playlists/:id/tracks/:trackId', auth.requireAuth, (req, res) => {
  const p = playlists.removeTrack(req.params.id, req.session.userId, req.params.trackId);
  if (!p) return res.status(404).json({ error: 'Playlist not found' });
  res.json(p);
});

// ===========================================================================
// Share links (create/list/delete require auth; access is public)
// ===========================================================================
app.get('/api/shares', auth.requireAuth, (req, res) => {
  res.json(shares.listForUser(req.session.userId));
});

app.post('/api/shares', auth.requireAuth, (req, res) => {
  const { type, refId, title, expiresInDays, password } = req.body || {};
  if (!['track', 'playlist'].includes(type) || !refId) {
    return res.status(400).json({ error: 'A track or playlist is required' });
  }
  if (type === 'track' && !lib.getTrack(refId)) {
    return res.status(404).json({ error: 'Track not found' });
  }
  if (type === 'playlist') {
    const p = playlists.get(refId);
    if (!p || p.ownerId !== req.session.userId) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
  }
  res.json(
    shares.create({
      type,
      refId,
      title,
      createdBy: req.session.userId,
      expiresInDays: Number(expiresInDays) || null,
      password: password || null,
    }),
  );
});

app.delete('/api/shares/:token', auth.requireAuth, (req, res) => {
  const ok = shares.remove(req.params.token, req.session.userId);
  if (!ok) return res.status(404).json({ error: 'Share not found' });
  res.json({ ok: true });
});

// Generate a QR code (SVG) for any text — used to display share-link QR codes.
app.get('/api/qr', auth.requireAuth, async (req, res) => {
  const data = String(req.query.data || '').slice(0, 1024);
  if (!data) return res.status(400).json({ error: 'data required' });
  try {
    const svg = await QRCode.toString(data, {
      type: 'svg',
      margin: 1,
      color: { dark: '#0f1020', light: '#ffffff' },
    });
    res.set('Cache-Control', 'public, max-age=3600').type('image/svg+xml').send(svg);
  } catch {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ---- Public share access (no login) ----
// Resolve a share token, enforcing expiry + optional password.
function resolveShare(req, res) {
  const share = shares.get(req.params.token);
  if (!share) {
    res.status(404).json({ error: 'This share link does not exist' });
    return null;
  }
  if (shares.isExpired(share)) {
    res.status(410).json({ error: 'This share link has expired' });
    return null;
  }
  const pw = req.query.pw ?? req.headers['x-share-password'];
  if (!shares.checkPassword(share, pw)) {
    res.status(401).json({ error: 'Password required', needsPassword: true });
    return null;
  }
  return share;
}

// Tracks belonging to a share (single track or whole playlist).
function shareTracks(share) {
  if (share.type === 'track') {
    const t = lib.getTrack(share.refId);
    return t ? [t] : [];
  }
  const p = playlists.get(share.refId);
  if (!p) return [];
  return p.trackIds.map((id) => lib.getTrack(id)).filter(Boolean);
}

app.get('/api/public/shares/:token', (req, res) => {
  const share = resolveShare(req, res);
  if (!share) return;
  const tracks = shareTracks(share).map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    hasArt: !!t.art,
  }));
  res.json({ ...shares.publicShare(share), tracks });
});

app.get('/api/public/shares/:token/stream/:trackId', (req, res) => {
  const share = resolveShare(req, res);
  if (!share) return;
  const allowed = new Set(shareTracks(share).map((t) => t.id));
  if (!allowed.has(req.params.trackId)) {
    return res.status(403).json({ error: 'Track not part of this share' });
  }
  const track = lib.getTrack(req.params.trackId);
  streamAudio(req, res, lib.absPath(track), track.ext);
});

app.get('/api/public/shares/:token/art/:trackId', (req, res) => {
  const share = resolveShare(req, res);
  if (!share) return;
  const allowed = new Set(shareTracks(share).map((t) => t.id));
  if (!allowed.has(req.params.trackId)) return res.status(403).end();
  const track = lib.getTrack(req.params.trackId);
  sendArt(res, track && track.art);
});

// ===========================================================================
// Admin: scan, uploads, user management
// ===========================================================================
app.post('/api/admin/scan', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  if (lib.isScanning()) return res.status(409).json({ error: 'A scan is already running' });
  // Kick off the scan in the background; report current count immediately.
  lib.scanLibrary().catch((e) => console.error('Scan failed:', e));
  res.json({ ok: true, started: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(MUSIC_DIR, { recursive: true });
      cb(null, MUSIC_DIR);
    },
    filename: (req, file, cb) => cb(null, safeFilename(file.originalname)),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB / file
});

function safeFilename(name) {
  const base = path.basename(name).replace(/[/\\?%*:|"<>]/g, '_');
  const p = path.join(MUSIC_DIR, base);
  if (!fs.existsSync(p)) return base;
  const ext = path.extname(base);
  return `${path.basename(base, ext)}-${Date.now()}${ext}`;
}

app.post(
  '/api/admin/upload',
  auth.requireAuth,
  auth.requireAdmin,
  upload.array('files', 100),
  async (req, res) => {
    await lib.scanLibrary().catch((e) => console.error('Post-upload scan failed:', e));
    res.json({ ok: true, uploaded: (req.files || []).map((f) => f.originalname) });
  },
);

app.get('/api/admin/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.loadUsers().map(auth.publicUser));
});

app.post('/api/admin/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Username and a 6+ character password are required' });
  }
  try {
    res.json(auth.createUser({ username, password, displayName, role }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/users/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const users = auth.loadUsers();
  const next = users.filter((u) => u.id !== req.params.id);
  if (next.length === users.length) return res.status(404).json({ error: 'User not found' });
  auth.saveUsers(next);
  res.json({ ok: true });
});

// Lightweight health check (for uptime monitors / the tunnel).
app.get('/healthz', (req, res) => {
  res.json({ ok: true, tracks: lib.stats().tracks, uptime: Math.round(process.uptime()) });
});

// ===========================================================================
// Static frontend + public share page
// ===========================================================================
app.use(express.static(PUBLIC_DIR));

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'share.html'));
});

// Unmatched API routes get a clean JSON 404 (not the HTML default).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — log the detail, return a generic message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Server error' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
auth.seedAdmin();
const cachedCount = lib.loadCachedLibrary();
console.log(`\n  Gaanasudha Music Portal`);
console.log(`  Loaded ${cachedCount} track(s) from cache.`);
if (cachedCount === 0) {
  // Fresh install with an empty (or unscanned) library — scan on boot.
  lib.scanLibrary().then((n) => console.log(`  Initial scan complete: ${n} track(s).`))
    .catch((e) => console.error('Initial scan failed:', e));
}

app.listen(PORT, () => {
  console.log(`  Running at  http://localhost:${PORT}\n`);
});
