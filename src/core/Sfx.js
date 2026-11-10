/**
 * Efectos de sonido 100 % procedurales con WebAudio (sin archivos de audio).
 * El AudioContext se crea en el primer gesto del usuario (política de autoplay de Chrome).
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this._noise = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    // buffer de ruido blanco reutilizable
    const len = this.ctx.sampleRate * 1.5;
    this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---------------------------------------------------------------- primitivas
  _env(gainNode, t, a, peak, d) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _noiseBurst({ dur = 0.15, freq = 1200, q = 0.8, type = 'lowpass', gain = 0.5, sweepTo = null, pan = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, 0.003, gain, dur);
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; src.connect(f).connect(g).connect(p).connect(this.master); }
    else src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  _tone({ freq = 440, to = null, dur = 0.12, type = 'sine', gain = 0.3, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, 0.004, gain, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- sonidos del juego
  shot(kind = 'm16') {
    if (kind === 'colt') {
      // revólver: chasquido seco + cuerpo grave + cola larga que rebota en el cañón
      this._noiseBurst({ dur: 0.09, freq: 5200, sweepTo: 900, gain: 0.7 });
      this._tone({ freq: 140, to: 38, dur: 0.28, type: 'triangle', gain: 0.75 });
      this._noiseBurst({ dur: 0.9, freq: 700, sweepTo: 120, gain: 0.16 });
      return;
    }
    const heavy = kind === 'ak';
    this._noiseBurst({ dur: heavy ? 0.22 : 0.13, freq: heavy ? 2600 : 3800, sweepTo: 300, gain: heavy ? 0.75 : 0.5 });
    this._tone({ freq: heavy ? 120 : 170, to: 45, dur: heavy ? 0.18 : 0.1, type: 'triangle', gain: heavy ? 0.6 : 0.4 });
  }
  ricochet() {
    const f = 2400 + Math.random() * 1800;
    this._tone({ freq: f, to: f * 0.45, dur: 0.32, type: 'sine', gain: 0.09, delay: 0.03 });
  }
  spur() { [3200, 4100].forEach((f, i) => this._tone({ freq: f, dur: 0.09, type: 'sine', gain: 0.035, delay: i * 0.05 })); }
  dryFire() { this._tone({ freq: 1800, dur: 0.03, type: 'square', gain: 0.08 }); }
  reload() {
    this._noiseBurst({ dur: 0.05, freq: 3000, type: 'bandpass', q: 4, gain: 0.25 });
    setTimeout(() => this._noiseBurst({ dur: 0.07, freq: 1800, type: 'bandpass', q: 5, gain: 0.3 }), 380);
    setTimeout(() => this._tone({ freq: 900, to: 1400, dur: 0.06, type: 'square', gain: 0.07 }), 900);
  }
  hit(crit = false) { this._tone({ freq: crit ? 1900 : 1300, to: crit ? 2600 : 1100, dur: 0.05, type: 'square', gain: crit ? 0.12 : 0.07 }); }
  kill() {
    this._tone({ freq: 660, dur: 0.06, type: 'square', gain: 0.08 });
    this._tone({ freq: 990, dur: 0.09, type: 'square', gain: 0.08, delay: 0.06 });
  }
  explosion(big = false) {
    this._noiseBurst({ dur: big ? 1.1 : 0.55, freq: big ? 900 : 1400, sweepTo: 60, gain: big ? 0.95 : 0.6 });
    this._tone({ freq: big ? 70 : 95, to: 30, dur: big ? 0.9 : 0.4, type: 'sine', gain: big ? 0.9 : 0.6 });
  }
  enemyShot(pan = 0) { this._tone({ freq: 520, to: 180, dur: 0.14, type: 'sawtooth', gain: 0.08 }); this._noiseBurst({ dur: 0.06, freq: 2000, type: 'bandpass', gain: 0.1, pan }); }
  hurt() { this._noiseBurst({ dur: 0.18, freq: 500, sweepTo: 120, gain: 0.5 }); this._tone({ freq: 200, to: 90, dur: 0.15, type: 'square', gain: 0.12 }); }
  pickup() { [660, 880, 1320].forEach((f, i) => this._tone({ freq: f, dur: 0.12, type: 'triangle', gain: 0.18, delay: i * 0.07 })); }
  spawn() { this._tone({ freq: 140, to: 620, dur: 0.45, type: 'sawtooth', gain: 0.05 }); }
  ui() { this.spur(); }
  uiConfirm() { this._tone({ freq: 700, to: 1400, dur: 0.12, type: 'triangle', gain: 0.12 }); }
  waveStart() { [0, 0.55].forEach((d) => { this._tone({ freq: 392, dur: 1.4, type: 'sine', gain: 0.22, delay: d }); this._tone({ freq: 784 * 1.01, dur: 0.9, type: 'sine', gain: 0.06, delay: d }); }); } // campana de la iglesia
  waveClear() { [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, dur: 0.25, type: 'triangle', gain: 0.14, delay: i * 0.09 })); }
  tick() { this._tone({ freq: 1000, dur: 0.05, type: 'sine', gain: 0.12 }); }
  step(heavy = false) { this._noiseBurst({ dur: heavy ? 0.25 : 0.06, freq: heavy ? 180 : 600, gain: heavy ? 0.5 : 0.05 }); }
}
