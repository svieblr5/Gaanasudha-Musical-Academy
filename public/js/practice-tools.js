/* ==========================================================================
 *  Practice Tools — Tanpura (shruti drone) + Tala Metronome
 *  Self-contained: pure Web Audio API, no audio files, works offline.
 *  Renders into #practicePanel (present in index.html). Independent of app.js
 *  so the drone/metronome keep playing while you browse the library.
 * ========================================================================== */
(() => {
  const panel = document.getElementById('practicePanel');
  if (!panel) return;

  // A single shared AudioContext, created lazily on the first user gesture
  // (browsers block audio until then).
  let ctx = null;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // --- Note table: semitones from A4=440, C2..C5, labelled Note+octave ---
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Carnatic shruti-box "kattai" numbers, indexed by pitch class. Half-numbers
  // only fall on the black keys (C#=1½ … A#=6½); E-F and B-C have no half step.
  const KATTAI = ['1', '1½', '2', '2½', '3', '4', '4½', '5', '5½', '6', '6½', '7'];
  function buildNotes() {
    const out = [];
    for (let midi = 36; midi <= 72; midi++) {
      const freq = 440 * 2 ** ((midi - 69) / 12);
      const pc = midi % 12;
      const name = NAMES[pc] + (Math.floor(midi / 12) - 1);
      out.push({ name, freq, kattai: KATTAI[pc], midi });
    }
    return out;
  }
  const NOTES = buildNotes();

  // =========================================================================
  //  TANPURA — Karplus-Strong plucked strings, pre-rendered per note.
  // =========================================================================
  // The four tanpura strings, relative to the chosen madhya (middle) Sa `f`:
  //   1) jod string  — Pa/Ma/Ni in the mandra octave (below Sa), or Sa
  //   2) & 3) madhya Sa (the main reference pitch)
  //   4) mandra Sa    — Sa one octave down (the deep thump)
  // Ratios are computed from the mandra Sa (f/2) so the jod note sits between
  // the low Sa and the middle Sa, as on a real tanpura.
  const JOD = {
    Pa: 1.5, // perfect fifth above mandra Sa  → 0.75 f
    Ma: 4 / 3, // perfect fourth                → 0.667 f
    Ni: 15 / 8, // major seventh                → 0.9375 f
    Sa: 2, // unison with madhya Sa            → f (no separate jod tone)
  };

  // Tanpura "naad" (tone colours). Each shapes the Karplus-Strong string:
  //   ex    — excitation brightness (0 dull … 1 bright)
  //   loop  — feedback-filter brightness / sustain of highs
  //   ring  — sustain-length multiplier
  //   jariGain — extra shimmer on the jod (jivari buzz feel)
  // "Saarang" emulates the warm, full, long-sustaining tone of the RADEL
  // Saarang electronic tanpura (an homage — not RADEL's own samples).
  const TAN_TONES = {
    Classic: { ex: 0.5, loop: 0.5, ring: 1.0, jariGain: 1.0 },
    'Saarang (warm)': { ex: 0.36, loop: 0.44, ring: 1.18, jariGain: 1.08 },
    Bright: { ex: 0.7, loop: 0.6, ring: 0.95, jariGain: 1.0 },
    Mellow: { ex: 0.26, loop: 0.4, ring: 1.25, jariGain: 1.0 },
  };

  const tanpura = {
    playing: false,
    buffers: [], // pre-rendered AudioBuffer per string
    master: null,
    timer: null,
    stringIdx: 0,
    nextTime: 0,
    // settings
    baseFreq: NOTES.find((n) => n.name === 'G3').freq,
    jod: 'Pa',
    tone: 'Classic',
    cents: 0, // fine tune (like the Saarang's fine-pitch steps)
    pace: 0.62, // seconds between plucks
    volume: 0.7,
  };

  // Karplus-Strong: render one plucked-string note into an AudioBuffer.
  // `ring` = seconds until it decays to near silence (lower strings ring longer).
  // `tone` = a TAN_TONES entry shaping brightness/sustain (the "naad").
  function renderString(actx, freq, ring, tone) {
    const sr = actx.sampleRate;
    const N = Math.max(2, Math.round(sr / freq));
    const total = Math.floor(sr * ring);
    const buf = actx.createBuffer(1, total, sr);
    const out = buf.getChannelData(0);

    // Excite the delay line with a one-pole-filtered noise burst; `ex` sets how
    // bright/buzzy the pluck starts (lower = warmer, as on the Saarang).
    const ex = tone.ex;
    const line = new Float32Array(N);
    let last = 0;
    for (let i = 0; i < N; i++) {
      const white = Math.random() * 2 - 1;
      last = ex * white + (1 - ex) * last;
      line[i] = last;
    }

    // Decay factor applied to each delay-line element. In Karplus-Strong every
    // element is updated once per *period* (once per N samples), so the factor
    // is tuned per-period — freq*ring periods — to reach ~-66dB at `ring` sec.
    const decay = Math.exp(Math.log(0.0005) / (freq * ring));
    const b = tone.loop; // feedback-filter brightness
    let idx = 0;
    let prev = 0;
    for (let n = 0; n < total; n++) {
      const cur = line[idx];
      out[n] = cur;
      const nextIdx = (idx + 1) % N;
      // Weighted low-pass in the feedback loop (b→1 brighter, b→0 darker).
      const filtered = b * cur + (1 - b) * prev;
      line[idx] = decay * filtered;
      prev = cur;
      idx = nextIdx;
    }

    // Gentle 8ms attack so plucks don't click.
    const atk = Math.min(total, Math.floor(sr * 0.008));
    for (let i = 0; i < atk; i++) out[i] *= i / atk;
    return buf;
  }

  function rebuildTanpura() {
    const actx = audio();
    const tone = TAN_TONES[tanpura.tone] || TAN_TONES.Classic;
    const detune = 2 ** (tanpura.cents / 1200); // fine-tune multiplier
    const f = tanpura.baseFreq * detune;
    const mandra = f / 2;
    const jodFreq = mandra * JOD[tanpura.jod];
    // string: [freq, ring seconds]
    const specs = [
      [jodFreq, 3.6],
      [f, 3.2],
      [f, 3.2],
      [mandra, 5.0], // low Sa rings longest
    ];
    tanpura.buffers = specs.map(([fr, ring]) => renderString(actx, fr, ring * tone.ring, tone));
  }

  function pluck(when, buffer, gain) {
    const actx = audio();
    const src = actx.createBufferSource();
    src.buffer = buffer;
    const g = actx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(tanpura.master);
    src.start(when);
  }

  // Lookahead scheduler — keeps ~0.3s of plucks queued for glitch-free timing.
  function tanpuraScheduler() {
    const actx = audio();
    while (tanpura.nextTime < actx.currentTime + 0.3) {
      const i = tanpura.stringIdx % 4;
      // The mandra Sa (last string) a touch louder for that tanpura foundation.
      const gain = i === 3 ? 1.0 : 0.85;
      pluck(tanpura.nextTime, tanpura.buffers[i], gain);
      tanpura.nextTime += tanpura.pace;
      tanpura.stringIdx += 1;
    }
  }

  function startTanpura() {
    const actx = audio();
    if (!tanpura.buffers.length) rebuildTanpura();
    tanpura.master = actx.createGain();
    tanpura.master.gain.value = tanpura.volume;
    tanpura.master.connect(actx.destination);
    tanpura.stringIdx = 0;
    tanpura.nextTime = actx.currentTime + 0.08;
    tanpura.playing = true;
    tanpuraScheduler();
    tanpura.timer = setInterval(tanpuraScheduler, 60);
    reflectTanpura();
  }

  function stopTanpura() {
    tanpura.playing = false;
    clearInterval(tanpura.timer);
    tanpura.timer = null;
    if (tanpura.master) {
      // Quick fade to avoid a click, then drop the node.
      const actx = audio();
      const m = tanpura.master;
      m.gain.setValueAtTime(m.gain.value, actx.currentTime);
      m.gain.linearRampToValueAtTime(0, actx.currentTime + 0.25);
      setTimeout(() => m.disconnect(), 350);
      tanpura.master = null;
    }
    reflectTanpura();
  }

  function reflectTanpura() {
    const btn = panel.querySelector('#tanToggle');
    if (btn) {
      btn.textContent = tanpura.playing ? '■ Stop tanpura' : '▶ Start tanpura';
      btn.classList.toggle('gold', !tanpura.playing);
      btn.classList.toggle('ghost', tanpura.playing);
    }
    const dot = panel.querySelector('#tanDot');
    if (dot) dot.classList.toggle('live', tanpura.playing);
  }

  // =========================================================================
  //  METRONOME / TALA
  // =========================================================================
  // Each tala is an accent map: 1 = sam (strongest), 2 = anga accent, 0 = beat.
  const TALAS = {
    '4/4 (common)': [1, 0, 0, 0],
    '3/4 (waltz)': [1, 0, 0],
    '2/4': [1, 0],
    '6/8': [1, 0, 0, 2, 0, 0],
    'Adi tala (8)': [1, 0, 0, 0, 2, 0, 2, 0],
    'Rupaka (6)': [1, 0, 2, 0, 0, 0],
    'Tisra (3)': [1, 0, 0],
    'Khanda Chapu (5)': [1, 0, 2, 0, 0],
    'Misra Chapu (7)': [1, 0, 0, 2, 0, 2, 0],
  };

  const metro = {
    playing: false,
    bpm: 72,
    tala: 'Adi tala (8)',
    volume: 0.9,
    master: null,
    timer: null,
    beat: 0, // index into the current tala pattern
    nextTime: 0,
    taps: [],
  };

  function clickAt(when, type) {
    const actx = audio();
    // sam = bright high, anga accent = mid, beat = low woodblock-ish.
    const freq = type === 1 ? 1600 : type === 2 ? 1150 : 820;
    const gain = type === 1 ? 1.0 : type === 2 ? 0.75 : 0.55;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.frequency.value = freq;
    osc.type = 'square';
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g).connect(metro.master);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  function metroScheduler() {
    const actx = audio();
    const pattern = TALAS[metro.tala];
    const spb = 60 / metro.bpm;
    while (metro.nextTime < actx.currentTime + 0.3) {
      const idx = metro.beat % pattern.length;
      clickAt(metro.nextTime, pattern[idx]);
      lightBeat(idx, metro.nextTime - actx.currentTime);
      metro.nextTime += spb;
      metro.beat += 1;
    }
  }

  // Schedule the visual dot highlight to line up with the audible click.
  function lightBeat(idx, delay) {
    setTimeout(() => {
      panel.querySelectorAll('.beat-dot').forEach((d, i) =>
        d.classList.toggle('on', i === idx),
      );
    }, Math.max(0, delay * 1000));
  }

  function startMetro() {
    const actx = audio();
    metro.master = actx.createGain();
    metro.master.gain.value = metro.volume;
    metro.master.connect(actx.destination);
    metro.beat = 0;
    metro.nextTime = actx.currentTime + 0.1;
    metro.playing = true;
    metroScheduler();
    metro.timer = setInterval(metroScheduler, 25);
    reflectMetro();
  }

  function stopMetro() {
    metro.playing = false;
    clearInterval(metro.timer);
    metro.timer = null;
    if (metro.master) {
      metro.master.disconnect();
      metro.master = null;
    }
    panel.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('on'));
    reflectMetro();
  }

  function reflectMetro() {
    const btn = panel.querySelector('#metToggle');
    if (btn) {
      btn.textContent = metro.playing ? '■ Stop' : '▶ Start';
      btn.classList.toggle('gold', !metro.playing);
      btn.classList.toggle('ghost', metro.playing);
    }
  }

  function renderBeatDots() {
    const pattern = TALAS[metro.tala];
    const wrap = panel.querySelector('#beatDots');
    wrap.innerHTML = pattern
      .map((t, i) => {
        const cls = t === 1 ? 'sam' : t === 2 ? 'anga' : '';
        return `<span class="beat-dot ${cls}" title="Beat ${i + 1}">${i + 1}</span>`;
      })
      .join('');
  }

  function tapTempo() {
    const now = performance.now();
    metro.taps = metro.taps.filter((t) => now - t < 3000);
    metro.taps.push(now);
    if (metro.taps.length >= 2) {
      const gaps = [];
      for (let i = 1; i < metro.taps.length; i++) gaps.push(metro.taps[i] - metro.taps[i - 1]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= 30 && bpm <= 300) setBpm(bpm);
    }
  }

  function setBpm(bpm) {
    metro.bpm = bpm;
    panel.querySelector('#bpmRange').value = bpm;
    panel.querySelector('#bpmVal').textContent = bpm;
  }

  // =========================================================================
  //  SHRUTI BOX (surpeti) — sustained harmonium-reed drone.
  //  Additive reed timbre (custom PeriodicWave) + a detuned second oscillator
  //  per reed for the characteristic beating, a gentle bellows tremolo, and
  //  optional vibrato. Each swara is an independent reed you switch on/off,
  //  just like the stops on a real shruti box. Sustains until powered off.
  // =========================================================================
  // Professional 13-note chromatic reed bank (Sa → Ṡa), like a real shruti box,
  // plus a low-Sa foundation reed. `offset` = semitones from the chosen Sa; the
  // Western note shown on each reed is derived live from the selected Sa. `sw`
  // is the Carnatic swarasthana label. Default on: low Sa + Sa + Pa.
  const SWARAS = [
    { id: '-12', sw: 'Ṣ', sub: 'low Sa', offset: -12, on: true },
    { id: '0', sw: 'S', sub: 'Sa', offset: 0, on: true },
    { id: '1', sw: 'r', sub: 'śuddha Ri', offset: 1, on: false },
    { id: '2', sw: 'R', sub: 'Ri', offset: 2, on: false },
    { id: '3', sw: 'g', sub: 'śuddha Ga', offset: 3, on: false },
    { id: '4', sw: 'G', sub: 'Ga', offset: 4, on: false },
    { id: '5', sw: 'm', sub: 'Ma', offset: 5, on: false },
    { id: '6', sw: 'M', sub: 'tīvra Ma', offset: 6, on: false },
    { id: '7', sw: 'P', sub: 'Pa', offset: 7, on: true },
    { id: '8', sw: 'd', sub: 'śuddha Dha', offset: 8, on: false },
    { id: '9', sw: 'D', sub: 'Dha', offset: 9, on: false },
    { id: '10', sw: 'n', sub: 'śuddha Ni', offset: 10, on: false },
    { id: '11', sw: 'N', sub: 'Ni', offset: 11, on: false },
    { id: '12', sw: 'Ṡ', sub: 'high Sa', offset: 12, on: false },
  ];

  // Common vocal / instrumental anchor pitches for quick selection.
  const ANCHORS = [
    { group: 'Male', notes: ['C3', 'C#3', 'D3'] },
    { group: 'Female', notes: ['G3', 'A3', 'C4'] },
    { group: 'Specialty', notes: ['G2', 'A#2'] },
  ];

  const sb = {
    on: false,
    baseFreq: NOTES.find((n) => n.name === 'G3').freq,
    concert: 440, // A4 calibration: 440 (standard) or 432 (alt "healing")
    cents: 0,
    volume: 0.6,
    reed: 6, // chorus detune in cents (richness/beating)
    vibrato: 6, // vibrato depth in cents
    swaras: SWARAS,
    // audio nodes
    master: null,
    bus: null,
    lp: null,
    tremGain: null,
    tremLFO: null,
    vibLFO: null,
    vibDepth: null,
    wave: null,
    voices: {}, // id -> { oscs:[], gain, level }
  };

  // A harmonium-reed timbre: strong fundamental with a warm, rolling-off set of
  // partials (a touch of odd-harmonic bite for the reed character).
  function makeReedWave(actx) {
    const partials = [0, 1, 0.6, 0.42, 0.32, 0.24, 0.18, 0.14, 0.1, 0.075, 0.055, 0.04, 0.03, 0.022, 0.016, 0.011];
    const real = new Float32Array(partials.length);
    const imag = new Float32Array(partials.length);
    for (let i = 0; i < partials.length; i++) imag[i] = partials[i];
    return actx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function sbBuildGraph() {
    const actx = audio();
    sb.wave = makeReedWave(actx);

    sb.bus = actx.createGain();
    sb.bus.gain.value = 0.5;
    sb.lp = actx.createBiquadFilter();
    sb.lp.type = 'lowpass';
    sb.lp.frequency.value = 3400;
    sb.lp.Q.value = 0.5;
    sb.tremGain = actx.createGain();
    sb.tremGain.gain.value = 1;
    sb.master = actx.createGain();
    sb.master.gain.value = 0; // swelled up in sbPowerOn

    sb.bus.connect(sb.lp);
    sb.lp.connect(sb.tremGain);
    sb.tremGain.connect(sb.master);
    sb.master.connect(actx.destination);

    // Bellows tremolo — a slow, shallow amplitude wobble.
    sb.tremLFO = actx.createOscillator();
    sb.tremLFO.frequency.value = 5.0;
    const tdepth = actx.createGain();
    tdepth.gain.value = 0.05;
    sb.tremLFO.connect(tdepth).connect(sb.tremGain.gain);
    sb.tremLFO.start();

    // Shared vibrato LFO — fed into every reed's detune.
    sb.vibLFO = actx.createOscillator();
    sb.vibLFO.frequency.value = 5.2;
    sb.vibDepth = actx.createGain();
    sb.vibDepth.gain.value = sb.vibrato;
    sb.vibLFO.connect(sb.vibDepth);
    sb.vibLFO.start();
  }

  // Effective Sa after concert-pitch calibration (440 → 432 shifts everything).
  function effSa() {
    return sb.baseFreq * (sb.concert / 440);
  }
  // A reed's frequency = calibrated Sa shifted by its semitone offset (equal
  // temperament, as on a manufactured reed box).
  function reedFreq(sw) {
    return effSa() * 2 ** (sw.offset / 12);
  }

  function sbStartVoice(sw) {
    const actx = audio();
    const g = actx.createGain();
    g.gain.value = 0;
    g.connect(sb.bus);
    const freq = reedFreq(sw);
    const oscs = [];
    // Two detuned reeds per note for the shruti-box beating.
    for (const sign of [-1, 1]) {
      const o = actx.createOscillator();
      o.setPeriodicWave(sb.wave);
      o.frequency.value = freq;
      o.detune.value = sign * sb.reed + sb.cents;
      sb.vibDepth.connect(o.detune); // vibrato
      o.connect(g);
      o.start();
      oscs.push(o);
    }
    // Low Sa carries a touch more weight; high reeds sit back a little.
    const level = sw.offset <= -12 ? 0.5 : sw.offset >= 12 ? 0.32 : 0.4;
    g.gain.setTargetAtTime(level, actx.currentTime, 0.18); // reed swell
    sb.voices[sw.id] = { oscs, gain: g, level };
  }

  function sbStopVoice(id) {
    const v = sb.voices[id];
    if (!v) return;
    const actx = audio();
    v.gain.gain.setTargetAtTime(0, actx.currentTime, 0.14);
    const { oscs, gain } = v;
    setTimeout(() => {
      oscs.forEach((o) => {
        try { o.stop(); o.disconnect(); } catch (_) {}
      });
      try { gain.disconnect(); } catch (_) {}
    }, 600);
    delete sb.voices[id];
  }

  function sbPowerOn() {
    const actx = audio();
    sbBuildGraph();
    sb.on = true;
    sb.swaras.filter((s) => s.on).forEach(sbStartVoice);
    sb.master.gain.setTargetAtTime(sb.volume, actx.currentTime, 0.25); // bellows in
    reflectShruti();
  }

  function sbPowerOff() {
    sb.on = false;
    const actx = audio();
    if (sb.master) sb.master.gain.setTargetAtTime(0, actx.currentTime, 0.18);
    const ids = Object.keys(sb.voices);
    setTimeout(() => {
      ids.forEach((id) => {
        const v = sb.voices[id];
        if (v) v.oscs.forEach((o) => { try { o.stop(); o.disconnect(); } catch (_) {} });
      });
      sb.voices = {};
      try { sb.tremLFO.stop(); sb.vibLFO.stop(); } catch (_) {}
      if (sb.master) { try { sb.master.disconnect(); } catch (_) {} }
    }, 500);
    reflectShruti();
  }

  // Re-tune live voices when Sa / fine-tune / reed richness change.
  function sbRetune() {
    if (!sb.on) return;
    const actx = audio();
    for (const [id, v] of Object.entries(sb.voices)) {
      const sw = sb.swaras.find((s) => s.id === id);
      const freq = reedFreq(sw);
      v.oscs.forEach((o, i) => {
        o.frequency.setTargetAtTime(freq, actx.currentTime, 0.03);
        o.detune.setValueAtTime((i === 0 ? -1 : 1) * sb.reed + sb.cents, actx.currentTime);
      });
    }
  }

  function reflectShruti() {
    const btn = panel.querySelector('#sbPower');
    if (btn) {
      btn.textContent = sb.on ? '⏻ Power off' : '⏻ Power on';
      btn.classList.toggle('gold', !sb.on);
      btn.classList.toggle('ghost', sb.on);
    }
    const dot = panel.querySelector('#sbDot');
    if (dot) dot.classList.toggle('live', sb.on);
  }

  // =========================================================================
  //  UI
  // =========================================================================
  function optionList(sel, def) {
    return sel
      .map((o) => `<option value="${o}"${o === def ? ' selected' : ''}>${o}</option>`)
      .join('');
  }

  panel.innerHTML = `
    <div class="practice-grid">
      <!-- Shruti Box (surpeti) -->
      <div class="pcard practice-card sb-card">
        <div class="pc-head">
          <h4>🪗 Shruti Box <span class="live-dot" id="sbDot"></span></h4>
          <p class="meta">Harmonium-reed drone (surpeti). Pick your Sa, switch reeds on/off, and it sustains continuously.</p>
        </div>
        <div class="pfield">
          <label>Sa (kattai · pitch) <span class="muted" id="sbSaHz"></span></label>
          <select id="sbNote">${NOTES.map(
            (n) =>
              `<option value="${n.freq}"${n.name === 'G3' ? ' selected' : ''}>${n.kattai} kattai · ${n.name} · ${n.freq.toFixed(1)} Hz</option>`,
          ).join('')}</select>
        </div>
        <div class="pfield">
          <label>Concert pitch (A4 calibration)</label>
          <select id="sbConcert">
            <option value="440" selected>A = 440 Hz (standard)</option>
            <option value="432">A = 432 Hz (alt “healing”)</option>
          </select>
        </div>
        <div class="pfield">
          <label>Quick Sa (voice range)</label>
          <div class="anchor-rows" id="sbAnchors">${ANCHORS.map(
            (a) =>
              `<div class="anchor-row"><span class="anchor-grp">${a.group}</span>${a.notes
                .map((nm) => `<button class="ghost tiny anchor" data-note="${nm}">${nm}</button>`)
                .join('')}</div>`,
          ).join('')}</div>
        </div>
        <div class="pfield">
          <label>Reeds — 13-note chromatic (Sa → Ṡa)</label>
          <div class="reed-toggles" id="sbReeds"></div>
        </div>
        <div class="pfield">
          <label>Volume</label>
          <input type="range" id="sbVol" min="0" max="1" step="0.01" value="0.6" />
        </div>
        <div class="pfield">
          <label>Reed richness <span class="muted" id="sbReedVal">medium</span></label>
          <input type="range" id="sbReed" min="0" max="16" step="0.5" value="6" />
        </div>
        <div class="pfield">
          <label>Vibrato <span class="muted" id="sbVibVal">gentle</span></label>
          <input type="range" id="sbVib" min="0" max="18" step="0.5" value="6" />
        </div>
        <div class="pfield">
          <label>Fine tune <span class="muted" id="sbCentsVal">0 ¢</span></label>
          <input type="range" id="sbCents" min="-50" max="50" step="1" value="0" />
        </div>
        <div class="pfield">
          <label>Presets</label>
          <div class="preset-row">
            <select id="sbPreset"><option value="">— recall a preset —</option></select>
            <button class="ghost tiny" id="sbDel" title="Delete selected preset">🗑</button>
          </div>
          <div class="preset-row" style="margin-top:8px">
            <input type="text" id="sbPresetName" placeholder="Name this setup…" maxlength="40" />
            <button class="ghost tiny" id="sbSave">💾 Save</button>
          </div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="gold" id="sbPower">⏻ Power on</button>
        </div>
      </div>

      <!-- Tanpura -->
      <div class="pcard practice-card">
        <div class="pc-head">
          <h4>🎼 Tanpura <span class="live-dot" id="tanDot"></span></h4>
          <p class="meta">Continuous shruti drone. Pick your Sa and it keeps playing while you practise or browse.</p>
        </div>
        <div class="pfield">
          <label>Sa (kattai · pitch)</label>
          <select id="tanNote">${NOTES.map(
            (n) =>
              `<option value="${n.freq}"${n.name === 'G3' ? ' selected' : ''}>${n.kattai} kattai · ${n.name} · ${n.freq.toFixed(1)} Hz</option>`,
          ).join('')}</select>
        </div>
        <div class="pfield">
          <label>First string (jod)</label>
          <select id="tanJod">${optionList(['Pa', 'Ma', 'Ni', 'Sa'], 'Pa')}</select>
        </div>
        <div class="pfield">
          <label>Naad (tone)</label>
          <select id="tanTone">${optionList(Object.keys(TAN_TONES), 'Classic')}</select>
        </div>
        <div class="pfield">
          <label>Fine tune <span class="muted" id="tanCentsVal">0 ¢</span></label>
          <input type="range" id="tanCents" min="-50" max="50" step="1" value="0" />
        </div>
        <div class="pfield">
          <label>Pace <span class="muted" id="paceVal">medium</span></label>
          <input type="range" id="tanPace" min="0.35" max="1.1" step="0.01" value="0.62" />
        </div>
        <div class="pfield">
          <label>Volume</label>
          <input type="range" id="tanVol" min="0" max="1" step="0.01" value="0.7" />
        </div>
        <div class="pfield">
          <label>Presets</label>
          <div class="preset-row">
            <select id="tanPreset"><option value="">— recall a preset —</option></select>
            <button class="ghost tiny" id="tanDel" title="Delete selected preset">🗑</button>
          </div>
          <div class="preset-row" style="margin-top:8px">
            <input type="text" id="tanPresetName" placeholder="Name this setup…" maxlength="40" />
            <button class="ghost tiny" id="tanSave">💾 Save</button>
          </div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="gold" id="tanToggle">▶ Start tanpura</button>
        </div>
        <p class="meta" style="margin-top:12px">Tip: change Sa or jod while it plays — it re-tunes instantly.</p>
      </div>

      <!-- Metronome -->
      <div class="pcard practice-card">
        <div class="pc-head">
          <h4>🥁 Tala Metronome</h4>
          <p class="meta">Keep time with common talas — sam and anga beats are accented.</p>
        </div>
        <div class="pfield">
          <label>Tala / pattern</label>
          <select id="metTala">${optionList(Object.keys(TALAS), 'Adi tala (8)')}</select>
        </div>
        <div class="pfield">
          <label>Tempo <span class="muted"><b id="bpmVal">72</b> BPM</span></label>
          <input type="range" id="bpmRange" min="30" max="300" step="1" value="72" />
        </div>
        <div class="beat-dots" id="beatDots"></div>
        <div class="pfield">
          <label>Volume</label>
          <input type="range" id="metVol" min="0" max="1" step="0.01" value="0.9" />
        </div>
        <div class="row" style="margin-top:14px">
          <button class="gold" id="metToggle">▶ Start</button>
          <button class="ghost" id="tapBtn">Tap tempo</button>
        </div>
      </div>
    </div>
  `;

  const q = (s) => panel.querySelector(s);

  // --- Wire shruti box ---
  // The NOTES entry nearest the current Sa (gives us its pitch class + octave).
  function saNote() {
    return NOTES.reduce((a, b) =>
      Math.abs(b.freq - sb.baseFreq) < Math.abs(a.freq - sb.baseFreq) ? b : a,
    );
  }
  // Western note name for a reed at `offset` semitones above the selected Sa.
  function reedNoteName(offset) {
    const midi = saNote().midi + offset;
    return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }
  function updateSaReadout() {
    const hz = effSa();
    q('#sbSaHz').textContent = `${saNote().name} · ${hz.toFixed(1)} Hz${sb.concert !== 440 ? ` (A=${sb.concert})` : ''}`;
  }

  function renderReeds() {
    q('#sbReeds').innerHTML = sb.swaras
      .map(
        (s) =>
          `<button class="reed${s.on ? ' on' : ''}" data-id="${s.id}" title="${s.sub}">
             <span class="reed-l">${reedNoteName(s.offset)}</span><span class="reed-s">${s.sw} · ${s.sub}</span>
           </button>`,
      )
      .join('');
    q('#sbReeds')
      .querySelectorAll('.reed')
      .forEach((b) =>
        b.addEventListener('click', () => {
          const sw = sb.swaras.find((s) => s.id === b.dataset.id);
          sw.on = !sw.on;
          b.classList.toggle('on', sw.on);
          if (sb.on) sw.on ? sbStartVoice(sw) : sbStopVoice(sw.id);
        }),
      );
  }
  renderReeds();
  updateSaReadout();

  q('#sbNote').addEventListener('change', (e) => {
    sb.baseFreq = Number(e.target.value);
    renderReeds(); // reed labels follow the new Sa
    updateSaReadout();
    sbRetune();
  });
  q('#sbConcert').addEventListener('change', (e) => {
    sb.concert = Number(e.target.value);
    updateSaReadout();
    sbRetune();
  });
  q('#sbAnchors')
    .querySelectorAll('.anchor')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const note = NOTES.find((n) => n.name === b.dataset.note);
        if (!note) return;
        sb.baseFreq = note.freq;
        q('#sbNote').value = String(note.freq);
        renderReeds();
        updateSaReadout();
        sbRetune();
      }),
    );
  q('#sbVol').addEventListener('input', (e) => {
    sb.volume = Number(e.target.value);
    if (sb.on && sb.master) sb.master.gain.setTargetAtTime(sb.volume, audio().currentTime, 0.05);
  });
  q('#sbReed').addEventListener('input', (e) => {
    sb.reed = Number(e.target.value);
    q('#sbReedVal').textContent = sb.reed < 4 ? 'pure' : sb.reed > 10 ? 'rich' : 'medium';
    sbRetune();
  });
  q('#sbVib').addEventListener('input', (e) => {
    sb.vibrato = Number(e.target.value);
    q('#sbVibVal').textContent = sb.vibrato < 3 ? 'off' : sb.vibrato > 12 ? 'strong' : 'gentle';
    if (sb.vibDepth) sb.vibDepth.gain.setTargetAtTime(sb.vibrato, audio().currentTime, 0.05);
  });
  q('#sbCents').addEventListener('input', (e) => {
    sb.cents = Number(e.target.value);
    q('#sbCentsVal').textContent = `${sb.cents > 0 ? '+' : ''}${sb.cents} ¢`;
    sbRetune();
  });
  q('#sbPower').addEventListener('click', () => {
    sb.on ? sbPowerOff() : sbPowerOn();
  });

  // --- Shruti presets ---
  // Starter presets ship with the app so every teacher sees them on any device
  // (read-only). Each teacher's own presets are saved per-browser in localStorage.
  const PRESET_KEY = 'gaanasudha.shruti.presets';
  const escHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const noteFreq = (nm) => NOTES.find((n) => n.name === nm).freq;
  // reed ids: low Sa '-12', Sa '0', Ma '5', Pa '7', high Sa '12'.
  const STARTER_PRESETS = [
    { name: 'Male Sa — C (Sa · Pa)', sa: noteFreq('C3'), concert: 440, reeds: ['-12', '0', '7'], reed: 6, vibrato: 6, cents: 0, volume: 0.6 },
    { name: 'Male Sa — D (Sa · Pa)', sa: noteFreq('D3'), concert: 440, reeds: ['-12', '0', '7'], reed: 6, vibrato: 6, cents: 0, volume: 0.6 },
    { name: 'Female Sa — G (Sa · Pa)', sa: noteFreq('G3'), concert: 440, reeds: ['-12', '0', '7'], reed: 6, vibrato: 6, cents: 0, volume: 0.6 },
    { name: 'Female Sa — A (Sa · Pa)', sa: noteFreq('A3'), concert: 440, reeds: ['-12', '0', '7'], reed: 6, vibrato: 6, cents: 0, volume: 0.6 },
    { name: 'Bhajan — G (Sa · Pa · Ṡa)', sa: noteFreq('G3'), concert: 440, reeds: ['-12', '0', '7', '12'], reed: 7, vibrato: 7, cents: 0, volume: 0.62 },
    { name: 'Carnatic — C (Sa · Ma)', sa: noteFreq('C4'), concert: 440, reeds: ['-12', '0', '5'], reed: 6, vibrato: 5, cents: 0, volume: 0.6 },
    { name: 'Meditative — G2 · 432 Hz', sa: noteFreq('G2'), concert: 432, reeds: ['-12', '0', '7'], reed: 9, vibrato: 9, cents: 0, volume: 0.6 },
  ];

  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || []; } catch { return []; }
  }
  function storePresets(arr) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function saNameFor(freq) {
    const n = NOTES.reduce((a, b) => (Math.abs(b.freq - freq) < Math.abs(a.freq - freq) ? b : a));
    return `${n.kattai} kattai · ${n.name}`;
  }
  // Options are namespaced: 'b<i>' = built-in starter, 'u<i>' = user preset.
  function refreshPresetSelect(selectVal) {
    const opt = (val, label) =>
      `<option value="${val}"${val === selectVal ? ' selected' : ''}>${escHtml(label)}</option>`;
    const starters = STARTER_PRESETS.map((p, i) => opt(`b${i}`, p.name)).join('');
    const mine = loadPresets().map((p, i) => opt(`u${i}`, p.name)).join('');
    q('#sbPreset').innerHTML =
      '<option value="">— recall a preset —</option>' +
      `<optgroup label="Starter presets (teachers)">${starters}</optgroup>` +
      (mine ? `<optgroup label="My presets">${mine}</optgroup>` : '');
  }
  function presetByValue(val) {
    if (!val) return null;
    const i = Number(val.slice(1));
    return val[0] === 'b' ? STARTER_PRESETS[i] : loadPresets()[i];
  }

  // Push the current sb state onto every control + the live audio graph.
  function syncShrutiUI() {
    const opt = [...q('#sbNote').options].find((o) => Math.abs(Number(o.value) - sb.baseFreq) < 0.5);
    if (opt) q('#sbNote').value = opt.value;
    q('#sbConcert').value = String(sb.concert);
    q('#sbVol').value = sb.volume;
    q('#sbReed').value = sb.reed;
    q('#sbReedVal').textContent = sb.reed < 4 ? 'pure' : sb.reed > 10 ? 'rich' : 'medium';
    q('#sbVib').value = sb.vibrato;
    q('#sbVibVal').textContent = sb.vibrato < 3 ? 'off' : sb.vibrato > 12 ? 'strong' : 'gentle';
    q('#sbCents').value = sb.cents;
    q('#sbCentsVal').textContent = `${sb.cents > 0 ? '+' : ''}${sb.cents} ¢`;
    renderReeds(); // rebuilds reed buttons with correct on-states + Western labels
    updateSaReadout();
  }

  function applyPreset(p) {
    sb.baseFreq = p.sa;
    if (p.concert != null) sb.concert = p.concert;
    if (p.reed != null) sb.reed = p.reed;
    if (p.vibrato != null) sb.vibrato = p.vibrato;
    sb.cents = p.cents || 0;
    if (p.volume != null) sb.volume = p.volume;
    const onSet = new Set(p.reeds || []);
    sb.swaras.forEach((s) => (s.on = onSet.has(s.id)));
    syncShrutiUI();
    if (sb.on) {
      // Reconcile the live reeds with the recalled selection.
      sb.swaras.forEach((s) => {
        const has = !!sb.voices[s.id];
        if (s.on && !has) sbStartVoice(s);
        else if (!s.on && has) sbStopVoice(s.id);
      });
      const t = audio().currentTime;
      if (sb.vibDepth) sb.vibDepth.gain.setTargetAtTime(sb.vibrato, t, 0.05);
      if (sb.master) sb.master.gain.setTargetAtTime(sb.volume, t, 0.05);
      sbRetune();
    }
  }

  q('#sbPreset').addEventListener('change', (e) => {
    const p = presetByValue(e.target.value);
    if (p) applyPreset(p);
  });
  q('#sbSave').addEventListener('click', () => {
    const presets = loadPresets();
    const typed = q('#sbPresetName').value.trim();
    const reeds = sb.swaras.filter((s) => s.on).map((s) => s.id);
    const name = typed || `${saNameFor(sb.baseFreq)} (${reeds.length} reeds)`;
    const preset = {
      name,
      sa: sb.baseFreq,
      concert: sb.concert,
      reeds,
      reed: sb.reed,
      vibrato: sb.vibrato,
      cents: sb.cents,
      volume: sb.volume,
    };
    // Overwrite if the name already exists, else append.
    const existing = presets.findIndex((p) => p.name === name);
    let idx;
    if (existing >= 0) { presets[existing] = preset; idx = existing; }
    else { presets.push(preset); idx = presets.length - 1; }
    storePresets(presets);
    refreshPresetSelect(`u${idx}`);
    q('#sbPresetName').value = '';
  });
  q('#sbDel').addEventListener('click', () => {
    const sel = q('#sbPreset').value;
    if (sel[0] !== 'u') return; // starter presets are read-only
    const presets = loadPresets();
    presets.splice(Number(sel.slice(1)), 1);
    storePresets(presets);
    refreshPresetSelect();
  });

  refreshPresetSelect();

  // --- Wire tanpura ---
  const paceLabel = (v) => (v < 0.5 ? 'fast' : v > 0.8 ? 'slow' : 'medium');

  q('#tanNote').addEventListener('change', (e) => {
    tanpura.baseFreq = Number(e.target.value);
    if (tanpura.playing) rebuildTanpura();
  });
  q('#tanJod').addEventListener('change', (e) => {
    tanpura.jod = e.target.value;
    if (tanpura.playing) rebuildTanpura();
  });
  q('#tanTone').addEventListener('change', (e) => {
    tanpura.tone = e.target.value;
    if (tanpura.playing) rebuildTanpura();
  });
  q('#tanCents').addEventListener('input', (e) => {
    tanpura.cents = Number(e.target.value);
    q('#tanCentsVal').textContent = `${tanpura.cents > 0 ? '+' : ''}${tanpura.cents} ¢`;
    if (tanpura.playing) rebuildTanpura();
  });
  q('#tanPace').addEventListener('input', (e) => {
    tanpura.pace = Number(e.target.value);
    q('#paceVal').textContent = paceLabel(tanpura.pace);
  });
  q('#tanVol').addEventListener('input', (e) => {
    tanpura.volume = Number(e.target.value);
    if (tanpura.master) tanpura.master.gain.value = tanpura.volume;
  });
  q('#tanToggle').addEventListener('click', () => {
    tanpura.playing ? stopTanpura() : startTanpura();
  });

  // --- Tanpura presets (starter set ships with the app; user presets in localStorage) ---
  const TAN_KEY = 'gaanasudha.tanpura.presets';
  // Matches the Shruti Box starter set. jod = first string (Pa/Ma/Ni/Sa).
  const T = (o) => ({ tone: 'Classic', cents: 0, pace: 0.62, volume: 0.7, ...o });
  const STARTER_TANPURA = [
    T({ name: 'Male Sa — C (Pa)', sa: noteFreq('C3'), jod: 'Pa' }),
    T({ name: 'Male Sa — D (Pa)', sa: noteFreq('D3'), jod: 'Pa' }),
    T({ name: 'Female Sa — G (Pa)', sa: noteFreq('G3'), jod: 'Pa' }),
    T({ name: 'Female Sa — A (Pa)', sa: noteFreq('A3'), jod: 'Pa' }),
    T({ name: 'Bhajan — G (Ni)', sa: noteFreq('G3'), jod: 'Ni', pace: 0.55, volume: 0.72 }),
    T({ name: 'Carnatic — C (Ma)', sa: noteFreq('C4'), jod: 'Ma' }),
    T({ name: 'Meditative — G2 (slow)', sa: noteFreq('G2'), jod: 'Pa', pace: 0.95 }),
    // RADEL Saarang Maestro DX emulation — warm naad, its common tunings.
    T({ name: 'Saarang Maestro DX — Male C (Pa)', sa: noteFreq('C3'), jod: 'Pa', tone: 'Saarang (warm)', pace: 0.6, volume: 0.72 }),
    T({ name: 'Saarang Maestro DX — Female G (Pa)', sa: noteFreq('G3'), jod: 'Pa', tone: 'Saarang (warm)', pace: 0.6, volume: 0.72 }),
    T({ name: 'Saarang Maestro DX — Female A (Pa)', sa: noteFreq('A3'), jod: 'Pa', tone: 'Saarang (warm)', pace: 0.6, volume: 0.72 }),
    T({ name: 'Saarang Maestro DX — Sa–Ma C (Ma)', sa: noteFreq('C4'), jod: 'Ma', tone: 'Saarang (warm)', pace: 0.6, volume: 0.72 }),
  ];

  const loadTanPresets = () => {
    try { return JSON.parse(localStorage.getItem(TAN_KEY)) || []; } catch { return []; }
  };
  const storeTanPresets = (arr) => {
    try { localStorage.setItem(TAN_KEY, JSON.stringify(arr)); } catch (_) {}
  };
  function refreshTanSelect(selectVal) {
    const opt = (val, label) =>
      `<option value="${val}"${val === selectVal ? ' selected' : ''}>${escHtml(label)}</option>`;
    const starters = STARTER_TANPURA.map((p, i) => opt(`b${i}`, p.name)).join('');
    const mine = loadTanPresets().map((p, i) => opt(`u${i}`, p.name)).join('');
    q('#tanPreset').innerHTML =
      '<option value="">— recall a preset —</option>' +
      `<optgroup label="Starter presets (teachers)">${starters}</optgroup>` +
      (mine ? `<optgroup label="My presets">${mine}</optgroup>` : '');
  }
  const tanPresetByValue = (val) => {
    if (!val) return null;
    const i = Number(val.slice(1));
    return val[0] === 'b' ? STARTER_TANPURA[i] : loadTanPresets()[i];
  };
  function applyTanPreset(p) {
    tanpura.baseFreq = p.sa;
    tanpura.jod = p.jod || 'Pa';
    tanpura.tone = TAN_TONES[p.tone] ? p.tone : 'Classic';
    tanpura.cents = p.cents || 0;
    if (p.pace != null) tanpura.pace = p.pace;
    if (p.volume != null) tanpura.volume = p.volume;
    // Reflect on the controls.
    const noteOpt = [...q('#tanNote').options].find((o) => Math.abs(Number(o.value) - tanpura.baseFreq) < 0.5);
    if (noteOpt) q('#tanNote').value = noteOpt.value;
    q('#tanJod').value = tanpura.jod;
    q('#tanTone').value = tanpura.tone;
    q('#tanCents').value = tanpura.cents;
    q('#tanCentsVal').textContent = `${tanpura.cents > 0 ? '+' : ''}${tanpura.cents} ¢`;
    q('#tanPace').value = tanpura.pace;
    q('#paceVal').textContent = paceLabel(tanpura.pace);
    q('#tanVol').value = tanpura.volume;
    // Apply live if it's playing.
    if (tanpura.playing) {
      rebuildTanpura();
      if (tanpura.master) tanpura.master.gain.value = tanpura.volume;
    }
  }

  q('#tanPreset').addEventListener('change', (e) => {
    const p = tanPresetByValue(e.target.value);
    if (p) applyTanPreset(p);
  });
  q('#tanSave').addEventListener('click', () => {
    const presets = loadTanPresets();
    const typed = q('#tanPresetName').value.trim();
    const name = typed || `${saNameFor(tanpura.baseFreq)} (${tanpura.jod})`;
    const preset = {
      name,
      sa: tanpura.baseFreq,
      jod: tanpura.jod,
      tone: tanpura.tone,
      cents: tanpura.cents,
      pace: tanpura.pace,
      volume: tanpura.volume,
    };
    const existing = presets.findIndex((x) => x.name === name);
    let idx;
    if (existing >= 0) { presets[existing] = preset; idx = existing; }
    else { presets.push(preset); idx = presets.length - 1; }
    storeTanPresets(presets);
    refreshTanSelect(`u${idx}`);
    q('#tanPresetName').value = '';
  });
  q('#tanDel').addEventListener('click', () => {
    const sel = q('#tanPreset').value;
    if (sel[0] !== 'u') return; // starter presets are read-only
    const presets = loadTanPresets();
    presets.splice(Number(sel.slice(1)), 1);
    storeTanPresets(presets);
    refreshTanSelect();
  });
  refreshTanSelect();

  // --- Wire metronome ---
  q('#metTala').addEventListener('change', (e) => {
    metro.tala = e.target.value;
    metro.beat = 0;
    renderBeatDots();
  });
  q('#bpmRange').addEventListener('input', (e) => setBpm(Number(e.target.value)));
  q('#metVol').addEventListener('input', (e) => {
    metro.volume = Number(e.target.value);
    if (metro.master) metro.master.gain.value = metro.volume;
  });
  q('#metToggle').addEventListener('click', () => {
    metro.playing ? stopMetro() : startMetro();
  });
  q('#tapBtn').addEventListener('click', tapTempo);

  renderBeatDots();

  // Expose a stop-all hook (used when logging out / leaving the app).
  window.PracticeTools = {
    stopAll() {
      if (sb.on) sbPowerOff();
      if (tanpura.playing) stopTanpura();
      if (metro.playing) stopMetro();
    },
  };
})();
