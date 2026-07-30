/* ==========================================================================
 *  Studio / Mixer — a professional Web Audio mixing console.
 *  Channels (mic or audio file) → per-channel DSP → master bus → speakers.
 *  Per channel: trim, high-pass, noise gate (denoise), 3-band EQ, de-esser,
 *  compressor, fader, pan, reverb send, duck gain. Smart features: noise
 *  reduction, auto-ducking (music under voice), voice enhance, auto-level (AGC).
 *  Master: convolution reverb return, limiter, spectrum + VU, record→download.
 *  Pure Web Audio; renders into #studioPanel. Independent of app.js.
 * ========================================================================== */
(() => {
  const panel = document.getElementById('studioPanel');
  if (!panel) return;

  let ctx = null;
  const master = {}; // master node graph
  let reverb = null; // convolver
  let engineRAF = null;
  let channels = [];
  let chSeq = 0;
  let recorder = null;
  let recChunks = [];
  let denoiseReady = false;

  // Lazily load the spectral-denoise AudioWorklet module into this context.
  async function ensureDenoiseModule() {
    if (denoiseReady) return true;
    try {
      await audio().audioWorklet.addModule('/js/denoise-worklet.js');
      denoiseReady = true;
      return true;
    } catch (e) {
      console.error('Denoiser unavailable:', e);
      toast('Spectral denoiser not supported in this browser');
      return false;
    }
  }

  // ---- helpers ----
  const q = (s) => panel.querySelector(s);
  const dbToGain = (db) => 10 ** (db / 20);
  function rms(analyser, buf) {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function audio() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    buildMaster();
    startEngine();
    return ctx;
  }

  // Algorithmic reverb impulse: decaying filtered noise (a warm hall).
  function makeIR(seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const ir = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
      }
    }
    return ir;
  }

  function buildMaster() {
    master.bus = ctx.createGain();
    master.bus.gain.value = 1;

    // Reverb aux (channels send here; return folds back into the bus).
    reverb = ctx.createConvolver();
    master.reverbReturn = ctx.createGain();
    master.reverbReturn.gain.value = 0.9;
    reverb.connect(master.reverbReturn).connect(master.bus);
    master.reverbType = 'Hall';
    setReverbType('Hall');

    // Delay / echo aux (channels send here; feedback loop; return to the bus).
    master.delay = ctx.createDelay(2.0);
    master.delay.delayTime.value = 0.28;
    master.delayFb = ctx.createGain(); master.delayFb.gain.value = 0.3;
    master.delayReturn = ctx.createGain(); master.delayReturn.gain.value = 0.9;
    master.delay.connect(master.delayFb).connect(master.delay);
    master.delay.connect(master.delayReturn).connect(master.bus);

    // Master 3-band EQ (shapes the whole mix before the limiter).
    master.mEqLow = ctx.createBiquadFilter(); master.mEqLow.type = 'lowshelf'; master.mEqLow.frequency.value = 180;
    master.mEqMid = ctx.createBiquadFilter(); master.mEqMid.type = 'peaking'; master.mEqMid.frequency.value = 1200; master.mEqMid.Q.value = 0.8;
    master.mEqHigh = ctx.createBiquadFilter(); master.mEqHigh.type = 'highshelf'; master.mEqHigh.frequency.value = 4500;

    // Master limiter (brickwall-ish) — on by default to catch peaks.
    master.limiter = ctx.createDynamicsCompressor();
    setLimiter(true);

    master.gain = ctx.createGain();
    master.gain.value = 0.9;

    master.analyser = ctx.createAnalyser();
    master.analyser.fftSize = 1024;
    master.peakBuf = new Float32Array(master.analyser.fftSize);
    master.mains = 50; // mains-hum frequency for de-hum
    master.msEMA = null; // rolling mean-square for the loudness estimate

    master.bus.connect(master.mEqLow);
    master.mEqLow.connect(master.mEqMid);
    master.mEqMid.connect(master.mEqHigh);
    master.mEqHigh.connect(master.limiter);
    master.limiter.connect(master.gain);
    master.gain.connect(master.analyser);
    master.analyser.connect(ctx.destination);

    // Recording tap.
    master.recDest = ctx.createMediaStreamDestination();
    master.gain.connect(master.recDest);
  }

  // Reverb presets — [seconds, decay exponent]. 'Off' mutes the return.
  const REVERB_IR = { Room: [1.1, 3.4], Hall: [2.9, 2.1], Plate: [1.7, 1.3] };
  function setReverbType(t) {
    master.reverbType = t;
    if (t === 'Off') { master.reverbReturn.gain.value = 0; return; }
    const [s, d] = REVERB_IR[t] || REVERB_IR.Hall;
    reverb.buffer = makeIR(s, d);
    const slider = q('#revReturn');
    master.reverbReturn.gain.value = slider ? Number(slider.value) : 0.9;
  }

  function setLimiter(on) {
    const l = master.limiter;
    if (on) {
      l.threshold.value = -1.5; l.ratio.value = 20; l.attack.value = 0.003; l.release.value = 0.08; l.knee.value = 0;
    } else {
      l.threshold.value = 0; l.ratio.value = 1; l.attack.value = 0.01; l.release.value = 0.1; l.knee.value = 30;
    }
  }

  // ---- Channel factory --------------------------------------------------
  function makeChannel({ type, name, sourceNode, mediaEl, file }) {
    const c = audio();
    const id = ++chSeq;
    const n = {}; // nodes

    n.inGain = c.createGain(); n.inGain.gain.value = 1;
    n.hpf = c.createBiquadFilter(); n.hpf.type = 'highpass'; n.hpf.frequency.value = 25;
    n.gate = c.createGain(); n.gate.gain.value = 1;
    n.eqLow = c.createBiquadFilter(); n.eqLow.type = 'lowshelf'; n.eqLow.frequency.value = 180;
    n.eqMid = c.createBiquadFilter(); n.eqMid.type = 'peaking'; n.eqMid.frequency.value = 1200; n.eqMid.Q.value = 0.9;
    n.eqHigh = c.createBiquadFilter(); n.eqHigh.type = 'highshelf'; n.eqHigh.frequency.value = 4500;
    n.deEss = c.createBiquadFilter(); n.deEss.type = 'highshelf'; n.deEss.frequency.value = 6000; n.deEss.gain.value = 0;
    n.comp = c.createDynamicsCompressor(); setComp(n.comp, false);
    n.fader = c.createGain(); n.fader.gain.value = 0.85;
    n.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    n.duck = c.createGain(); n.duck.gain.value = 1;

    // analysers: pre (for gate/agc), high (for de-ess), post (meter)
    n.preAn = c.createAnalyser(); n.preAn.fftSize = 1024;
    n.highTap = c.createBiquadFilter(); n.highTap.type = 'highpass'; n.highTap.frequency.value = 5500;
    n.highAn = c.createAnalyser(); n.highAn.fftSize = 1024;
    n.postAn = c.createAnalyser(); n.postAn.fftSize = 1024;

    // De-hum notches (mains + 2 harmonics); 'allpass' = transparent when off.
    n.hum1 = c.createBiquadFilter(); n.hum1.type = 'allpass';
    n.hum2 = c.createBiquadFilter(); n.hum2.type = 'allpass';
    n.hum3 = c.createBiquadFilter(); n.hum3.type = 'allpass';

    // wire the chain
    sourceNode.connect(n.inGain);
    n.inGain.connect(n.hpf);
    n.hpf.connect(n.preAn);
    n.hpf.connect(n.hum1); n.hum1.connect(n.hum2); n.hum2.connect(n.hum3);
    n.hum3.connect(n.gate);
    n.gate.connect(n.eqLow); n.eqLow.connect(n.eqMid); n.eqMid.connect(n.eqHigh);
    n.eqHigh.connect(n.deEss);
    n.eqHigh.connect(n.highTap); n.highTap.connect(n.highAn);
    n.deEss.connect(n.comp);
    n.comp.connect(n.fader);
    const afterFader = n.pan ? (n.comp && n.fader.connect(n.pan), n.pan) : n.fader;
    afterFader.connect(n.postAn);
    afterFader.connect(n.duck);
    n.duck.connect(master.bus);

    // reverb + delay sends
    n.revSend = c.createGain(); n.revSend.gain.value = 0;
    afterFader.connect(n.revSend); n.revSend.connect(reverb);
    n.delaySend = c.createGain(); n.delaySend.gain.value = 0;
    afterFader.connect(n.delaySend); n.delaySend.connect(master.delay);

    const ch = {
      id, type, name: name || (type === 'mic' ? `Mic ${id}` : `Track ${id}`),
      role: type === 'mic' ? 'voice' : 'music',
      n, sourceNode, mediaEl, file,
      buf: new Float32Array(n.preAn.fftSize),
      hbuf: new Float32Array(n.highAn.fftSize),
      mbuf: new Float32Array(n.postAn.fftSize),
      mute: false, solo: false,
      denoise: false, comp: false, deEss: false, autoLevel: false, hum: false, snr: false,
      gateThresh: 0.015,
    };
    channels.push(ch);
    return ch;
  }

  // Spectral noise reduction: insert the denoise worklet (once) into the channel
  // chain (inGain → denoiser → hpf) and toggle it via the worklet's enable flag.
  async function applySNR(ch) {
    if (ch.snr) {
      if (!(await ensureDenoiseModule())) { ch.snr = false; renderChannels(); return; }
      if (!ch.n.denoiser) {
        const node = new AudioWorkletNode(ctx, 'spectral-denoise');
        node.port.onmessage = (e) => { if (e.data && e.data.type === 'learned') toast(`Noise learned on “${ch.name}”`); };
        try { ch.n.inGain.disconnect(ch.n.hpf); } catch (_) {}
        ch.n.inGain.connect(node); node.connect(ch.n.hpf);
        ch.n.denoiser = node;
      }
      ch.n.denoiser.port.postMessage({ type: 'enabled', value: true });
    } else if (ch.n.denoiser) {
      ch.n.denoiser.port.postMessage({ type: 'enabled', value: false });
    }
  }

  function learnNoise(ch) {
    if (!ch.snr || !ch.n.denoiser) return toast('Turn on SNR first');
    ch.n.denoiser.port.postMessage({ type: 'learn', frames: 60 });
    toast('Learning noise… keep it quiet (noise only) for ~1s');
  }

  // De-hum: notch the mains frequency + 2 harmonics (transparent 'allpass' off).
  function setHum(ch, on) {
    const f = master.mains || 50;
    [ch.n.hum1, ch.n.hum2, ch.n.hum3].forEach((nd, i) => {
      if (on) { nd.type = 'notch'; nd.frequency.value = f * (i + 1); nd.Q.value = 25; }
      else { nd.type = 'allpass'; }
    });
  }

  function setComp(comp, on) {
    if (on) { comp.threshold.value = -24; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.18; comp.knee.value = 6; }
    else { comp.threshold.value = 0; comp.ratio.value = 1; comp.attack.value = 0.01; comp.release.value = 0.1; comp.knee.value = 30; }
  }

  // ---- Sources ----------------------------------------------------------
  async function addMic() {
    try {
      const c = audio();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      const src = c.createMediaStreamSource(stream);
      const ch = makeChannel({ type: 'mic', sourceNode: src });
      ch.stream = stream;
      renderChannels();
    } catch (e) {
      toast('Microphone access denied or unavailable');
    }
  }

  function addFile(file) {
    const c = audio();
    const el = new Audio();
    el.src = URL.createObjectURL(file);
    el.loop = false;
    el.crossOrigin = 'anonymous';
    const src = c.createMediaElementSource(el);
    const ch = makeChannel({ type: 'file', name: file.name.replace(/\.[^.]+$/, ''), sourceNode: src, mediaEl: el, file });
    renderChannels();
  }

  // Add an academy library track as a channel (backing bed / SFX).
  function addLibrary(id, name, silent) {
    const c = audio();
    const el = new Audio();
    el.src = `/api/stream/${id}`; // same-origin; the session cookie authorizes it
    const src = c.createMediaElementSource(el);
    const ch = makeChannel({ type: 'file', name: name || `Track ${id}`, sourceNode: src, mediaEl: el });
    ch.libId = id; // lets Scenes recreate it later
    if (!silent) renderChannels();
    return ch;
  }

  async function openLibraryPicker() {
    audio();
    let items;
    try { items = (await (await fetch('/api/tracks?limit=1000')).json()).items || []; }
    catch { return toast('Could not load library'); }
    if (!items.length) return toast('Library is empty');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const back = document.createElement('div');
    back.className = 'lib-back';
    back.innerHTML = `<div class="lib-modal">
      <div class="lib-head"><b>Add track from library</b><button class="ghost tiny lib-close">✕</button></div>
      <input class="lib-search" placeholder="Search tracks…" />
      <div class="lib-list"></div></div>`;
    panel.appendChild(back);
    const listEl = back.querySelector('.lib-list');
    const draw = (term) => {
      const f = items.filter((t) => !term || `${t.title} ${t.artist}`.toLowerCase().includes(term));
      listEl.innerHTML = f.slice(0, 300).map((t) =>
        `<button class="lib-item" data-id="${t.id}" data-name="${esc(`${t.artist} – ${t.title}`)}"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></button>`).join('')
        || '<div class="muted" style="padding:14px">No matches</div>';
      listEl.querySelectorAll('.lib-item').forEach((b) =>
        b.addEventListener('click', () => { addLibrary(b.dataset.id, b.dataset.name); back.remove(); }));
    };
    draw('');
    back.querySelector('.lib-search').addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
    back.querySelector('.lib-close').addEventListener('click', () => back.remove());
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  }

  function refreshPlayBtns() {
    channels.forEach((ch) => {
      if (!ch.mediaEl) return;
      const el = panel.querySelector(`.strip[data-id="${ch.id}"] .ch-play`);
      if (el) el.textContent = ch.mediaEl.paused ? '▶' : '⏸';
    });
  }
  function playAll() {
    const c = audio();
    if (c.state === 'suspended') c.resume();
    channels.forEach((ch) => ch.mediaEl && ch.mediaEl.play().catch(() => {}));
    refreshPlayBtns();
  }
  function stopAllPlay() {
    channels.forEach((ch) => ch.mediaEl && (ch.mediaEl.pause(), (ch.mediaEl.currentTime = ch.mediaEl.currentTime)));
    refreshPlayBtns();
  }

  // Encode an AudioBuffer to a 16-bit PCM WAV Blob (for interchange-friendly export).
  function encodeWAV(abuf) {
    const nch = Math.min(2, abuf.numberOfChannels);
    const len = abuf.length;
    const rate = abuf.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + len * nch * 2));
    const ws = (off, s) => { for (let i = 0; i < s.length; i++) data.setUint8(off + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); data.setUint32(4, 36 + len * nch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, nch, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * nch * 2, true);
    data.setUint16(32, nch * 2, true); data.setUint16(34, 16, true); ws(36, 'data');
    data.setUint32(40, len * nch * 2, true);
    const chans = [];
    for (let c = 0; c < nch; c++) chans.push(abuf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nch; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        data.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([data], { type: 'audio/wav' });
  }

  function removeChannel(id) {
    const i = channels.findIndex((c) => c.id === id);
    if (i < 0) return;
    const ch = channels[i];
    try { ch.mediaEl && ch.mediaEl.pause(); } catch (_) {}
    try { ch.stream && ch.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { ch.n.duck.disconnect(); ch.n.revSend.disconnect(); ch.n.delaySend.disconnect(); } catch (_) {}
    try { ch.n.denoiser && ch.n.denoiser.disconnect(); } catch (_) {}
    channels.splice(i, 1);
    renderChannels();
  }

  // ---- Central engine loop (meters, gate, de-ess, ducking, AGC, spectrum) --
  function startEngine() {
    if (engineRAF) return;
    const spec = master.specBuf = new Uint8Array(master.analyser.frequencyBinCount);
    const tick = () => {
      const now = ctx.currentTime;
      const anySolo = channels.some((c) => c.solo);

      // per-channel voice level (for ducking) + processing
      let voiceLevel = 0;
      for (const ch of channels) {
        const n = ch.n;
        const pre = rms(n.preAn, ch.buf);
        const post = rms(n.postAn, ch.mbuf);

        // meter (post-fader), dB-ish scaled 0..1
        const meterVal = Math.min(1, Math.max(0, (20 * Math.log10(post + 1e-6) + 60) / 60));
        if (ch.meterFill) ch.meterFill.style.height = `${Math.round(meterVal * 100)}%`;

        // noise gate (denoise)
        if (ch.denoise) {
          const target = pre > ch.gateThresh ? 1 : 0.04;
          n.gate.gain.setTargetAtTime(target, now, 0.02);
        }
        // de-esser: pull down highs when sibilance spikes
        if (ch.deEss) {
          const hi = rms(n.highAn, ch.hbuf);
          const red = hi > 0.05 ? -Math.min(12, (hi - 0.05) * 120) : 0;
          n.deEss.gain.setTargetAtTime(red, now, 0.02);
        }
        // auto-level (AGC): nudge input trim toward a target loudness
        if (ch.autoLevel && pre > 0.005) {
          const targetRms = 0.12;
          const cur = n.inGain.gain.value;
          const desired = Math.min(6, Math.max(0.2, cur * (targetRms / pre)));
          n.inGain.gain.setTargetAtTime(cur + (desired - cur) * 0.05, now, 0.3);
        }

        // mute/solo → fader-independent output via duck node baseline
        const audible = ch.mute ? 0 : anySolo && !ch.solo ? 0 : 1;
        ch._audible = audible;
        if (ch.role === 'voice') voiceLevel = Math.max(voiceLevel, post);
      }

      // auto-ducking: music/sfx dip under voice
      for (const ch of channels) {
        const duckable = ch.role !== 'voice' && master.duckOn;
        const base = ch._audible;
        let g = base;
        if (duckable && voiceLevel > master.duckThresh) g = base * master.duckAmt;
        ch.n.duck.gain.setTargetAtTime(g, ctx.currentTime, 0.08);
      }

      // master spectrum + peak/clip meter
      drawSpectrum(spec);
      updateMasterMeter();
      engineRAF = requestAnimationFrame(tick);
    };
    master.duckOn = true;
    master.duckAmt = 0.28;
    master.duckThresh = 0.03;
    engineRAF = requestAnimationFrame(tick);
  }

  function updateMasterMeter() {
    const fill = q('#masterMeter');
    if (!fill) return;
    master.analyser.getFloatTimeDomainData(master.peakBuf);
    let peak = 0, sum = 0;
    for (let i = 0; i < master.peakBuf.length; i++) { const s = master.peakBuf[i]; peak = Math.max(peak, Math.abs(s)); sum += s * s; }
    const v = Math.min(1, Math.max(0, (20 * Math.log10(peak + 1e-6) + 60) / 60));
    fill.style.width = `${Math.round(v * 100)}%`;
    // Rolling loudness estimate (approx LUFS: -0.691 + 10·log10(mean square)).
    const ms = sum / master.peakBuf.length;
    master.msEMA = master.msEMA == null ? ms : master.msEMA * 0.95 + ms * 0.05;
    master.lufs = -0.691 + 10 * Math.log10(master.msEMA + 1e-9);
    const loud = q('#masterLoud');
    if (loud) loud.textContent = master.lufs < -70 ? '−∞ LUFS' : `${master.lufs.toFixed(1)} LUFS`;
    const clip = q('#masterClip');
    if (clip) {
      if (peak >= 0.99) { clip.classList.add('lit'); master._clipAt = performance.now(); }
      else if (master._clipAt && performance.now() - master._clipAt > 1500) clip.classList.remove('lit');
    }
  }

  function drawSpectrum(buf) {
    const cv = q('#specCanvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    master.analyser.getByteFrequencyData(buf);
    g.clearRect(0, 0, w, h);
    const bars = 48;
    const step = Math.floor(buf.length / bars);
    for (let i = 0; i < bars; i++) {
      let m = 0;
      for (let j = 0; j < step; j++) m = Math.max(m, buf[i * step + j]);
      const bh = (m / 255) * h;
      const x = (i / bars) * w;
      const bw = w / bars - 2;
      const hue = 45 - (m / 255) * 45; // gold→red as it gets hot
      g.fillStyle = `hsl(${hue}, 80%, ${40 + (m / 255) * 20}%)`;
      g.fillRect(x, h - bh, bw, bh);
    }
  }

  // ---- Recording --------------------------------------------------------
  function toggleRecord() {
    audio();
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    recChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    recorder = new MediaRecorder(master.recDest.stream, { mimeType: mime });
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(recChunks, { type: mime });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const fmtSz = (b) => (b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
      const a = q('#recDownload');
      a.href = URL.createObjectURL(blob);
      a.download = `gaanasudha-mix-${stamp}.webm`;
      a.style.display = '';
      a.textContent = `⬇ WebM (${fmtSz(blob.size)})`;
      // Also offer an interchange-friendly WAV (decode → PCM WAV).
      const wa = q('#recWav');
      try {
        const abuf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const wav = encodeWAV(abuf);
        wa.href = URL.createObjectURL(wav);
        wa.download = `gaanasudha-mix-${stamp}.wav`;
        wa.style.display = '';
        wa.textContent = `⬇ WAV (${fmtSz(wav.size)})`;
      } catch (_) { wa.style.display = 'none'; }
      reflectRecord();
    };
    recorder.start();
    reflectRecord();
  }
  function reflectRecord() {
    const b = q('#recBtn');
    const on = recorder && recorder.state === 'recording';
    b.textContent = on ? '⏹ Stop' : '⏺ Record';
    b.classList.toggle('rec-live', on);
  }

  // small toast (independent of app.js)
  function toast(msg) {
    let t = q('#studioToast');
    if (!t) { t = document.createElement('div'); t.id = 'studioToast'; t.className = 'studio-toast'; panel.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---- Loudness normalize (Auphonic-style) + Auto-master (LANDR-style) --
  function normalizeLoudness(target, quiet) {
    audio();
    if (master.lufs == null || master.lufs < -70) { if (!quiet) toast('Play audio first to measure loudness'); return; }
    const delta = target - master.lufs;
    const g = Math.min(4, Math.max(0.05, master.gain.gain.value * 10 ** (delta / 20)));
    master.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.25);
    q('#masterFader').value = g.toFixed(2);
    if (!quiet) toast(`Normalizing toward ${target} LUFS`);
  }

  function autoMaster() {
    audio();
    // Tonal-balance master EQ (gentle: warm lows, tamed mud, airy highs).
    master.mEqLow.gain.value = 1.5; master.mEqMid.gain.value = -1; master.mEqHigh.gain.value = 2;
    ['#mEqLow', '#mEqMid', '#mEqHigh'].forEach((s, i) => q(s) && (q(s).value = [1.5, -1, 2][i]));
    q('#limChk').checked = true; setLimiter(true);
    normalizeLoudness(Number(q('#loudTarget').value), true);
    toast('✨ Auto-master applied');
  }

  // ---- Voice enhance preset --------------------------------------------
  function voiceEnhance(ch) {
    ch.role = 'voice';
    ch.denoise = true; ch.comp = true; ch.deEss = true;
    setComp(ch.n.comp, true);
    ch.n.hpf.frequency.value = 95;
    ch.n.eqLow.gain.value = -2;
    ch.n.eqMid.gain.value = 2.5; ch.n.eqMid.frequency.value = 3000;
    ch.n.eqHigh.gain.value = 3;
    renderChannels();
  }

  // ---- Scenes: save / recall / delete full-mix snapshots (localStorage) ----
  const SCENE_KEY = 'gaanasudha.studio.scenes';
  const loadScenes = () => { try { return JSON.parse(localStorage.getItem(SCENE_KEY)) || {}; } catch { return {}; } };
  const storeScenes = (o) => { try { localStorage.setItem(SCENE_KEY, JSON.stringify(o)); } catch (_) {} };

  function captureScene() {
    return {
      master: {
        gain: master.gain.gain.value, limiter: q('#limChk').checked,
        reverbType: master.reverbType, reverbReturn: master.reverbReturn.gain.value,
        mEq: [master.mEqLow.gain.value, master.mEqMid.gain.value, master.mEqHigh.gain.value],
        duckOn: master.duckOn, duckThresh: master.duckThresh, duckAmt: master.duckAmt,
        delayTime: master.delay.delayTime.value, delayFb: master.delayFb.gain.value,
        mains: master.mains,
      },
      channels: channels.map((ch) => ({
        type: ch.type, libId: ch.libId || null, name: ch.name, role: ch.role,
        eq: [ch.n.eqLow.gain.value, ch.n.eqMid.gain.value, ch.n.eqHigh.gain.value],
        denoise: ch.denoise, comp: ch.comp, deEss: ch.deEss, autoLevel: ch.autoLevel, hum: ch.hum,
        fader: ch.n.fader.gain.value, pan: ch.n.pan ? ch.n.pan.pan.value : 0,
        revSend: ch.n.revSend.gain.value, delaySend: ch.n.delaySend.gain.value, mute: ch.mute,
      })),
    };
  }

  function applyChannelSettings(ch, s) {
    ch.role = s.role; ch.name = s.name;
    ch.denoise = s.denoise; ch.comp = s.comp; ch.deEss = s.deEss; ch.autoLevel = s.autoLevel; ch.mute = s.mute;
    ch.hum = s.hum || false;
    ch.n.eqLow.gain.value = s.eq[0]; ch.n.eqMid.gain.value = s.eq[1]; ch.n.eqHigh.gain.value = s.eq[2];
    ch.n.fader.gain.value = s.fader; if (ch.n.pan) ch.n.pan.pan.value = s.pan;
    ch.n.revSend.gain.value = s.revSend; ch.n.delaySend.gain.value = s.delaySend || 0;
    setComp(ch.n.comp, ch.comp); ch.n.hpf.frequency.value = ch.denoise ? 95 : 25; setHum(ch, ch.hum);
  }

  function applyScene(scene) {
    const m = scene.master;
    master.gain.gain.value = m.gain; q('#masterFader').value = m.gain;
    q('#limChk').checked = m.limiter; setLimiter(m.limiter);
    setReverbType(m.reverbType); q('#revType').value = m.reverbType;
    if (m.reverbType !== 'Off') master.reverbReturn.gain.value = m.reverbReturn;
    q('#revReturn').value = m.reverbReturn;
    master.mEqLow.gain.value = m.mEq[0]; master.mEqMid.gain.value = m.mEq[1]; master.mEqHigh.gain.value = m.mEq[2];
    ['#mEqLow', '#mEqMid', '#mEqHigh'].forEach((s, i) => q(s) && (q(s).value = m.mEq[i]));
    master.duckOn = m.duckOn; q('#duckChk').checked = m.duckOn;
    master.duckThresh = m.duckThresh; q('#duckThresh').value = m.duckThresh;
    master.duckAmt = m.duckAmt; q('#duckAmt').value = m.duckAmt;
    master.delay.delayTime.value = m.delayTime; q('#delayTime') && (q('#delayTime').value = m.delayTime);
    master.delayFb.gain.value = m.delayFb; q('#delayFb') && (q('#delayFb').value = m.delayFb);
    master.mains = m.mains || 50; q('#mainsSel') && (q('#mainsSel').value = master.mains);
    channels.slice().forEach((ch) => removeChannel(ch.id));
    let skipped = 0;
    for (const s of scene.channels) {
      if (s.libId) applyChannelSettings(addLibrary(s.libId, s.name, true), s);
      else skipped++;
    }
    renderChannels();
    toast(skipped ? `Scene recalled. Re-add ${skipped} mic/uploaded channel(s).` : 'Scene recalled');
  }

  function refreshSceneSelect(sel) {
    const names = Object.keys(loadScenes());
    q('#sceneSel').innerHTML = '<option value="">— recall scene —</option>' +
      names.map((n) => `<option${n === sel ? ' selected' : ''}>${n.replace(/</g, '&lt;')}</option>`).join('');
  }

  // ======================================================================
  //  UI
  // ======================================================================
  panel.innerHTML = `
    <div class="studio-toolbar">
      <button class="gold" id="addMicBtn">🎙 Add mic</button>
      <button class="ghost" id="addFileBtn">🎵 Add track</button>
      <button class="ghost" id="addLibBtn">📚 From library</button>
      <input type="file" id="fileInput" accept="audio/*" multiple hidden />
      <span class="sp"></span>
      <button class="ghost tiny" id="playAllBtn">▶ Play all</button>
      <button class="ghost tiny" id="stopAllBtn">⏹ Stop all</button>
      <span class="sp"></span>
      <label class="duck-toggle"><input type="checkbox" id="duckChk" checked /> Auto-duck</label>
      <label class="duck-toggle">Thresh <input type="range" id="duckThresh" min="0.005" max="0.15" step="0.005" value="0.03" /></label>
      <label class="duck-toggle">Amount <input type="range" id="duckAmt" min="0" max="1" step="0.02" value="0.28" /></label>
      <span class="sp"></span>
      <select id="sceneSel" title="Recall a saved scene"><option value="">— recall scene —</option></select>
      <button class="ghost tiny" id="sceneSave">💾 Save scene</button>
      <button class="ghost tiny" id="sceneDel" title="Delete selected scene">🗑</button>
      <span class="sp"></span>
      <button class="ghost" id="recBtn">⏺ Record</button>
      <a class="ghost tiny" id="recDownload" style="display:none">⬇ WebM</a>
      <a class="ghost tiny" id="recWav" style="display:none">⬇ WAV</a>
    </div>
    <div class="studio-body">
      <div class="channels" id="channels"></div>
      <div class="master-strip">
        <div class="ms-title">MASTER</div>
        <canvas id="specCanvas" width="150" height="90" class="spec"></canvas>
        <div class="master-meter-row">
          <div class="master-meter"><div class="master-meter-fill" id="masterMeter"></div></div>
          <span class="clip-led" id="masterClip" title="Clip">CLIP</span>
        </div>
        <div class="ms-loud"><span class="muted">Loudness</span> <b id="masterLoud">−∞ LUFS</b></div>
        <label class="ms-field">Target
          <select id="loudTarget">
            <option value="-14" selected>−14 (streaming)</option>
            <option value="-16">−16</option>
            <option value="-23">−23 (broadcast)</option>
          </select>
        </label>
        <div class="row" style="gap:6px">
          <button class="ghost tiny" id="normalizeBtn" style="flex:1">📏 Normalize</button>
          <button class="gold tiny" id="autoMasterBtn" style="flex:1">✨ Auto-master</button>
        </div>
        <label class="ms-field">Mains hum
          <select id="mainsSel"><option value="50" selected>50 Hz</option><option value="60">60 Hz</option></select>
        </label>
        <div class="ms-eq">
          <label class="knob"><span>LO</span><input type="range" id="mEqLow" min="-12" max="12" step="0.5" value="0" /></label>
          <label class="knob"><span>MID</span><input type="range" id="mEqMid" min="-12" max="12" step="0.5" value="0" /></label>
          <label class="knob"><span>HI</span><input type="range" id="mEqHigh" min="-12" max="12" step="0.5" value="0" /></label>
        </div>
        <label class="ms-field">Limiter <input type="checkbox" id="limChk" checked /></label>
        <label class="ms-field">Delay time <input type="range" id="delayTime" min="0.05" max="1" step="0.01" value="0.28" /></label>
        <label class="ms-field">Delay fb <input type="range" id="delayFb" min="0" max="0.8" step="0.02" value="0.3" /></label>
        <label class="ms-field">Reverb type
          <select id="revType"><option>Off</option><option>Room</option><option selected>Hall</option><option>Plate</option></select>
        </label>
        <label class="ms-field">Reverb <input type="range" id="revReturn" min="0" max="1" step="0.01" value="0.9" /></label>
        <label class="ms-field">Master <input type="range" id="masterFader" min="0" max="1.2" step="0.01" value="0.9" /></label>
      </div>
    </div>
    <p class="studio-hint muted">Tip: add a mic for voice-over and a track for music, hit <b>✨ Voice enhance</b> on the mic, and music auto-dips under your voice. Press <b>⏺ Record</b> to capture the mix.</p>
  `;

  function channelHTML(ch) {
    const roleOpts = ['voice', 'music', 'sfx'].map((r) => `<option value="${r}"${ch.role === r ? ' selected' : ''}>${r}</option>`).join('');
    const knob = (id, label, val) => `<label class="knob"><span>${label}</span><input type="range" data-k="${id}" min="-12" max="12" step="0.5" value="${val}" /></label>`;
    return `<div class="strip" data-id="${ch.id}">
      <input class="ch-name" value="${ch.name.replace(/"/g, '&quot;')}" />
      <div class="ch-sub">
        <span class="tag ${ch.type}">${ch.type === 'mic' ? '🎙' : '🎵'}</span>
        <select class="ch-role" title="Role (for ducking)">${roleOpts}</select>
      </div>
      ${ch.type === 'file' ? `<div class="ch-transport"><button class="ghost tiny ch-play">▶</button></div>` : ''}
      <div class="eq3">${knob('low', 'LO', ch.n.eqLow.gain.value)}${knob('mid', 'MID', ch.n.eqMid.gain.value)}${knob('high', 'HI', ch.n.eqHigh.gain.value)}</div>
      <div class="fx-row">
        <button class="fx ${ch.denoise ? 'on' : ''}" data-fx="denoise" title="Noise reduction (gate + HPF)">NR</button>
        <button class="fx ${ch.comp ? 'on' : ''}" data-fx="comp" title="Compressor">CMP</button>
        <button class="fx ${ch.deEss ? 'on' : ''}" data-fx="deEss" title="De-esser">DS</button>
        <button class="fx ${ch.autoLevel ? 'on' : ''}" data-fx="autoLevel" title="Auto-level (AGC)">AUTO</button>
        <button class="fx ${ch.hum ? 'on' : ''}" data-fx="hum" title="De-hum (mains 50/60 Hz notch)">HUM</button>
        <button class="fx ${ch.snr ? 'on' : ''}" data-fx="snr" title="Spectral noise reduction (learn-noise)">SNR</button>
      </div>
      <div class="snr-row">
        <button class="ghost tiny enhance" title="Voice enhance preset">✨ Voice</button>
        <button class="ghost tiny snr-learn" title="Learn the room/background noise (play noise only, then click)">🎧 Learn</button>
      </div>
      <label class="mini">Rev <input type="range" class="rev" min="0" max="1" step="0.01" value="${ch.n.revSend.gain.value}" /></label>
      <label class="mini">Dly <input type="range" class="dly" min="0" max="1" step="0.01" value="${ch.n.delaySend.gain.value}" /></label>
      <label class="mini">Pan <input type="range" class="pan" min="-1" max="1" step="0.05" value="${ch.n.pan ? ch.n.pan.pan.value : 0}" /></label>
      <div class="fader-wrap">
        <div class="meter"><div class="meter-fill"></div></div>
        <input type="range" class="fader" min="0" max="1.2" step="0.01" value="${ch.n.fader.gain.value}" />
      </div>
      <div class="ch-btns">
        <button class="ms-btn mute ${ch.mute ? 'on' : ''}">M</button>
        <button class="ms-btn solo ${ch.solo ? 'on' : ''}">S</button>
        <button class="ms-btn del" title="Remove">✕</button>
      </div>
    </div>`;
  }

  function renderChannels() {
    const wrap = q('#channels');
    if (!channels.length) {
      wrap.innerHTML = `<div class="empty">No channels yet. Add a mic or a track to start mixing.</div>`;
      return;
    }
    wrap.innerHTML = channels.map(channelHTML).join('');
    for (const ch of channels) {
      const el = wrap.querySelector(`.strip[data-id="${ch.id}"]`);
      ch.meterFill = el.querySelector('.meter-fill');
      el.querySelector('.ch-name').addEventListener('input', (e) => (ch.name = e.target.value));
      el.querySelector('.ch-role').addEventListener('change', (e) => (ch.role = e.target.value));
      el.querySelectorAll('.eq3 input').forEach((inp) =>
        inp.addEventListener('input', (e) => {
          const map = { low: ch.n.eqLow, mid: ch.n.eqMid, high: ch.n.eqHigh };
          map[e.target.dataset.k].gain.value = Number(e.target.value);
        }),
      );
      el.querySelectorAll('.fx').forEach((b) =>
        b.addEventListener('click', () => {
          const fx = b.dataset.fx;
          ch[fx] = !ch[fx];
          b.classList.toggle('on', ch[fx]);
          if (fx === 'comp') setComp(ch.n.comp, ch.comp);
          if (fx === 'denoise') ch.n.hpf.frequency.value = ch.denoise ? 95 : 25;
          if (fx === 'deEss' && !ch.deEss) ch.n.deEss.gain.value = 0;
          if (fx === 'hum') setHum(ch, ch.hum);
          if (fx === 'snr') applySNR(ch);
        }),
      );
      el.querySelector('.enhance').addEventListener('click', () => voiceEnhance(ch));
      el.querySelector('.snr-learn').addEventListener('click', () => learnNoise(ch));
      el.querySelector('.rev').addEventListener('input', (e) => (ch.n.revSend.gain.value = Number(e.target.value)));
      el.querySelector('.dly').addEventListener('input', (e) => (ch.n.delaySend.gain.value = Number(e.target.value)));
      el.querySelector('.pan').addEventListener('input', (e) => { if (ch.n.pan) ch.n.pan.pan.value = Number(e.target.value); });
      el.querySelector('.fader').addEventListener('input', (e) => (ch.n.fader.gain.value = Number(e.target.value)));
      el.querySelector('.mute').addEventListener('click', (e) => { ch.mute = !ch.mute; e.target.classList.toggle('on', ch.mute); });
      el.querySelector('.solo').addEventListener('click', (e) => { ch.solo = !ch.solo; e.target.classList.toggle('on', ch.solo); });
      el.querySelector('.del').addEventListener('click', () => removeChannel(ch.id));
      const play = el.querySelector('.ch-play');
      if (play) {
        play.addEventListener('click', () => {
          if (ch.mediaEl.paused) { ctx.resume(); ch.mediaEl.play(); play.textContent = '⏸'; }
          else { ch.mediaEl.pause(); play.textContent = '▶'; }
        });
        ch.mediaEl.addEventListener('ended', () => (play.textContent = '▶'));
      }
    }
  }

  // ---- wire toolbar ----
  q('#addMicBtn').addEventListener('click', addMic);
  q('#addFileBtn').addEventListener('click', () => q('#fileInput').click());
  q('#fileInput').addEventListener('change', (e) => {
    [...e.target.files].forEach(addFile);
    e.target.value = '';
  });
  q('#addLibBtn').addEventListener('click', openLibraryPicker);
  q('#playAllBtn').addEventListener('click', playAll);
  q('#stopAllBtn').addEventListener('click', stopAllPlay);
  q('#duckChk').addEventListener('change', (e) => { audio(); master.duckOn = e.target.checked; });
  q('#duckThresh').addEventListener('input', (e) => { audio(); master.duckThresh = Number(e.target.value); });
  q('#duckAmt').addEventListener('input', (e) => { audio(); master.duckAmt = Number(e.target.value); });
  q('#recBtn').addEventListener('click', toggleRecord);
  q('#limChk').addEventListener('change', (e) => { audio(); setLimiter(e.target.checked); });
  q('#revType').addEventListener('change', (e) => { audio(); setReverbType(e.target.value); });
  q('#revReturn').addEventListener('input', (e) => { audio(); if (master.reverbType !== 'Off') master.reverbReturn.gain.value = Number(e.target.value); });
  q('#masterFader').addEventListener('input', (e) => { audio(); master.gain.gain.value = Number(e.target.value); });
  q('#mEqLow').addEventListener('input', (e) => { audio(); master.mEqLow.gain.value = Number(e.target.value); });
  q('#mEqMid').addEventListener('input', (e) => { audio(); master.mEqMid.gain.value = Number(e.target.value); });
  q('#mEqHigh').addEventListener('input', (e) => { audio(); master.mEqHigh.gain.value = Number(e.target.value); });
  q('#delayTime').addEventListener('input', (e) => { audio(); master.delay.delayTime.value = Number(e.target.value); });
  q('#delayFb').addEventListener('input', (e) => { audio(); master.delayFb.gain.value = Number(e.target.value); });
  q('#normalizeBtn').addEventListener('click', () => normalizeLoudness(Number(q('#loudTarget').value)));
  q('#autoMasterBtn').addEventListener('click', autoMaster);
  q('#mainsSel').addEventListener('change', (e) => {
    audio(); master.mains = Number(e.target.value);
    channels.forEach((ch) => ch.hum && setHum(ch, true)); // re-tune active de-hum
  });

  // Scenes
  q('#sceneSel').addEventListener('change', (e) => { if (e.target.value) applyScene(loadScenes()[e.target.value]); });
  q('#sceneSave').addEventListener('click', () => {
    audio();
    const name = (prompt('Scene name:', `Scene ${Object.keys(loadScenes()).length + 1}`) || '').trim();
    if (!name) return;
    const scenes = loadScenes(); scenes[name] = captureScene(); storeScenes(scenes);
    refreshSceneSelect(name); toast(`Saved scene “${name}”`);
  });
  q('#sceneDel').addEventListener('click', () => {
    const sel = q('#sceneSel').value; if (!sel) return;
    const scenes = loadScenes(); delete scenes[sel]; storeScenes(scenes); refreshSceneSelect();
  });
  refreshSceneSelect();

  // Keyboard shortcuts (only while the Studio view is active, not while typing)
  document.addEventListener('keydown', (e) => {
    const view = document.getElementById('view-studio');
    if (!view || !view.classList.contains('active')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      channels.some((ch) => ch.mediaEl && !ch.mediaEl.paused) ? stopAllPlay() : playAll();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault(); toggleRecord();
    }
  });

  renderChannels();

  window.Studio = {
    stopAll() {
      channels.slice().forEach((ch) => removeChannel(ch.id));
      if (recorder && recorder.state === 'recording') recorder.stop();
    },
  };
})();
