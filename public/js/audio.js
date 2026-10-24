// Sons générés à la volée avec la Web Audio API : aucun fichier audio à télécharger.
export class Sound {
  constructor() { this.ctx = null; this.volume = 0.7; this.crowdLevel = 0.3; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
    // Bruit de foule : bruit rose filtré en continu.
    const len = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2) * 0.4; }
    }
    this.noise = buf;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    this.crowdGain = this.ctx.createGain(); this.crowdGain.gain.value = 0;
    src.connect(bp).connect(this.crowdGain).connect(this.master); src.start();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setCrowd(level) {
    if (!this.ctx) return;
    this.crowdLevel += (level - this.crowdLevel) * 0.03;
    this.crowdGain.gain.setTargetAtTime(0.12 + this.crowdLevel * 0.35, this.ctx.currentTime, 0.2);
  }

  kick(power = 15) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150 + power * 3, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(Math.min(1, 0.25 + power / 40), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.16);
    this.burst(0.05, 2500, 0.25);
  }

  burst(dur, freq, vol, q = 1) {
    const t = this.ctx.currentTime, src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
  }

  whistle(n = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.45, len = n === 3 && i === 2 ? 0.9 : 0.32;
      const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(), g = this.ctx.createGain();
      o.frequency.value = 2900; lfo.frequency.value = 38; lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.setValueAtTime(0.18, t + len - 0.05); g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(g).connect(this.master); o.start(t); lfo.start(t); o.stop(t + len); lfo.stop(t + len);
    }
  }

  cheer() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.1, t + 0.4); g.gain.exponentialRampToValueAtTime(0.01, t + 4.5);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 4.6);
  }

  ooh() { if (this.ctx) this.burst(1.4, 500, 0.6, 0.8); }
  post() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const fr of [820, 1230, 1840]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = fr;
      g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.7);
    }
    this.ooh();
  }
  thud() { if (this.ctx) this.burst(0.12, 300, 0.4); }
  click() { if (this.ctx) this.burst(0.03, 3000, 0.15, 3); }

  handle(events) {
    for (const e of events) {
      if (e.t === 'kick') { this.kick(e.v); if (e.shot) this.setCrowd(1); }
      else if (e.t === 'whistle') this.whistle(e.n);
      else if (e.t === 'goal') { this.cheer(); this.whistle(1); }
      else if (e.t === 'post') this.post();
      else if (e.t === 'save') this.ooh();
      else if (e.t === 'tackle') this.thud();
      else if (e.t === 'bounce' && e.v > 3) this.kick(e.v * 0.5);
    }
  }
}
