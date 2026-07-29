// ===========================================================================
//  Gaanasudha Music Portal — front-end application
// ===========================================================================

const FALLBACK_COVER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
      '<rect width="80" height="80" rx="6" fill="%2326274a"/>' +
      '<text x="40" y="52" font-size="34" text-anchor="middle" fill="%239a9ac2">♫</text>' +
      '</svg>',
  );
window.coverError = (img) => {
  img.onerror = null;
  img.src = FALLBACK_COVER;
};

const $ = (sel) => document.querySelector(sel);
const state = {
  user: null,
  queue: [],
  index: -1,
  tracks: [],
  favTracks: [],
  sort: 'title',
  q: '',
  favorites: new Set(),
  shuffle: false,
  repeat: 'off', // 'off' | 'all' | 'one'
  autoplay: true, // keep playing similar songs when the queue ends
  transpose: 0, // semitone pitch shift (Web Audio worklet)
  eq: [0, 0, 0, 0, 0, 0], // equalizer band gains (dB)
  eqPreset: 'Flat',
};

// ---- helpers ----
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function fmtTime(sec) {
  if (!sec && sec !== 0) return '0:00';
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function coverImg(url, cls = 'cover') {
  return `<img class="${cls}" src="${url}" onerror="coverError(this)" alt="" />`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- modal ----
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBack').classList.add('open');
}
function closeModal() {
  $('#modalBack').classList.remove('open');
}
$('#modalBack').addEventListener('click', (e) => {
  if (e.target.id === 'modalBack') closeModal();
});

// ===========================================================================
//  Navigation
// ===========================================================================
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    switchView(item.dataset.view);
    closeDrawer(); // collapse the mobile menu after choosing
  });
});

// Mobile navigation drawer (hamburger).
const sidebarEl = document.getElementById('sidebar');
const navBackdrop = document.getElementById('navBackdrop');
const navToggleBtn = document.getElementById('navToggle');
function openDrawer() {
  sidebarEl.classList.add('open');
  if (navBackdrop) navBackdrop.hidden = false;
  navToggleBtn?.setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  sidebarEl.classList.remove('open');
  if (navBackdrop) navBackdrop.hidden = true;
  navToggleBtn?.setAttribute('aria-expanded', 'false');
}
navToggleBtn?.addEventListener('click', () =>
  sidebarEl.classList.contains('open') ? closeDrawer() : openDrawer(),
);
navBackdrop?.addEventListener('click', closeDrawer);

function switchView(view) {
  // Not a real view — open the shareable QR poster in a new tab.
  if (view === 'practice-share') {
    window.open('/practice-share.html', '_blank');
    return;
  }
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.classList.toggle('active', n.dataset.view === view),
  );
  document.querySelectorAll('.view').forEach((v) =>
    v.classList.toggle('active', v.id === `view-${view}`),
  );
  if (view === 'playlists') loadPlaylists();
  if (view === 'shares') loadShares();
  if (view === 'users') loadUsers();
  if (view === 'albums') loadAlbums();
  if (view === 'artists') loadArtists();
  if (view === 'favorites') loadFavorites();
  if (view === 'recent') loadRecent();
  if (view === 'top') loadTop();
  if (view === 'home') loadHome();
  if (view === 'genres') loadGenres();
  if (view === 'queue') loadQueue();
}

// ===========================================================================
//  Startup
// ===========================================================================
init();
async function init() {
  const { user } = await api('/api/me');
  if (!user) {
    location.href = '/login.html';
    return;
  }
  state.user = user;
  setupUserMenu();
  if (user.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach((el) => (el.style.display = ''));
  }
  bindPlayer();
  bindGlobalButtons();
  bindKeyboard();
  bindExtras();
  await loadStats();
  await loadFavoriteIds();
  await loadTracks();
  await loadHome();
}

function bindGlobalButtons() {
  setupSearch();
  $('#brand').addEventListener('click', () => switchView('home'));
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    loadTracks();
  });
  $('#rescanBtn')?.addEventListener('click', async () => {
    await api('/api/admin/scan', { method: 'POST' });
    toast('Rescan started — refreshing shortly…');
    setTimeout(async () => {
      await loadStats();
      await loadTracks();
    }, 2500);
  });
  $('#newPlaylistBtn').addEventListener('click', newPlaylistModal);
  $('#newShareBtn').addEventListener('click', newShareModal);
  $('#changePwBtn').addEventListener('click', changePassword);
  $('#newUserBtn')?.addEventListener('click', newUserModal);
  $('#playAllBtn').addEventListener('click', () => {
    if (state.tracks.length) { setShuffle(false); playFromList(state.tracks, 0); }
  });
  $('#shuffleAllBtn').addEventListener('click', () => {
    if (state.tracks.length) { setShuffle(true); playFromList(state.tracks, rand(state.tracks.length)); }
  });
  $('#favPlayBtn').addEventListener('click', () => {
    if (state.favTracks.length) playFromList(state.favTracks, 0);
  });
  $('#albumBack').addEventListener('click', () => switchView('albums'));
  $('#artistBack').addEventListener('click', () => switchView('artists'));
  bindUpload();
}

const rand = (n) => Math.floor(Math.random() * n);

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Top-bar search: filters the library AND shows a live suggestions dropdown.
function setupSearch() {
  const input = $('#search');
  const clear = $('#searchClear');
  const box = $('#searchSuggest');

  const run = debounce(async () => {
    const q = input.value.trim();
    state.q = q;
    loadTracks();
    clear.style.display = q ? '' : 'none';
    if (!q) {
      box.classList.remove('open');
      box.innerHTML = '';
      return;
    }
    const res = await api(`/api/search?q=${encodeURIComponent(q)}&limit=4`);
    const close = () => box.classList.remove('open');
    const artUrl = (id) => (id ? `/api/art/${id}` : FALLBACK_COVER);
    const parts = [];

    if (res.artists.length) {
      parts.push(
        '<div class="sg-head">Artists</div>' +
          res.artists
            .map(
              (a) => `
        <button class="sg-item sg-artist" data-name="${esc(a.artist)}">
          <img class="sg-art sg-round" src="${artUrl(a.art)}" onerror="coverError(this)" alt="" />
          <span class="sg-t"><span>${esc(a.artist)}</span><span class="sg-s">Artist · ${a.tracks} song(s)</span></span>
        </button>`,
            )
            .join(''),
      );
    }
    if (res.albums.length) {
      parts.push(
        '<div class="sg-head">Albums</div>' +
          res.albums
            .map(
              (a) => `
        <button class="sg-item sg-album" data-key="${a.key}">
          <img class="sg-art" src="${artUrl(a.art)}" onerror="coverError(this)" alt="" />
          <span class="sg-t"><span>${esc(a.album)}</span><span class="sg-s">Album · ${esc(a.artist)}</span></span>
        </button>`,
            )
            .join(''),
      );
    }
    if (res.songs.length) {
      parts.push(
        '<div class="sg-head">Songs</div>' +
          res.songs
            .map(
              (t) => `
        <button class="sg-item sg-song" data-id="${t.id}">
          <img class="sg-art" src="${artUrl(t.id)}" onerror="coverError(this)" alt="" />
          <span class="sg-t"><span>${esc(t.title)}</span><span class="sg-s">${esc(t.artist)}</span></span>
        </button>`,
            )
            .join(''),
      );
    }

    if (!parts.length) {
      box.innerHTML = '<div class="sg-empty">No matches</div>';
    } else {
      box.innerHTML = parts.join('') + `<button class="sg-all">See all songs for “${esc(q)}”</button>`;
      box.querySelectorAll('.sg-artist').forEach((b) =>
        b.addEventListener('click', () => {
          openArtist(b.dataset.name);
          close();
        }),
      );
      box.querySelectorAll('.sg-album').forEach((b) =>
        b.addEventListener('click', () => {
          openAlbum(b.dataset.key);
          close();
        }),
      );
      box.querySelectorAll('.sg-song').forEach((b) =>
        b.addEventListener('click', () => {
          playFromList(res.songs, res.songs.findIndex((t) => t.id === b.dataset.id));
          close();
        }),
      );
      box.querySelector('.sg-all').addEventListener('click', () => {
        switchView('library');
        close();
      });
    }
    box.classList.add('open');
  }, 200);

  input.addEventListener('input', run);
  input.addEventListener('focus', () => {
    if (input.value.trim() && box.innerHTML) box.classList.add('open');
  });
  clear.addEventListener('click', () => {
    input.value = '';
    state.q = '';
    loadTracks();
    clear.style.display = 'none';
    box.classList.remove('open');
    input.focus();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) box.classList.remove('open');
  });
}

// Top-bar avatar + account dropdown.
function setupUserMenu() {
  const u = state.user;
  const initials = u.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  $('#avatar').textContent = initials || 'U';
  $('#userName').textContent = u.displayName;

  const dd = $('#userDropdown');
  dd.innerHTML = `
    <div class="dd-head"><strong>${esc(u.displayName)}</strong>
      <span class="pill ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? 'Admin' : 'User'}</span>
    </div>
    <button data-v="account">👤  My Account</button>
    ${u.role === 'admin' ? '<button data-v="upload">⬆️  Upload Music</button><button data-v="users">👥  Manage Users</button>' : ''}
    <div class="sep"></div>
    <button data-logout="1">🚪  Sign out</button>`;

  $('#avatarBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    dd.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#userMenu')) dd.classList.remove('open');
  });
  dd.querySelectorAll('button[data-v]').forEach((b) =>
    b.addEventListener('click', () => {
      dd.classList.remove('open');
      switchView(b.dataset.v);
    }),
  );
  dd.querySelector('button[data-logout]').addEventListener('click', async () => {
    window.PracticeTools?.stopAll();
    await api('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}

// ===========================================================================
//  Library
// ===========================================================================
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#stats').innerHTML = [
      ['Songs', s.tracks],
      ['Artists', s.artists],
      ['Albums', s.albums],
      ['Total time', fmtDuration(s.totalDuration)],
    ]
      .map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`)
      .join('');
    if (s.scanning) {
      $('#librarySub').textContent = 'Scanning library… counts will update shortly.';
    }
  } catch {}
}

function fmtDuration(sec) {
  if (!sec) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${Math.round(sec)}s`;
}

async function loadTracks() {
  const data = await api(
    `/api/tracks?q=${encodeURIComponent(state.q)}&sort=${state.sort}&limit=500`,
  );
  state.tracks = data.items;
  renderTrackTable($('#trackTableWrap'), data.items, {
    emptyMsg: state.q
      ? 'No songs match your search.'
      : 'No songs yet. Admins can upload music or add files to the <code>music</code> folder.',
    footer: `${data.items.length} of ${data.total} songs shown.`,
  });
}

// ---- Reusable track table (used by every song list in the app) ----
function trackRows(items) {
  return items
    .map(
      (t, i) => `
      <tr data-index="${i}" data-id="${t.id}">
        <td style="width:52px">${coverImg(`/api/art/${t.id}`)}</td>
        <td class="cell-title">${esc(t.title)}<div class="cell-sub">${esc(t.album)}${
          t.plays ? ` · ${t.plays} plays` : ''
        }</div></td>
        <td>${esc(t.artist)}</td>
        <td class="muted">${t.year || ''}</td>
        <td class="muted">${fmtTime(t.duration)}</td>
        <td>
          <div class="row-actions">
            <button class="ghost tiny act-fav" title="Favorite">${state.favorites.has(t.id) ? '❤' : '🤍'}</button>
            <button class="ghost tiny act-menu" title="More options">⋯</button>
          </div>
        </td>
      </tr>`,
    )
    .join('');
}

function renderTrackTable(container, items, opts = {}) {
  if (!items.length) {
    container.innerHTML = `<div class="empty">${opts.emptyMsg || 'No songs here yet.'}</div>`;
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th></th><th>Title</th><th>Artist</th><th>Year</th><th>Time</th><th></th></tr></thead>
      <tbody>${trackRows(items)}</tbody>
    </table>
    ${opts.footer ? `<p class="muted" style="margin-top:12px;font-size:13px">${opts.footer}</p>` : ''}`;
  container.querySelectorAll('tbody tr').forEach((tr) => {
    const idx = Number(tr.dataset.index);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      playFromList(items, idx);
    });
    tr.querySelector('.act-fav').addEventListener('click', () =>
      toggleFav(tr.dataset.id, tr.querySelector('.act-fav')),
    );
    tr.querySelector('.act-menu').addEventListener('click', (e) => openTrackMenu(e, items[idx]));
  });
  highlightPlaying();
}

// ---- Favorites ----
async function loadFavoriteIds() {
  try {
    state.favorites = new Set(await api('/api/favorites/ids'));
  } catch {}
}

async function toggleFav(id, btn) {
  if (state.favorites.has(id)) {
    await api(`/api/favorites/${id}`, { method: 'DELETE' });
    state.favorites.delete(id);
  } else {
    await api(`/api/favorites/${id}`, { method: 'PUT' });
    state.favorites.add(id);
  }
  const glyph = state.favorites.has(id) ? '❤' : '🤍';
  // Update every visible heart for this track.
  document.querySelectorAll('tr[data-id] .act-fav').forEach((b) => {
    if (b.closest('tr').dataset.id === id) b.textContent = glyph;
  });
}

async function loadFavorites() {
  state.favTracks = await api('/api/favorites');
  renderTrackTable($('#favWrap'), state.favTracks, {
    emptyMsg: 'No favorites yet. Tap 🤍 on any song to add it here.',
  });
}

async function loadRecent() {
  const items = await api('/api/history/recent');
  renderTrackTable($('#recentWrap'), items, { emptyMsg: 'Nothing played yet.' });
}

async function loadTop() {
  const items = await api('/api/history/top');
  renderTrackTable($('#topWrap'), items, { emptyMsg: 'No play data yet — start listening!' });
}

// ---- Albums & Artists ----
async function loadAlbums() {
  const albums = await api('/api/albums');
  const el = $('#albumGrid');
  if (!albums.length) {
    el.innerHTML = '<div class="empty">No albums yet.</div>';
    return;
  }
  el.innerHTML = albums
    .map(
      (a) => `
      <div class="pcard album-card" data-key="${a.key}">
        ${coverImg(a.art ? `/api/art/${a.art}` : FALLBACK_COVER, 'album-cover')}
        <h4>${esc(a.album)}</h4>
        <div class="meta">${esc(a.artist)} · ${a.count} song(s)</div>
      </div>`,
    )
    .join('');
  el.querySelectorAll('.album-card').forEach((c) =>
    c.addEventListener('click', () => openAlbum(c.dataset.key)),
  );
}

async function openAlbum(key) {
  const data = await api(`/api/albums/${key}`);
  state.albumTracks = data.tracks;
  switchView('album');
  $('#albumDetail').innerHTML = `
    <h2>${esc(data.album)}</h2>
    <p class="sub">${esc(data.artist)} · ${data.tracks.length} song(s)</p>
    <div class="toolbar">
      <button class="gold" id="albumPlay">▶ Play all</button>
      <button class="ghost" id="albumShuffle">🔀 Shuffle</button>
    </div>
    <div id="albumTracks"></div>`;
  renderTrackTable($('#albumTracks'), data.tracks);
  $('#albumPlay').onclick = () => { setShuffle(false); playFromList(state.albumTracks, 0); };
  $('#albumShuffle').onclick = () => { setShuffle(true); playFromList(state.albumTracks, rand(state.albumTracks.length)); };
}

async function loadArtists() {
  const artists = await api('/api/artists');
  const el = $('#artistGrid');
  if (!artists.length) {
    el.innerHTML = '<div class="empty">No artists yet.</div>';
    return;
  }
  el.innerHTML = artists
    .map(
      (a) => `
      <div class="pcard artist-card" data-name="${esc(a.artist)}">
        ${coverImg(a.art ? `/api/art/${a.art}` : FALLBACK_COVER, 'album-cover')}
        <h4>${esc(a.artist)}</h4>
        <div class="meta">${a.albums} album(s) · ${a.tracks} song(s)</div>
      </div>`,
    )
    .join('');
  el.querySelectorAll('.artist-card').forEach((c) =>
    c.addEventListener('click', () => openArtist(c.dataset.name)),
  );
}

async function openArtist(name) {
  const items = await api(`/api/artists/${encodeURIComponent(name)}/tracks`);
  state.artistTracks = items;
  switchView('artist');
  $('#artistDetail').innerHTML = `
    <h2>${esc(name)}</h2>
    <p class="sub">${items.length} song(s)</p>
    <div class="toolbar">
      <button class="gold" id="artistPlay">▶ Play all</button>
      <button class="ghost" id="artistRadio">📻 Artist radio</button>
    </div>
    <div id="artistTracks"></div>`;
  renderTrackTable($('#artistTracks'), items);
  $('#artistPlay').onclick = () => { setShuffle(false); playFromList(state.artistTracks, 0); };
  $('#artistRadio').onclick = () => startArtistRadio(name);
}

// Start an endless station seeded from an artist or a single song.
async function startArtistRadio(artist) {
  const list = await api(`/api/radio/artist/${encodeURIComponent(artist)}?limit=50`);
  if (!list.length) return toast('Not enough songs for radio');
  setShuffle(false);
  state.autoplay = true;
  $('#autoplayBtn').classList.add('on');
  playFromList(list, 0);
  toast(`📻 ${artist} radio`);
}

async function startSongRadio(track) {
  const list = await api(`/api/radio/track/${track.id}?limit=50`);
  if (!list.length) return toast('Not enough songs for radio');
  setShuffle(false);
  state.autoplay = true;
  $('#autoplayBtn').classList.add('on');
  playFromList(list, 0);
  toast(`📻 ${track.title} radio`);
}

// ===========================================================================
//  Player
// ===========================================================================
const audio = $('#audio');

// ---------------------------------------------------------------------------
//  Pitch-preserving tempo + transpose
//  Tempo is native (playbackRate with preservesPitch). Transpose runs through a
//  Web Audio pitch-shifter worklet, wired up lazily on first use so ordinary
//  playback stays fully native until someone actually transposes.
// ---------------------------------------------------------------------------
function applyPreservePitch() {
  // Standard + legacy vendor flags, so tempo changes never alter pitch.
  audio.preservesPitch = true;
  audio.mozPreservesPitch = true;
  audio.webkitPreservesPitch = true;
}

let audioCtx = null;
let pitchNode = null;
let eqNodes = [];
let chainReady = false;

// 6-band graphic EQ: shelf on the ends, peaking in the middle.
const EQ_BANDS = [
  { type: 'lowshelf', f: 80 },
  { type: 'peaking', f: 250 },
  { type: 'peaking', f: 800 },
  { type: 'peaking', f: 2500 },
  { type: 'peaking', f: 6000 },
  { type: 'highshelf', f: 12000 },
];

// One shared Web Audio chain feeds both the EQ and the transpose worklet:
//   <audio> → EQ band0 … band5 → pitch-shift → destination
// Built lazily on first use of either effect, so plain playback stays native.
async function ensureAudioChain() {
  if (chainReady) return true;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('/js/pitch-shift-worklet.js');
    const src = audioCtx.createMediaElementSource(audio);
    eqNodes = EQ_BANDS.map((b) => {
      const filt = audioCtx.createBiquadFilter();
      filt.type = b.type;
      filt.frequency.value = b.f;
      if (b.type === 'peaking') filt.Q.value = 1.1;
      filt.gain.value = 0;
      return filt;
    });
    pitchNode = new AudioWorkletNode(audioCtx, 'pitch-shift');
    let node = src;
    for (const band of eqNodes) { node.connect(band); node = band; }
    node.connect(pitchNode).connect(audioCtx.destination);
    // Push any EQ gains chosen before the chain existed.
    state.eq.forEach((g, i) => (eqNodes[i].gain.value = g));
    chainReady = true;
    return true;
  } catch (e) {
    console.error('Audio effects unavailable:', e);
    toast('Audio effects are not supported in this browser');
    return false;
  }
}

async function setTranspose(semi) {
  semi = Math.max(-7, Math.min(7, Math.round(semi)));
  state.transpose = semi;
  $('#trVal').textContent = semi > 0 ? `+${semi}` : String(semi);
  $('#trHint').textContent = semi === 0 ? 'original key' : `${semi > 0 ? '+' : ''}${semi} semitone${Math.abs(semi) === 1 ? '' : 's'}`;
  // Stay 100% native until the first non-zero transpose is requested.
  if (semi === 0 && !chainReady) return;
  if (!(await ensureAudioChain())) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const ratio = 2 ** (semi / 12);
  pitchNode.parameters.get('ratio').setValueAtTime(ratio, audioCtx.currentTime);
}

// ---- Equalizer ---------------------------------------------------------------
// Gains (dB) per band: [80, 250, 800, 2.5k, 6k, 12k].
const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0],
  'Vocal Clarity': [-2, -1, 2, 4, 2, 0],
  Warm: [4, 2, 0, -1, -2, -1],
  Bright: [-1, 0, 0, 2, 4, 5],
  'Bass Boost': [6, 3, 0, 0, 0, 0],
  'Treble Boost': [0, 0, 0, 2, 4, 6],
  Classical: [3, 1, 0, 1, 2, 3],
  Instrumental: [2, 0, 1, 2, 1, 1],
};

// Push a set of band gains onto the sliders, readouts, and live filters.
function applyEqGains(gains) {
  state.eq = gains.slice();
  gains.forEach((g, i) => {
    const s = $(`#eqBand${i}`);
    if (s) s.value = g;
    const v = $(`#eqVal${i}`);
    if (v) v.textContent = g > 0 ? `+${g}` : String(g);
    if (chainReady && eqNodes[i]) eqNodes[i].gain.setTargetAtTime(g, audioCtx.currentTime, 0.04);
  });
}

async function setEqPreset(name) {
  const gains = EQ_PRESETS[name];
  if (!gains) return; // "Custom" — leave the sliders as the user set them
  state.eqPreset = name;
  $('#eqPreset').value = name;
  // Only spin up the chain when leaving Flat (keeps plain playback native).
  if (name !== 'Flat' || chainReady) {
    if (!(await ensureAudioChain())) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  applyEqGains(gains);
}

async function setEqBand(i, gain) {
  state.eq[i] = gain;
  $(`#eqVal${i}`).textContent = gain > 0 ? `+${gain}` : String(gain);
  state.eqPreset = 'Custom';
  $('#eqPreset').value = 'Custom';
  if (!(await ensureAudioChain())) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  eqNodes[i].gain.setTargetAtTime(gain, audioCtx.currentTime, 0.04);
}

function bindPlayer() {
  $('#playBtn').addEventListener('click', togglePlay);
  $('#nextBtn').addEventListener('click', () => skip(1));
  $('#prevBtn').addEventListener('click', () => skip(-1));
  $('#shuffleBtn').addEventListener('click', () => setShuffle(!state.shuffle));
  $('#repeatBtn').addEventListener('click', cycleRepeat);
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      $('#seek').value = String((audio.currentTime / audio.duration) * 1000);
      $('#curTime').textContent = fmtTime(audio.currentTime);
      $('#durTime').textContent = fmtTime(audio.duration);
    }
  });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('play', () => ($('#playBtn').textContent = '⏸'));
  audio.addEventListener('pause', () => ($('#playBtn').textContent = '▶'));
  $('#seek').addEventListener('input', (e) => {
    if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
  });
  $('#vol').addEventListener('input', (e) => (audio.volume = e.target.value));
}

function setShuffle(on) {
  state.shuffle = on;
  $('#shuffleBtn').classList.toggle('active-ctl', on);
}

function cycleRepeat() {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  const b = $('#repeatBtn');
  b.classList.toggle('active-ctl', state.repeat !== 'off');
  b.textContent = state.repeat === 'one' ? '🔂' : '🔁';
  toast(`Repeat: ${state.repeat}`);
}

function playFromList(list, index) {
  state.queue = list;
  state.index = index;
  playCurrent();
}

function playCurrent() {
  const t = state.queue[state.index];
  if (!t) return;
  audio.src = `/api/stream/${t.id}`;
  audio.play().catch(() => {});
  $('#npTitle').textContent = t.title;
  $('#npArtist').textContent = t.artist;
  const cover = $('#npCover');
  cover.onerror = () => window.coverError(cover);
  cover.src = `/api/art/${t.id}`;
  highlightPlaying();
  api(`/api/plays/${t.id}`, { method: 'POST' }).catch(() => {}); // record play
  setMediaSession(t);
  loopA = loopB = null;
  updateAbStatus();
  if (npScreen.classList.contains('open')) updateNpScreen(t);
}

function togglePlay() {
  if (!audio.src) {
    if (state.tracks.length) playFromList(state.tracks, 0);
    return;
  }
  audio.paused ? audio.play() : audio.pause();
}

// Pick the next index honoring shuffle; may return >= length to signal "end".
function nextIndex() {
  if (state.shuffle && state.queue.length > 1) {
    let n;
    do { n = rand(state.queue.length); } while (n === state.index);
    return n;
  }
  return state.index + 1;
}

function skip(dir) {
  if (!state.queue.length) return;
  if (dir > 0) {
    const n = nextIndex();
    state.index = n >= state.queue.length ? 0 : n;
  } else if (state.shuffle) {
    state.index = nextIndex() % state.queue.length;
  } else {
    state.index = (state.index - 1 + state.queue.length) % state.queue.length;
  }
  playCurrent();
}

async function onEnded() {
  if (state.repeat === 'one') return playCurrent();
  const n = nextIndex();
  if (n < state.queue.length) {
    state.index = n;
    return playCurrent();
  }
  // Reached the end of the queue.
  if (state.repeat === 'all') {
    state.index = 0;
    return playCurrent();
  }
  if (state.autoplay) {
    const cur = state.queue[state.index];
    if (cur) {
      try {
        const more = await api(`/api/radio/track/${cur.id}?excludeSeed=1&limit=20`);
        const fresh = more.filter((t) => !state.queue.some((q) => q.id === t.id));
        if (fresh.length) {
          state.queue.push(...fresh);
          state.index += 1;
          toast('Autoplay — similar songs');
          if (isQueueView()) loadQueue();
          return playCurrent();
        }
      } catch {}
    }
  }
}

// Lock-screen / hardware media controls on phones and desktops.
function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: [{ src: `/api/art/${t.id}`, sizes: '500x500', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
  } catch {}
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeNpScreen();
      closeCtx();
      return;
    }
    if (e.target.matches('input, select, textarea')) return;
    if ($('#modalBack').classList.contains('open')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight' && e.shiftKey) {
      skip(1);
    } else if (e.code === 'ArrowLeft' && e.shiftKey) {
      skip(-1);
    } else if (e.code === 'ArrowRight' && audio.duration) {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    } else if (e.code === 'ArrowLeft' && audio.duration) {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    }
  });
}

function highlightPlaying() {
  const current = state.queue[state.index];
  document.querySelectorAll('.main tbody tr[data-id]').forEach((tr) => {
    tr.classList.toggle('playing', !!current && tr.dataset.id === current.id);
  });
}

// ===========================================================================
//  Playlists
// ===========================================================================
async function loadPlaylists() {
  const list = await api('/api/playlists');
  const el = $('#playlistList');
  if (!list.length) {
    el.innerHTML = '<div class="empty">No playlists yet. Create one to get started.</div>';
    $('#playlistDetail').innerHTML = '';
    return;
  }
  el.innerHTML = list
    .map(
      (p) => `
      <div class="pcard">
        <h4>${esc(p.name)}</h4>
        <div class="meta">${p.trackIds.length} song(s)</div>
        <div class="row">
          <button class="ghost tiny act-open" data-id="${p.id}">Open</button>
          <button class="ghost tiny act-share" data-id="${p.id}" data-name="${esc(p.name)}">Share</button>
          <button class="danger tiny act-del" data-id="${p.id}">Delete</button>
        </div>
      </div>`,
    )
    .join('');
  el.querySelectorAll('.act-open').forEach((b) =>
    b.addEventListener('click', () => openPlaylist(b.dataset.id)),
  );
  el.querySelectorAll('.act-share').forEach((b) =>
    b.addEventListener('click', () => shareModal('playlist', b.dataset.id, b.dataset.name)),
  );
  el.querySelectorAll('.act-del').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/playlists/${b.dataset.id}`, { method: 'DELETE' });
      toast('Playlist deleted');
      loadPlaylists();
    }),
  );
}

async function openPlaylist(id) {
  const p = await api(`/api/playlists/${id}`);
  const detail = $('#playlistDetail');
  const rows = p.tracks
    .map(
      (t, i) => `
      <tr data-index="${i}" data-id="${t.id}">
        <td style="width:52px">${coverImg(`/api/art/${t.id}`)}</td>
        <td class="cell-title">${esc(t.title)}</td>
        <td>${esc(t.artist)}</td>
        <td class="muted">${fmtTime(t.duration)}</td>
        <td><div class="row-actions"><button class="danger tiny act-rm">Remove</button></div></td>
      </tr>`,
    )
    .join('');
  detail.innerHTML = `
    <h3>${esc(p.name)}</h3>
    ${
      p.tracks.length
        ? `<table><tbody>${rows}</tbody></table>`
        : '<div class="empty">Empty playlist. Add songs from the Library using the ＋ button.</div>'
    }`;
  detail.querySelectorAll('tbody tr').forEach((tr) => {
    const idx = Number(tr.dataset.index);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      playFromList(p.tracks, idx);
    });
    tr.querySelector('.act-rm')?.addEventListener('click', async () => {
      await api(`/api/playlists/${id}/tracks/${tr.dataset.id}`, { method: 'DELETE' });
      openPlaylist(id);
      loadPlaylists();
    });
  });
}

function newPlaylistModal() {
  openModal(`
    <h3>New playlist</h3>
    <label>Name</label>
    <input id="plName" placeholder="e.g. Recital 2026" />
    <div class="actions">
      <button class="ghost" onclick="closeModal()">Cancel</button>
      <button class="gold" id="plCreate">Create</button>
    </div>`);
  $('#plCreate').addEventListener('click', async () => {
    const name = $('#plName').value.trim() || 'Untitled Playlist';
    await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    closeModal();
    loadPlaylists();
    toast('Playlist created');
  });
}

async function addToPlaylistModal(trackId) {
  const list = await api('/api/playlists');
  const options = list.length
    ? list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
    : '';
  openModal(`
    <h3>Add to playlist</h3>
    ${
      list.length
        ? `<label>Choose a playlist</label><select id="plSel">${options}</select>`
        : '<p class="muted">You have no playlists yet.</p>'
    }
    <label>Or create a new one</label>
    <input id="plNew" placeholder="New playlist name (optional)" />
    <div class="actions">
      <button class="ghost" onclick="closeModal()">Cancel</button>
      <button class="gold" id="plAdd">Add</button>
    </div>
    <div class="msg" id="plMsg"></div>`);
  $('#plAdd').addEventListener('click', async () => {
    try {
      let plId = list.length ? $('#plSel').value : null;
      const newName = $('#plNew').value.trim();
      if (newName) {
        const created = await api('/api/playlists', {
          method: 'POST',
          body: JSON.stringify({ name: newName }),
        });
        plId = created.id;
      }
      if (!plId) throw new Error('Pick or create a playlist');
      await api(`/api/playlists/${plId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ trackId }),
      });
      closeModal();
      toast('Added to playlist');
    } catch (e) {
      $('#plMsg').className = 'msg err';
      $('#plMsg').textContent = e.message;
    }
  });
}

// ===========================================================================
//  Share links
// ===========================================================================
function shareModal(type, refId, title) {
  openModal(`
    <h3>Create share link</h3>
    <p class="muted" style="margin:0 0 6px">Sharing: <strong>${esc(title)}</strong></p>
    <label>Link expires after</label>
    <select id="shExp">
      <option value="">Never</option>
      <option value="1">1 day</option>
      <option value="7" selected>7 days</option>
      <option value="30">30 days</option>
    </select>
    <label>Password (optional)</label>
    <input id="shPw" placeholder="Leave blank for no password" />
    <div class="actions">
      <button class="ghost" onclick="closeModal()">Cancel</button>
      <button class="gold" id="shCreate">Create link</button>
    </div>
    <div class="msg" id="shMsg"></div>`);
  $('#shCreate').addEventListener('click', async () => {
    try {
      const share = await api('/api/shares', {
        method: 'POST',
        body: JSON.stringify({
          type,
          refId,
          title,
          expiresInDays: $('#shExp').value || null,
          password: $('#shPw').value || null,
        }),
      });
      const full = location.origin + share.url;
      $('#modal').innerHTML = `
        <h3>Share link ready</h3>
        <p class="muted">Send this via WhatsApp, email, or any chat. No login needed to listen.</p>
        <div class="share-url">
          <input id="shUrl" value="${esc(full)}" readonly />
          <button class="gold" id="shCopy">Copy</button>
        </div>
        <div class="actions"><button class="ghost" onclick="closeModal()">Done</button></div>`;
      $('#shCopy').addEventListener('click', () => {
        navigator.clipboard.writeText(full).then(() => toast('Link copied'));
      });
    } catch (e) {
      $('#shMsg').className = 'msg err';
      $('#shMsg').textContent = e.message;
    }
  });
}

// Create a share link straight from the Share Links page — pick a song or playlist.
async function newShareModal() {
  const playlists = await api('/api/playlists');
  openModal(`
    <h3>Create a share link</h3>
    <label>What do you want to share?</label>
    <select id="shType">
      <option value="track">A song</option>
      <option value="playlist"${playlists.length ? '' : ' disabled'}>A playlist${playlists.length ? '' : ' (none yet)'}</option>
    </select>
    <div id="shPick"></div>
    <label>Link expires after</label>
    <select id="shExp">
      <option value="">Never</option>
      <option value="1">1 day</option>
      <option value="7" selected>7 days</option>
      <option value="30">30 days</option>
    </select>
    <label>Password (optional)</label>
    <input id="shPw2" placeholder="Leave blank for no password" />
    <div class="actions">
      <button class="ghost" onclick="closeModal()">Cancel</button>
      <button class="gold" id="shGo">Create link</button>
    </div>
    <div class="msg" id="shMsg2"></div>`);

  let picked = null;
  const renderPick = () => {
    if ($('#shType').value === 'playlist') {
      $('#shPick').innerHTML = `<label>Choose a playlist</label><select id="shPl">${playlists
        .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
        .join('')}</select>`;
    } else {
      $('#shPick').innerHTML = `
        <label>Find a song</label>
        <input id="shSongSearch" placeholder="Type a title, artist or album…" autocomplete="off" />
        <div class="pick-results" id="shSongResults"></div>
        <div class="pick-sel" id="shSongSel"></div>`;
      const run = debounce(async () => {
        const data = await api(`/api/tracks?q=${encodeURIComponent($('#shSongSearch').value.trim())}&limit=12`);
        const box = $('#shSongResults');
        box.innerHTML = data.items.length
          ? data.items
              .map(
                (t) =>
                  `<button type="button" class="pick-item" data-id="${t.id}" data-title="${esc(t.title)}">${esc(t.title)} <span class="muted">— ${esc(t.artist)}</span></button>`,
              )
              .join('')
          : '<span class="muted" style="padding:8px 10px">No matches</span>';
        box.querySelectorAll('.pick-item').forEach((b) =>
          b.addEventListener('click', () => {
            picked = { id: b.dataset.id, title: b.dataset.title };
            $('#shSongSel').textContent = `✓ Selected: ${b.dataset.title}`;
            box.innerHTML = '';
            $('#shSongSearch').value = b.dataset.title;
          }),
        );
      }, 200);
      $('#shSongSearch').addEventListener('input', run);
    }
  };
  renderPick();
  $('#shType').addEventListener('change', () => {
    picked = null;
    renderPick();
  });

  $('#shGo').addEventListener('click', async () => {
    const type = $('#shType').value;
    let refId;
    let title;
    if (type === 'playlist') {
      const sel = $('#shPl');
      if (!sel) return;
      refId = sel.value;
      title = sel.selectedOptions[0].textContent;
    } else if (!picked) {
      $('#shMsg2').className = 'msg err';
      $('#shMsg2').textContent = 'Search and pick a song first.';
      return;
    } else {
      refId = picked.id;
      title = picked.title;
    }
    try {
      await api('/api/shares', {
        method: 'POST',
        body: JSON.stringify({
          type,
          refId,
          title,
          expiresInDays: $('#shExp').value || null,
          password: $('#shPw2').value || null,
        }),
      });
      closeModal();
      toast('Share link created');
      loadShares();
    } catch (e) {
      $('#shMsg2').className = 'msg err';
      $('#shMsg2').textContent = e.message;
    }
  });
}

async function loadShares() {
  const list = await api('/api/shares');
  const el = $('#shareList');
  if (!list.length) {
    el.innerHTML =
      '<div class="empty">No share links yet. Click “＋ New share link” above, or use the ⋯ menu on any song and choose Share.</div>';
    return;
  }
  el.innerHTML = list
    .map((s) => {
      const full = location.origin + s.url;
      const exp = s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : 'Never';
      const wa = `https://wa.me/?text=${encodeURIComponent(`🎵 ${s.title} — listen here: ${full}`)}`;
      const mail = `mailto:?subject=${encodeURIComponent('Music: ' + s.title)}&body=${encodeURIComponent('Listen here: ' + full)}`;
      const qr = `/api/qr?data=${encodeURIComponent(full)}`;
      return `
      <div class="pcard">
        <h4>${esc(s.title)}</h4>
        <div class="meta">
          ${s.type === 'playlist' ? 'Playlist' : 'Single song'} ·
          ${s.hasPassword ? '🔒 Password' : 'Public'} · Expires: ${exp}
        </div>
        <div class="share-url" style="margin-bottom:6px">
          <input value="${esc(full)}" readonly />
          <button class="ghost tiny act-copy" data-url="${esc(full)}">Copy</button>
        </div>
        <div class="share-actions">
          <a class="linkbtn wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="linkbtn" href="${mail}">Email</a>
          <a class="linkbtn" href="${esc(full)}" target="_blank" rel="noopener">Open</a>
          <button class="act-qr" data-qr="${esc(qr)}">QR code</button>
          <button class="del act-del" data-token="${s.token}">Delete</button>
        </div>
        <div class="qr-box" style="display:none"></div>
      </div>`;
    })
    .join('');
  el.querySelectorAll('.act-copy').forEach((b) =>
    b.addEventListener('click', () =>
      navigator.clipboard.writeText(b.dataset.url).then(() => toast('Link copied')),
    ),
  );
  el.querySelectorAll('.act-qr').forEach((b) =>
    b.addEventListener('click', () => {
      const box = b.closest('.pcard').querySelector('.qr-box');
      if (box.style.display === 'none') {
        box.innerHTML = `<img src="${b.dataset.qr}" alt="QR code" /><div class="cap">Scan to open on a phone</div>`;
        box.style.display = '';
        b.textContent = 'Hide QR';
      } else {
        box.style.display = 'none';
        box.innerHTML = '';
        b.textContent = 'QR code';
      }
    }),
  );
  el.querySelectorAll('.act-del').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/shares/${b.dataset.token}`, { method: 'DELETE' });
      toast('Share link deleted');
      loadShares();
    }),
  );
}

// ===========================================================================
//  Account
// ===========================================================================
async function changePassword() {
  const msg = $('#pwMsg');
  msg.textContent = '';
  try {
    await api('/api/me/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('#curPw').value,
        newPassword: $('#newPw').value,
      }),
    });
    msg.className = 'msg ok';
    msg.textContent = 'Password updated.';
    $('#curPw').value = '';
    $('#newPw').value = '';
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = e.message;
  }
}

// ===========================================================================
//  Upload (admin)
// ===========================================================================
function bindUpload() {
  const drop = $('#dropZone');
  const input = $('#fileInput');
  if (!drop) return;
  input.addEventListener('change', () => uploadFiles(input.files));
  ['dragover', 'dragenter'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.style.borderColor = 'var(--gold)';
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.style.borderColor = '';
    }),
  );
  drop.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));
}

function uploadFiles(files) {
  if (!files || !files.length) return;
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f));
  const status = $('#uploadStatus');
  status.innerHTML = `<div class="progress"><span id="upBar"></span></div>
    <p class="muted" id="upText">Uploading ${files.length} file(s)…</p>`;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/admin/upload');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) $('#upBar').style.width = `${(e.loaded / e.total) * 100}%`;
  };
  xhr.onload = async () => {
    if (xhr.status === 200) {
      $('#upBar').style.width = '100%';
      $('#upText').textContent = 'Upload complete. Library updated.';
      toast('Upload complete');
      await loadStats();
      await loadTracks();
    } else {
      $('#upText').textContent = 'Upload failed.';
    }
  };
  xhr.onerror = () => ($('#upText').textContent = 'Upload failed.');
  xhr.send(fd);
}

// ===========================================================================
//  Users (admin)
// ===========================================================================
async function loadUsers() {
  const users = await api('/api/admin/users');
  const rows = users
    .map(
      (u) => `
      <tr>
        <td>${esc(u.displayName)}</td>
        <td class="muted">${esc(u.username)}</td>
        <td>${u.role === 'admin' ? '<span class="pill admin">Admin</span>' : '<span class="pill">User</span>'}</td>
        <td><div class="row-actions">${
          u.id === state.user.id
            ? '<span class="muted">You</span>'
            : `<button class="danger tiny act-del" data-id="${u.id}">Remove</button>`
        }</div></td>
      </tr>`,
    )
    .join('');
  $('#userTableWrap').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  $('#userTableWrap')
    .querySelectorAll('.act-del')
    .forEach((b) =>
      b.addEventListener('click', async () => {
        await api(`/api/admin/users/${b.dataset.id}`, { method: 'DELETE' });
        toast('User removed');
        loadUsers();
      }),
    );
}

function newUserModal() {
  openModal(`
    <h3>Add user</h3>
    <label>Display name</label>
    <input id="uName" placeholder="e.g. Priya Sharma" />
    <label>Username</label>
    <input id="uUser" placeholder="e.g. priya" />
    <label>Password (6+ characters)</label>
    <input id="uPw" type="password" />
    <label>Role</label>
    <select id="uRole"><option value="user">User</option><option value="admin">Admin</option></select>
    <div class="actions">
      <button class="ghost" onclick="closeModal()">Cancel</button>
      <button class="gold" id="uCreate">Create</button>
    </div>
    <div class="msg" id="uMsg"></div>`);
  $('#uCreate').addEventListener('click', async () => {
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          displayName: $('#uName').value.trim(),
          username: $('#uUser').value.trim(),
          password: $('#uPw').value,
          role: $('#uRole').value,
        }),
      });
      closeModal();
      toast('User created');
      loadUsers();
    } catch (e) {
      $('#uMsg').className = 'msg err';
      $('#uMsg').textContent = e.message;
    }
  });
}

// ===========================================================================
//  Home / Discover
// ===========================================================================
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

async function loadHome() {
  const first = state.user ? state.user.displayName.split(' ')[0] : '';
  $('#homeGreeting').textContent = `${greeting()}${first ? ', ' + first : ''}`;
  const h = await api('/api/home');
  const shelves = [
    ['Jump back in', h.recentlyPlayed],
    ['Recently added', h.recentlyAdded],
    ['Your favorites', h.favorites],
    ['Most played', h.mostPlayed],
    ['Discover mix', h.discover],
  ].filter(([, items]) => items && items.length);

  const el = $('#homeShelves');
  if (!shelves.length) {
    el.innerHTML = '<div class="empty">Your library is empty. Add music to get started.</div>';
    return;
  }
  const lists = shelves.map(([, items]) => items);
  el.innerHTML = shelves
    .map(
      ([title, items], si) => `
      <div class="shelf">
        <h3>${title}</h3>
        <div class="shelf-row">
          ${items
            .map(
              (t, i) => `
            <div class="shelf-card" data-si="${si}" data-i="${i}">
              <img src="/api/art/${t.id}" onerror="coverError(this)" alt="" />
              <div class="st">${esc(t.title)}</div>
              <div class="ss">${esc(t.artist)}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>`,
    )
    .join('');
  el.querySelectorAll('.shelf-card').forEach((card) =>
    card.addEventListener('click', () =>
      playFromList(lists[Number(card.dataset.si)], Number(card.dataset.i)),
    ),
  );
}

// ===========================================================================
//  Genres
// ===========================================================================
async function loadGenres() {
  const genres = await api('/api/genres');
  const el = $('#genreGrid');
  if (!genres.length) {
    el.innerHTML = '<div class="empty">No genre tags found in your library.</div>';
    return;
  }
  el.innerHTML = genres
    .map(
      (g) => `
      <div class="pcard album-card" data-genre="${esc(g.genre)}">
        <img class="album-cover" src="${g.art ? `/api/art/${g.art}` : FALLBACK_COVER}" onerror="coverError(this)" alt="" />
        <h4>${esc(g.genre)}</h4>
        <div class="meta">${g.tracks} song(s)</div>
      </div>`,
    )
    .join('');
  el.querySelectorAll('.album-card').forEach((c) =>
    c.addEventListener('click', () => openGenre(c.dataset.genre)),
  );
}

async function openGenre(genre) {
  const items = await api(`/api/genres/${encodeURIComponent(genre)}/tracks`);
  state.genreTracks = items;
  switchView('genre');
  $('#genreDetail').innerHTML = `
    <h2>${esc(genre)}</h2>
    <p class="sub">${items.length} song(s)</p>
    <div class="toolbar">
      <button class="gold" id="genrePlay">▶ Play all</button>
      <button class="ghost" id="genreShuffle">🔀 Shuffle</button>
    </div>
    <div id="genreTracks"></div>`;
  renderTrackTable($('#genreTracks'), items);
  $('#genrePlay').onclick = () => { setShuffle(false); playFromList(state.genreTracks, 0); };
  $('#genreShuffle').onclick = () => { setShuffle(true); playFromList(state.genreTracks, rand(state.genreTracks.length)); };
}

// ===========================================================================
//  Play queue
// ===========================================================================
function playNext(track) {
  if (!state.queue.length) return playFromList([track], 0);
  state.queue.splice(state.index + 1, 0, track);
  toast('Playing next');
  if (isQueueView()) loadQueue();
}

function addToQueue(track) {
  if (!state.queue.length) return playFromList([track], 0);
  state.queue.push(track);
  toast('Added to queue');
  if (isQueueView()) loadQueue();
}

function isQueueView() {
  return $('#view-queue').classList.contains('active');
}

function loadQueue() {
  const wrap = $('#queueWrap');
  if (!state.queue.length) {
    wrap.innerHTML = '<div class="empty">Queue is empty. Play a song to get started.</div>';
    return;
  }
  wrap.innerHTML = `<table><tbody>${state.queue
    .map(
      (t, qi) => `
      <tr data-qindex="${qi}" data-id="${t.id}" class="${qi === state.index ? 'playing' : ''}">
        <td style="width:52px">${coverImg(`/api/art/${t.id}`)}</td>
        <td class="cell-title">${qi === state.index ? '▶ ' : ''}${esc(t.title)}<div class="cell-sub">${esc(t.artist)}</div></td>
        <td class="muted">${fmtTime(t.duration)}</td>
        <td><div class="row-actions"><button class="danger tiny act-qrm" title="Remove">✕</button></div></td>
      </tr>`,
    )
    .join('')}</tbody></table>`;
  wrap.querySelectorAll('tbody tr').forEach((tr) => {
    const qi = Number(tr.dataset.qindex);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      state.index = qi;
      playCurrent();
      loadQueue();
    });
    tr.querySelector('.act-qrm').addEventListener('click', () => removeFromQueue(qi));
  });
}

function removeFromQueue(qi) {
  if (qi === state.index) return toast("Can't remove the song that's playing");
  state.queue.splice(qi, 1);
  if (qi < state.index) state.index--;
  loadQueue();
}

function clearQueue() {
  if (state.queue.length) {
    state.queue = [state.queue[state.index]].filter(Boolean);
    state.index = 0;
  }
  loadQueue();
}

// ===========================================================================
//  Row "⋯" context menu
// ===========================================================================
const ctxMenu = $('#ctxMenu');

function openTrackMenu(e, track) {
  e.stopPropagation();
  ctxMenu.innerHTML = `
    <button data-a="playnext">▶  Play next</button>
    <button data-a="queue">☰  Add to queue</button>
    <button data-a="radio">📻  Start song radio</button>
    <div class="sep"></div>
    <button data-a="playlist">＋  Add to playlist</button>
    <button data-a="fav">${state.favorites.has(track.id) ? '💔  Remove favorite' : '❤  Add to favorites'}</button>
    <div class="sep"></div>
    <button data-a="album">💿  Go to album</button>
    <button data-a="artist">🎤  Go to artist</button>
    <div class="sep"></div>
    <button data-a="share">🔗  Share</button>
    <button data-a="download">⬇  Download</button>`;
  ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 340)}px`;
  ctxMenu.classList.add('open');
  ctxMenu.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      closeCtx();
      menuAction(b.dataset.a, track);
    }),
  );
}

function closeCtx() {
  ctxMenu.classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target) && !e.target.closest('.act-menu')) closeCtx();
});
window.addEventListener('resize', closeCtx);

async function menuAction(a, track) {
  if (a === 'playnext') playNext(track);
  else if (a === 'queue') addToQueue(track);
  else if (a === 'radio') startSongRadio(track);
  else if (a === 'playlist') addToPlaylistModal(track.id);
  else if (a === 'fav') toggleFav(track.id);
  else if (a === 'share') shareModal('track', track.id, track.title);
  else if (a === 'download') window.location = `/api/download/${track.id}`;
  else if (a === 'artist') openArtist(track.artist);
  else if (a === 'album') {
    const albums = await api('/api/albums');
    const m = albums.find((al) => al.album === track.album && al.artist === track.artist);
    if (m) openAlbum(m.key);
    else toast('Album not found');
  }
}

// ===========================================================================
//  Full-screen Now Playing + lyrics + practice tools
// ===========================================================================
const npScreen = $('#npScreen');
let loopA = null;
let loopB = null;
let sleepHandle = null;

function openNpScreen() {
  const t = state.queue[state.index];
  if (!t) return toast('Play a song first');
  npScreen.classList.add('open');
  updateNpScreen(t);
}

function closeNpScreen() {
  npScreen.classList.remove('open');
}

function updateNpScreen(t) {
  if (!t) return;
  $('#npBigTitle').textContent = t.title;
  $('#npBigArtist').textContent = `${t.artist} · ${t.album}`;
  const art = $('#npBigArt');
  art.onerror = () => window.coverError(art);
  art.src = `/api/art/${t.id}`;
  loadLyrics(t.id);
}

async function loadLyrics(id) {
  const el = $('#npLyrics');
  el.innerHTML = '<span class="muted">Loading lyrics…</span>';
  try {
    const l = await api(`/api/lyrics/${id}`);
    if (l && l.text) {
      el.textContent = l.text;
    } else {
      el.innerHTML =
        '<span class="muted">No lyrics found. Add a .lrc or .txt file next to the song, or embed lyrics in its tags.</span>';
    }
  } catch {
    el.innerHTML = '<span class="muted">Could not load lyrics.</span>';
  }
}

function updateAbStatus() {
  const el = $('#abStatus');
  if (!el) return;
  el.textContent =
    loopA != null && loopB != null
      ? `${fmtTime(loopA)}–${fmtTime(loopB)}`
      : loopA != null
        ? `A=${fmtTime(loopA)}…`
        : 'off';
}

function setSleep(min) {
  if (sleepHandle) {
    clearTimeout(sleepHandle);
    sleepHandle = null;
  }
  if (min > 0) {
    sleepHandle = setTimeout(() => {
      audio.pause();
      toast('Sleep timer — paused');
      $('#sleepSel').value = '0';
    }, min * 60000);
    toast(`Sleep timer set: ${min} min`);
  }
}

function bindExtras() {
  $('#npInfo').addEventListener('click', openNpScreen);
  $('#expandBtn').addEventListener('click', openNpScreen);
  $('#npClose').addEventListener('click', closeNpScreen);
  $('#queueBtn').addEventListener('click', () => switchView('queue'));
  $('#clearQueueBtn').addEventListener('click', clearQueue);
  $('#genreBack').addEventListener('click', () => switchView('genres'));
  $('#autoplayBtn').addEventListener('click', () => {
    state.autoplay = !state.autoplay;
    $('#autoplayBtn').classList.toggle('on', state.autoplay);
    toast(state.autoplay ? 'Autoplay on' : 'Autoplay off');
  });

  applyPreservePitch();
  $('#speedSel').addEventListener('change', (e) => {
    applyPreservePitch();
    audio.playbackRate = parseFloat(e.target.value) || 1;
  });

  $('#trDown').addEventListener('click', () => setTranspose(state.transpose - 1));
  $('#trUp').addEventListener('click', () => setTranspose(state.transpose + 1));
  $('#trReset').addEventListener('click', () => setTranspose(0));

  $('#eqPreset').addEventListener('change', (e) => setEqPreset(e.target.value));
  for (let i = 0; i < 6; i++) {
    $(`#eqBand${i}`).addEventListener('input', (e) => setEqBand(i, Number(e.target.value)));
  }

  $('#sleepSel').addEventListener('change', (e) => setSleep(parseInt(e.target.value, 10) || 0));

  $('#abA').addEventListener('click', () => {
    loopA = audio.currentTime;
    if (loopB != null && loopB <= loopA) loopB = null;
    updateAbStatus();
    toast('Loop start (A) set');
  });
  $('#abB').addEventListener('click', () => {
    if (loopA == null) return toast('Set point A first');
    if (audio.currentTime <= loopA) return toast('B must be after A');
    loopB = audio.currentTime;
    updateAbStatus();
    toast('Loop end (B) set — looping');
  });
  $('#abClear').addEventListener('click', () => {
    loopA = loopB = null;
    updateAbStatus();
    toast('Loop cleared');
  });

  // Enforce the A–B loop and keep the chosen playback speed across tracks.
  audio.addEventListener('timeupdate', () => {
    if (loopA != null && loopB != null && audio.currentTime >= loopB) audio.currentTime = loopA;
  });
  audio.addEventListener('play', () => {
    applyPreservePitch();
    audio.playbackRate = parseFloat($('#speedSel').value) || 1;
  });
}
