// Remove the Windows service.
//   Run from an *elevated* (Administrator) terminal:  npm run service:uninstall
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'node-windows';

const { Service } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const svc = new Service({
  name: 'Gaanasudha Music Portal',
  script: path.join(ROOT, 'server.js'),
});

svc.on('uninstall', () => {
  console.log('Gaanasudha Music Portal service uninstalled.');
  console.log('Auto-start at boot is now disabled. Your music and data are untouched.');
});
svc.on('doesnotexist', () => console.log('The service is not installed — nothing to remove.'));
svc.on('error', (e) => console.error('Service error:', e));

svc.uninstall();
