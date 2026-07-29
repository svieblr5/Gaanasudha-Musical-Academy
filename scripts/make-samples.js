// Generate original demo content: synthesized practice melodies (WAV) organized
// into Artist/Album folders, each with an SVG cover. No copyrighted material.
//   Usage:  node scripts/make-samples.js
import fs from 'node:fs';
import path from 'node:path';
import { MUSIC_DIR } from '../src/config.js';

const SR = 44100;

// A simple sargam scale (Hz) so the melodies sound musical.
const N = {
  Sa: 261.63, Re: 293.66, Ga: 329.63, Ma: 349.23,
  Pa: 392.0, Dha: 440.0, Ni: 493.88, Sa2: 523.25, Re2: 587.33, Ga2: 659.25,
};

// Render a list of [note, seconds] into 16-bit PCM samples with a soft envelope.
function synth(notes) {
  const out = [];
  for (const [note, dur] of notes) {
    const freq = typeof note === 'number' ? note : N[note];
    const len = Math.floor(SR * dur);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const attack = Math.min(1, i / (0.012 * SR));
      const release = Math.min(1, (len - i) / (0.05 * SR));
      const env = attack * release;
      const wave =
        Math.sin(2 * Math.PI * freq * t) * 0.6 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.18 +
        Math.sin(2 * Math.PI * freq * 3 * t) * 0.08;
      out.push(wave * env * 0.28);
    }
  }
  return out;
}

// Build a RIFF "LIST/INFO" metadata chunk (title/artist/album/genre/year),
// which music-metadata reads as the track's tags.
function infoChunk(info) {
  const fields = [
    ['INAM', info.title],
    ['IART', info.artist],
    ['IPRD', info.album],
    ['IGNR', info.genre],
    ['ICRD', info.year ? String(info.year) : ''],
  ].filter(([, v]) => v);
  const parts = [];
  for (const [id, val] of fields) {
    let data = Buffer.from(`${val}\0`, 'latin1');
    if (data.length % 2) data = Buffer.concat([data, Buffer.from([0])]); // pad to even
    const head = Buffer.alloc(8);
    head.write(id, 0);
    head.writeUInt32LE(data.length, 4);
    parts.push(head, data);
  }
  const body = Buffer.concat([Buffer.from('INFO'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('LIST', 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function writeWav(file, samples, info = {}) {
  const n = samples.length;
  const dataSize = n * 2;

  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // mono
  fmt.writeUInt32LE(SR, 12);
  fmt.writeUInt32LE(SR * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);

  const list = infoChunk(info);

  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0);
  dataHead.writeUInt32LE(dataSize, 4);
  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i])) * 32767;
    pcm.writeInt16LE(s | 0, i * 2);
  }

  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, dataHead, pcm]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(body.length, 4);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([riff, body]));
}

function writeCover(dir, title, subtitle, c1, c2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="500" height="500" fill="url(#g)"/>
  <text x="250" y="215" font-family="Segoe UI, sans-serif" font-size="140" text-anchor="middle" fill="rgba(255,255,255,0.92)">&#9834;</text>
  <text x="250" y="320" font-family="Segoe UI, sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#ffffff">${title}</text>
  <text x="250" y="360" font-family="Segoe UI, sans-serif" font-size="20" text-anchor="middle" fill="rgba(255,255,255,0.85)">${subtitle}</text>
</svg>`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cover.svg'), svg);
}

const albums = [
  {
    artist: 'Gaanasudha Faculty',
    album: 'Carnatic Practice Vol. 1',
    genre: 'Carnatic',
    colors: ['#6c5ce7', '#e5b567'],
    tracks: [
      { title: 'Sarali Varisai', notes: [['Sa', .45], ['Re', .45], ['Ga', .45], ['Ma', .45], ['Pa', .45], ['Dha', .45], ['Ni', .45], ['Sa2', .7]] },
      { title: 'Janta Varisai', notes: [['Sa', .3], ['Sa', .3], ['Re', .3], ['Re', .3], ['Ga', .3], ['Ga', .3], ['Ma', .3], ['Ma', .3], ['Pa', .6]] },
      { title: 'Alankaram in Mayamalavagowla', notes: [['Sa', .3], ['Re', .3], ['Ga', .3], ['Re', .3], ['Ga', .3], ['Ma', .3], ['Ga', .3], ['Ma', .3], ['Pa', .5]] },
    ],
  },
  {
    artist: 'Gaanasudha Faculty',
    album: 'Vocal Warmups',
    genre: 'Vocal Exercises',
    colors: ['#0984e3', '#00cec9'],
    tracks: [
      { title: 'Sa Pa Sa Glide', notes: [['Sa', .5], ['Pa', .5], ['Sa2', .7], ['Pa', .5], ['Sa', .7]] },
      { title: 'Octave Climb', notes: [['Sa', .3], ['Re', .3], ['Ga', .3], ['Ma', .3], ['Pa', .3], ['Dha', .3], ['Ni', .3], ['Sa2', .3], ['Re2', .3], ['Ga2', .6]] },
      { title: 'Breath Control Drone', notes: [['Sa', 1.4], ['Pa', 1.4], ['Sa', 1.6]] },
    ],
  },
  {
    artist: 'Studio Ensemble',
    album: 'Instrumental Demos',
    genre: 'Instrumental',
    colors: ['#d63031', '#e17055'],
    tracks: [
      { title: 'Veena Prelude', notes: [['Sa2', .35], ['Ni', .35], ['Dha', .35], ['Pa', .5], ['Ma', .35], ['Ga', .35], ['Re', .35], ['Sa', .7]] },
      { title: 'Flute Interlude', notes: [['Pa', .4], ['Dha', .4], ['Ni', .4], ['Sa2', .4], ['Ni', .4], ['Dha', .5], ['Pa', .6]] },
      { title: 'Tabla Cycle', notes: [[N.Sa / 2, .25], [N.Pa / 2, .25], [N.Sa / 2, .25], [N.Sa / 2, .25], [N.Pa / 2, .25], [N.Ma / 2, .25], [N.Sa / 2, .5]] },
    ],
  },
];

let count = 0;
for (const a of albums) {
  const dir = path.join(MUSIC_DIR, a.artist, a.album);
  writeCover(dir, a.album, a.artist, a.colors[0], a.colors[1]);
  a.tracks.forEach((t, i) => {
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')} ${t.title}.wav`);
    writeWav(file, synth(t.notes), {
      title: t.title,
      artist: a.artist,
      album: a.album,
      genre: a.genre,
      year: 2026,
    });
    count++;
    console.log('  +', path.relative(MUSIC_DIR, file));
  });
}
console.log(`\nGenerated ${count} demo tracks across ${albums.length} albums in ${MUSIC_DIR}`);
