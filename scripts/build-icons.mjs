// Rasterizes public/icon.svg into PNG app icons (192 & 512) for the PWA manifest.
// Uses system Chrome via puppeteer-core because the icon uses the 🎼 emoji glyph,
// which only a real browser renderer draws correctly.
// Run: npm i puppeteer-core --no-save && node scripts/build-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'public/icon.svg'), 'utf8');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

for (const size of [192, 512]) {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>
    ${svg}`;
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const out = path.join(ROOT, 'public', `icon-${size}.png`);
  await page.screenshot({ path: out, omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('Wrote', out);
  await page.close();
}

await browser.close();
