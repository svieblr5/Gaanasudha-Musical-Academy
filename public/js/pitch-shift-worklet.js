/* ==========================================================================
 *  Real-time pitch shifter (transpose) — AudioWorklet processor.
 *
 *  Classic time-domain granular shifter: two read taps sweep a delay line at a
 *  ramping offset, each windowed with a triangular envelope and offset by half
 *  a window. Triangular windows offset by half sum to unity, so the two grains
 *  crossfade smoothly and the wrap-around discontinuity is masked — pitch is
 *  shifted while tempo (output rate) is unchanged.
 *
 *  `ratio` = output pitch / input pitch = 2^(semitones/12).
 *  ratio === 1 bypasses cleanly (no comb artifacts at 0 semitones).
 * ========================================================================== */
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.N = 2048; // grain / window size in samples
    this.bufLen = 4096; // power of two, >= 2*N (mask-based wrap)
    this.mask = this.bufLen - 1;
    this.chans = []; // one circular buffer per channel
    this.writeIdx = 0;
    this.delay = 0; // ramping delay, shared across channels
  }

  ensure(n) {
    while (this.chans.length < n) this.chans.push(new Float32Array(this.bufLen));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const nin = input.length;
    const nout = output.length;
    this.ensure(nin);

    const { N, mask } = this;
    const half = N / 2;
    const ratio = currentRatio(arguments[2]);
    const len = output[0].length;

    // --- Bypass when there is effectively no shift ---
    if (Math.abs(ratio - 1) < 1e-4) {
      let w = this.writeIdx;
      for (let i = 0; i < len; i++) {
        for (let c = 0; c < nin; c++) this.chans[c][w] = input[c][i];
        for (let c = 0; c < nout; c++) output[c][i] = input[Math.min(c, nin - 1)][i];
        w = (w + 1) & mask;
      }
      this.writeIdx = w;
      this.delay = 0;
      return true;
    }

    const slope = 1 - ratio; // delay increment per output sample
    let writeIdx = this.writeIdx;
    let delay = this.delay;

    for (let i = 0; i < len; i++) {
      // Write the incoming sample for every input channel.
      for (let c = 0; c < nin; c++) this.chans[c][writeIdx] = input[c][i];

      // Advance and wrap the delay ramp into [0, N).
      delay += slope;
      if (delay >= N) delay -= N;
      else if (delay < 0) delay += N;

      for (let c = 0; c < nout; c++) {
        const buf = this.chans[Math.min(c, nin - 1)];
        let sample = 0;
        for (let tap = 0; tap < 2; tap++) {
          let dd = delay + tap * half;
          if (dd >= N) dd -= N;
          // Triangular window: 0 at dd=0 and dd=N, peak at dd=N/2.
          const win = 1 - Math.abs((2 * dd) / N - 1);
          // Fractional read position behind the write pointer (linear interp).
          const readPos = writeIdx - dd;
          const ri = Math.floor(readPos);
          const frac = readPos - ri;
          const s0 = buf[ri & mask];
          const s1 = buf[(ri + 1) & mask];
          sample += win * (s0 + frac * (s1 - s0));
        }
        output[c][i] = sample;
      }

      writeIdx = (writeIdx + 1) & mask;
    }

    this.writeIdx = writeIdx;
    this.delay = delay;
    return true;
  }
}

// k-rate parameter arrives as a length-1 Float32Array.
function currentRatio(params) {
  const r = params && params.ratio;
  return r && r.length ? r[0] : 1;
}

registerProcessor('pitch-shift', PitchShiftProcessor);
