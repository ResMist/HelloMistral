// audio.js — fully procedural WebAudio sound (no asset files)

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.chase = false;
    this._beat = 0;
    this._padT = 0;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  tone(freq, dur, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + opts.slide), t + dur);
    const peak = opts.gain || 0.15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  burst(dur, gain, freq, q = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t);
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'step': this.burst(0.07, 0.10, 300, 0.8); break;
      case 'stepRun': this.burst(0.09, 0.2, 260, 0.7); break;
      case 'door': this.tone(180, 0.5, { type: 'sawtooth', gain: 0.05, slide: -90 }); this.burst(0.1, 0.06, 700); break;
      case 'doorLocked': this.tone(120, 0.15, { type: 'square', gain: 0.08 }); this.tone(95, 0.15, { type: 'square', gain: 0.08 }); break;
      case 'unlock': this.tone(600, 0.12, { gain: 0.12 }); this.tone(900, 0.2, { gain: 0.12 }); break;
      case 'pick': this.tone(1400 + Math.random() * 500, 0.03, { type: 'square', gain: 0.05 }); break;
      case 'pry': this.burst(0.15, 0.18, 200, 0.6); this.tone(90, 0.3, { type: 'sawtooth', gain: 0.07, slide: -40 }); break;
      case 'pickup': this.tone(520, 0.1, { gain: 0.1 }); this.tone(780, 0.15, { gain: 0.1 }); break;
      case 'throwWhoosh': this.burst(0.12, 0.06, 900, 0.5); break;
      case 'clink': this.tone(1900, 0.1, { gain: 0.12 }); this.tone(2600, 0.12, { gain: 0.08 }); this.burst(0.05, 0.1, 3000); break;
      case 'thud': this.burst(0.12, 0.22, 120, 0.7); break;
      case 'snap': this.burst(0.08, 0.3, 500, 1.5); this.tone(70, 0.25, { type: 'square', gain: 0.15 }); break;
      case 'camera': this.tone(2500, 0.05, { type: 'square', gain: 0.05 }); break;
      case 'alert': this.tone(300, 0.4, { type: 'sawtooth', gain: 0.1, slide: 120 }); break;
      case 'caught': this.tone(220, 1.2, { type: 'sawtooth', gain: 0.16, slide: -160 }); this.tone(110, 1.2, { type: 'square', gain: 0.1, slide: -70 }); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, { gain: 0.12 }), i * 140)); break;
      case 'heartbeat': this.burst(0.09, 0.16, 65, 0.9); break;
      case 'bell':
        this.tone(830, 0.5, { type: 'triangle', gain: 0.22 });
        this.tone(660, 0.8, { type: 'triangle', gain: 0.18 });
        break;
      case 'board': this.tone(240, 0.25, { type: 'square', gain: 0.07, slide: -100 }); this.burst(0.12, 0.1, 400); break;
      case 'climb': this.burst(0.25, 0.08, 500, 0.6); break;
    }
  }

  // Called every frame; drives chase heartbeat + ambient pad
  update(dt, danger) {
    if (!this.ctx || this.muted) return;
    this._beat -= dt;
    if (this.chase) {
      if (this._beat <= 0) {
        this.play('heartbeat');
        this._beat = 0.45;
      }
    } else if (danger) {
      if (this._beat <= 0) {
        this.play('heartbeat');
        this._beat = 0.9;
      }
    }
    this._padT -= dt;
    if (this._padT <= 0) {
      this._padT = this.chase ? 2.2 : 6;
      if (!this.chase) {
        const base = 55;
        this.tone(base, 4, { type: 'sine', gain: 0.03 });
        this.tone(base * 1.5, 4, { type: 'sine', gain: 0.02 });
      } else {
        this.tone(110, 2, { type: 'sawtooth', gain: 0.035, slide: 15 });
        this.tone(116, 2, { type: 'sawtooth', gain: 0.03 });
      }
    }
  }
}
