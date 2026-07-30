/* ==========================================================================
 *  Spectral-subtraction denoiser — AudioWorklet processor.
 *
 *  STFT (Hann, fftSize 1024, hop 128 = 8x overlap) → per-bin spectral
 *  subtraction against a *learned* noise profile → overlap-add ISTFT.
 *  Workflow: enable it, let a second of room-tone / noise-only play, hit
 *  "Learn noise" (accumulates the noise magnitude spectrum), then it subtracts
 *  that profile from every subsequent frame — cleaning hiss/hum/room while
 *  keeping the voice. A spectral floor limits "musical noise" artifacts.
 *
 *  Includes its own radix-2 FFT (AudioWorklets have no built-in FFT).
 *  Latency ≈ fftSize samples (~23 ms @ 44.1 kHz). Bypasses to a straight copy
 *  when disabled or before a profile is learned, so it's unity-safe.
 * ========================================================================== */
const N = 1024;
const HOP = 128;
const HALF = N / 2;

// In-place iterative radix-2 FFT (inverse divides by N).
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.win = new Float32Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));
    // Constant-overlap-add normalization for Hann analysis+synthesis at this hop.
    let s = 0;
    for (let k = -N / HOP; k <= N / HOP; k++) {
      const idx = HALF - k * HOP;
      if (idx >= 0 && idx < N) s += this.win[idx] * this.win[idx];
    }
    this.norm = s || 3.0;

    this.enabled = false;
    this.learning = false;
    this.learnTarget = 0;
    this.learnCount = 0;
    this.hasProfile = false;
    this.alpha = 1.8; // over-subtraction factor
    this.floor = 0.06; // spectral floor (limits musical noise)
    this.ch = [];

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'enabled') this.enabled = !!d.value;
      else if (d.type === 'amount') this.alpha = d.value;
      else if (d.type === 'learn') {
        this.learning = true;
        this.learnCount = 0;
        this.learnTarget = d.frames || 60;
        this.ch.forEach((c) => c && c.noise.fill(0));
      } else if (d.type === 'reset') {
        this.hasProfile = false;
        this.ch.forEach((c) => c && c.noise.fill(0));
      }
    };
  }

  ensureCh(i) {
    if (this.ch[i]) return this.ch[i];
    const c = {
      ana: new Float32Array(N), acc: new Float32Array(N),
      noise: new Float32Array(HALF + 1), re: new Float32Array(N), im: new Float32Array(N),
    };
    this.ch[i] = c;
    return c;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const nch = input.length;

    for (let ci = 0; ci < nch; ci++) {
      const inp = input[ci];
      const out = output[ci];
      if (!this.enabled) { out.set(inp); continue; }
      const c = this.ensureCh(ci);

      c.ana.copyWithin(0, HOP);
      c.ana.set(inp, N - HOP);
      for (let i = 0; i < N; i++) { c.re[i] = c.ana[i] * this.win[i]; c.im[i] = 0; }
      fft(c.re, c.im, false);

      if (this.learning) {
        for (let k = 0; k <= HALF; k++) c.noise[k] += Math.hypot(c.re[k], c.im[k]);
      } else if (this.hasProfile) {
        for (let k = 0; k <= HALF; k++) {
          const mag = Math.hypot(c.re[k], c.im[k]) + 1e-9;
          let g = 1 - (this.alpha * c.noise[k]) / mag;
          if (g < this.floor) g = this.floor;
          c.re[k] *= g; c.im[k] *= g;
          if (k > 0 && k < HALF) { const m = N - k; c.re[m] *= g; c.im[m] *= g; }
        }
      }

      fft(c.re, c.im, true);
      for (let i = 0; i < N; i++) c.acc[i] += (c.re[i] * this.win[i]) / this.norm;
      for (let i = 0; i < HOP; i++) out[i] = c.acc[i];
      c.acc.copyWithin(0, HOP);
      c.acc.fill(0, N - HOP);
    }

    if (this.learning) {
      this.learnCount++;
      if (this.learnCount >= this.learnTarget) {
        this.learning = false;
        this.hasProfile = true;
        for (const c of this.ch) if (c) for (let k = 0; k <= HALF; k++) c.noise[k] /= this.learnCount;
        this.port.postMessage({ type: 'learned' });
      }
    }
    return true;
  }
}

registerProcessor('spectral-denoise', DenoiseProcessor);
