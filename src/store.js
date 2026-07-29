import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Read a JSON file from the data directory, returning `fallback` if missing/corrupt.
export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Write JSON atomically (write to temp, then rename) so a crash mid-write
// cannot leave a half-written file.
export function writeJson(name, data) {
  ensureDataDir();
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
