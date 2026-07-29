// Install the portal as a Windows service so it starts automatically at boot,
// runs hidden (no console window), and restarts if it crashes.
//   Run from an *elevated* (Administrator) terminal:  npm run service:install
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pkg from 'node-windows';

const { Service } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || '3000';

// Persist a stable session secret across restarts/reinstalls so that users are
// not logged out every time the service restarts.
const secretFile = path.join(ROOT, 'data', 'session.secret');
fs.mkdirSync(path.dirname(secretFile), { recursive: true });
let secret;
if (fs.existsSync(secretFile)) {
  secret = fs.readFileSync(secretFile, 'utf8').trim();
} else {
  secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret);
}

const svc = new Service({
  name: 'Gaanasudha Music Portal',
  description: 'Self-hosted music library web portal for Gaanasudha Musical Academy.',
  script: path.join(ROOT, 'server.js'),
  env: [
    { name: 'PORT', value: String(PORT) },
    { name: 'SESSION_SECRET', value: secret },
    { name: 'NODE_ENV', value: 'production' },
  ],
  wait: 2,        // seconds to wait between restart attempts
  grow: 0.5,      // back-off growth factor
  maxRestarts: 20,
});

svc.on('install', () => {
  console.log('Service installed. Starting…');
  svc.start();
});
svc.on('start', () => {
  console.log('');
  console.log('  Gaanasudha Music Portal is now running as a Windows service.');
  console.log(`  URL:   http://localhost:${PORT}`);
  console.log('  It will start automatically every time this PC boots.');
  console.log('  Manage it in services.msc  ("Gaanasudha Music Portal").');
});
svc.on('alreadyinstalled', () => {
  console.log('The service is already installed. Run service:uninstall first to reinstall.');
});
svc.on('error', (e) => console.error('Service error:', e));

svc.install();
