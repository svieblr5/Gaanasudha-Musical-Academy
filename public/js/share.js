// Public share page — no authentication. Reads the token from /share/<token>.

const token = location.pathname.split('/').pop();
let password = '';
let tracks = [];
let index = -1;

const $ = (s) => document.querySelector(s);
const audio = $('#audio');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}
function fmtTime(sec) {
  if (!sec && sec !== 0) return '0:00';
  sec = Math.floor(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
window.coverError = (img) => {
  img.onerror = null;
  img.src =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="6" fill="%2326274a"/><text x="40" y="52" font-size="34" text-anchor="middle" fill="%239a9ac2">♫</text></svg>',
    );
};

async function load() {
  const url = `/api/public/shares/${token}${password ? `?pw=${encodeURIComponent(password)}` : ''}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && data.needsPassword) {
    $('#pwGate').style.display = '';
    $('#content').style.display = 'none';
    if (password) $('#pwErr').textContent = 'Incorrect password';
    return;
  }
  if (!res.ok) {
    showError(data.error || 'This link is unavailable.');
    return;
  }

  $('#pwGate').style.display = 'none';
  $('#errorBox').style.display = 'none';
  $('#content').style.display = '';
  $('#shareTitle').textContent = data.title || 'Shared music';
  tracks = data.tracks || [];
  renderList();
}

function showError(msg) {
  $('#pwGate').style.display = 'none';
  $('#content').style.display = 'none';
  const box = $('#errorBox');
  box.style.display = '';
  box.textContent = msg;
}

function artUrl(id) {
  return `/api/public/shares/${token}/art/${id}${password ? `?pw=${encodeURIComponent(password)}` : ''}`;
}
function streamUrl(id) {
  return `/api/public/shares/${token}/stream/${id}${password ? `?pw=${encodeURIComponent(password)}` : ''}`;
}

function renderList() {
  if (!tracks.length) {
    $('#trackList').innerHTML = '<div class="empty">This share has no songs.</div>';
    return;
  }
  $('#trackList').innerHTML = `
    <table><tbody>${tracks
      .map(
        (t, i) => `
      <tr data-index="${i}" style="cursor:pointer">
        <td style="width:52px"><img class="cover" src="${artUrl(t.id)}" onerror="coverError(this)" alt=""/></td>
        <td class="cell-title">${esc(t.title)}<div class="cell-sub">${esc(t.artist)} · ${esc(t.album)}</div></td>
        <td class="muted">${fmtTime(t.duration)}</td>
      </tr>`,
      )
      .join('')}</tbody></table>`;
  document.querySelectorAll('#trackList tbody tr').forEach((tr) =>
    tr.addEventListener('click', () => play(Number(tr.dataset.index))),
  );
}

function play(i) {
  index = i;
  const t = tracks[i];
  if (!t) return;
  audio.src = streamUrl(t.id);
  audio.play().catch(() => {});
  $('#npTitle').textContent = t.title;
  $('#npArtist').textContent = t.artist;
  const cover = $('#npCover');
  cover.onerror = () => window.coverError(cover);
  cover.src = artUrl(t.id);
  document.querySelectorAll('#trackList tbody tr').forEach((tr) =>
    tr.classList.toggle('playing', Number(tr.dataset.index) === i),
  );
}

// Player controls
$('#playBtn').addEventListener('click', () => {
  if (!audio.src) return play(0);
  audio.paused ? audio.play() : audio.pause();
});
audio.addEventListener('play', () => ($('#playBtn').textContent = '⏸'));
audio.addEventListener('pause', () => ($('#playBtn').textContent = '▶'));
audio.addEventListener('ended', () => {
  if (index + 1 < tracks.length) play(index + 1);
});
audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    $('#seek').value = String((audio.currentTime / audio.duration) * 1000);
    $('#curTime').textContent = fmtTime(audio.currentTime);
    $('#durTime').textContent = fmtTime(audio.duration);
  }
});
$('#seek').addEventListener('input', (e) => {
  if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
});
$('#pwBtn').addEventListener('click', () => {
  password = $('#pw').value;
  load();
});
$('#pw')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    password = $('#pw').value;
    load();
  }
});

load();
