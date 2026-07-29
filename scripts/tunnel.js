// Keeps a Cloudflare "quick tunnel" alive and records its current public URL.
//
// Run under PM2 (see `pm2 start scripts/tunnel.js --name gaana-tunnel`) so it
// auto-restarts on crash. Because quick tunnels get a NEW random
// *.trycloudflare.com address every time they (re)start, this wrapper writes
// the live URL to data/tunnel-url.txt whenever it changes — that file is the
// one place to always find the current public link.
//
// Env overrides:
//   CLOUDFLARED   full path to cloudflared.exe
//   TUNNEL_PORT   local port to expose (default 3080, the music app)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CF = process.env.CLOUDFLARED || 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const PORT = process.env.TUNNEL_PORT || '3080';
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'tunnel-url.txt');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let lastUrl = null;

function handle(buf) {
  const s = buf.toString();
  process.stdout.write(s); // forward to PM2 logs
  const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && m[0] !== lastUrl) {
    lastUrl = m[0];
    try {
      fs.writeFileSync(OUT, m[0] + '\n');
      console.log(`[tunnel] public URL saved to ${OUT}: ${m[0]}`);
    } catch (e) {
      console.error('[tunnel] failed to write url file:', e.message);
    }
  }
}

console.log(`[tunnel] starting cloudflared -> http://localhost:${PORT}`);
const child = spawn(CF, ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', handle);
child.stderr.on('data', handle);

child.on('exit', (code, signal) => {
  console.error(`[tunnel] cloudflared exited (code=${code} signal=${signal}); exiting so PM2 restarts us`);
  process.exit(code == null ? 1 : code);
});

// Clean shutdown so PM2 stop/restart doesn't leave orphaned cloudflared procs.
function shutdown() {
  try { child.kill(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', (m) => { if (m === 'shutdown') shutdown(); });
