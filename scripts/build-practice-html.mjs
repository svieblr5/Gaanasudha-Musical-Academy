// Builds a single self-contained, shareable practice-tools HTML file
// (Shruti Box + Tanpura + Tala metronome) from the live practice-tools.js.
// Pure Web Audio, no server/login needed — works offline or via a link.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(ROOT, 'public/js/practice-tools.js'), 'utf8');

const css = `
  :root {
    --bg:#0f1020; --bg-2:#17182e; --panel:#1e1f3a; --panel-2:#26274a;
    --text:#ececff; --muted:#9a9ac2; --gold:#e5b567; --gold-2:#f2c987;
    --accent:#6c5ce7; --accent-2:#8b7bf0; --ok:#4ec98a; --border:#2c2d52;
    --radius:12px;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:radial-gradient(1200px 600px at 20% -10%, #1a1b34, var(--bg));
    color:var(--text); font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
    min-height:100vh; padding:28px 20px 60px;
  }
  .head { max-width:860px; margin:0 auto 22px; }
  .head .brand { display:flex; align-items:center; gap:12px; }
  .head .logo { font-size:34px; }
  .head h1 { margin:0; font-size:26px; }
  .head .sub { color:var(--muted); margin:6px 0 0; }
  h2,h4 { margin:0; }
  select, input[type=text] {
    background:var(--panel-2); color:var(--text); border:1px solid var(--border);
    border-radius:8px; padding:8px 10px; font-size:14px; font-family:inherit;
  }
  input[type=range] { accent-color:var(--gold); width:100%; }
  button {
    font-family:inherit; font-size:14px; border-radius:8px; padding:9px 14px;
    cursor:pointer; border:1px solid var(--border); color:var(--text); background:var(--panel-2);
  }
  button.ghost { background:transparent; }
  button.ghost:hover { background:var(--panel-2); }
  button.gold { background:var(--gold); color:#22160a; font-weight:600; border-color:var(--gold); }
  button.gold:hover { background:var(--gold-2); }
  button.tiny { padding:5px 10px; font-size:13px; }
  .muted { color:var(--muted); }
  .row { display:flex; gap:8px; }
  .practice-grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); max-width:860px; margin:0 auto; }
  .pcard { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius); padding:20px; }
  .practice-card .pc-head h4 { font-size:18px; display:flex; align-items:center; gap:8px; }
  .pc-head .meta, .pcard .meta { color:var(--muted); font-size:13px; margin:6px 0 0; }
  .pfield { margin-top:14px; }
  .pfield>label { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; color:var(--muted); margin-bottom:6px; }
  .pfield select, .pfield input[type=range] { width:100%; }
  .practice-card .row button { flex:1; }
  .live-dot { width:9px; height:9px; border-radius:50%; background:var(--border); display:inline-block; transition:background .2s; }
  .live-dot.live { background:var(--ok); animation:pulse 1.4s infinite; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(78,201,138,.5);} 70%{box-shadow:0 0 0 7px rgba(78,201,138,0);} 100%{box-shadow:0 0 0 0 rgba(78,201,138,0);} }
  .reed-toggles { display:flex; flex-wrap:wrap; gap:8px; }
  .reed { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:52px; padding:8px 6px; gap:2px; background:var(--panel-2); border:1px solid var(--border); border-radius:10px; color:var(--muted); transition:all .12s; }
  .reed:hover { border-color:var(--gold); }
  .reed .reed-l { font-size:16px; font-weight:700; line-height:1; }
  .reed .reed-s { font-size:10px; }
  .reed.on { background:linear-gradient(180deg,var(--gold-2),var(--gold)); color:#22160a; border-color:var(--gold-2); box-shadow:0 2px 10px rgba(229,181,103,.35); }
  .sb-card { border-color:var(--gold); }
  .preset-row { display:flex; gap:8px; align-items:center; }
  .preset-row select, .preset-row input[type=text] { flex:1; min-width:0; }
  .preset-row button { flex-shrink:0; }
  .anchor-rows { display:flex; flex-direction:column; gap:6px; }
  .anchor-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .anchor-grp { font-size:11px; color:var(--muted); min-width:62px; }
  .anchor.tiny { padding:3px 9px; }
  .beat-dots { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
  .beat-dot { width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; color:var(--muted); background:var(--panel-2); border:1px solid var(--border); transition:all .05s; }
  .beat-dot.sam { border-color:var(--gold); color:var(--gold-2); font-weight:700; }
  .beat-dot.anga { border-color:var(--accent-2); color:var(--accent-2); }
  .beat-dot.on { background:var(--gold); color:#22160a; transform:scale(1.12); }
  .beat-dot.anga.on { background:var(--accent); color:#fff; border-color:var(--accent); }
  .foot { max-width:860px; margin:26px auto 0; color:var(--muted); font-size:12px; text-align:center; }
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gaanasudha · Practice Tools (Tanpura, Shruti Box, Tala)</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎼</text></svg>" />
  <style>${css}</style>
</head>
<body>
  <div class="head">
    <div class="brand"><span class="logo">🎼</span><h1>Gaanasudha — Practice Tools</h1></div>
    <p class="sub">Tanpura · Shruti Box · Tala metronome. Works offline — tap a Start / Power button (browsers need one tap before sound).</p>
  </div>
  <div id="practicePanel"></div>
  <p class="foot">Gaanasudha Musical Academy · Pure Web Audio — no internet required after loading. Presets are saved in this browser.</p>
  <script>${js}</script>
</body>
</html>
`;

const out = path.join(ROOT, 'public', 'practice.html');
fs.writeFileSync(out, html);
console.log('Wrote', out, `(${(html.length / 1024).toFixed(1)} KB)`);
