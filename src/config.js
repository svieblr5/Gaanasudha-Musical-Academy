import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const MUSIC_DIR = process.env.MUSIC_DIR || path.join(ROOT, 'music');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const ART_DIR = path.join(DATA_DIR, 'art');

export const PORT = Number(process.env.PORT) || 3000;

// Use SESSION_SECRET from the environment if set (the Windows service supplies
// it); otherwise generate a strong secret once and persist it so sessions stay
// valid across restarts instead of falling back to a weak shared default.
function resolveSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const file = path.join(DATA_DIR, 'session.secret');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret);
    return secret;
  } catch {
    return 'gaanasudha-insecure-fallback-secret';
  }
}

export const SESSION_SECRET = resolveSessionSecret();

// Audio file types the library scanner will index.
export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma', '.aiff', '.alac',
]);

export const MIME = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  alac: 'audio/mp4',
};
