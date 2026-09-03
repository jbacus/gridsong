'use strict';
(function () {
// Web Audio tone generator: per-layer buses, 32-note polyphony, reverb and chorus sends,
// procedural drum kits and user-loaded sample voices.
const TN = window.TN || (window.TN = {});

const REVERB_SPEC = {
  'NO EFFECT': null, HALL1: [2.4, 0.35], HALL2: [3.2, 0.3], ROOM1: [0.6, 0.55], ROOM2: [0.9, 0.5], ROOM3: [1.2, 0.45],
  STAGE1: [1.6, 0.4], STAGE2: [2.0, 0.38], PLATE1: [1.4, 0.75], PLATE2: [2.2, 0.7],
};
const CHORUS_SPEC = {
  'NO EFFECT': null, CHORUS1: { base: 0.02, depth: 0.004, rate: 0.7, fb: 0 }, CHORUS2: { base: 0.028, depth: 0.007, rate: 1.1, fb: 0.1 },
  FLANGR1: { base: 0.004, depth: 0.0025, rate: 0.25, fb: 0.55 }, FLANGR2: { base: 0.006, depth: 0.004, rate: 0.5, fb: 0.7 },
};
const MAX_POLY = 32;

TN.AudioEngine = class {
  constructor() {
    this.ctx = null; this.layers = []; this.active = []; this.userBuffers = [null, null, null];
    this.patchCache = new Map(); this.tuning = 0; this.localControl = true;
    this._reverb = ['HALL1', 40]; this._chorus = ['NO EFFECT', 0]; this._master = [96, 96, false];
    this._layerVol = new Array(16).fill(96); this._layerPan = new Array(16).fill(0);
  }
  get ready() { return !!this.ctx; }
  get now() { return this.ctx ? this.ctx.currentTime : performance.now() / 1000; }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this._build();
    return true;
  }

  _build() {
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.15;
    this.comp.connect(c.destination);
    this.master = c.createGain(); this.master.connect(this.comp);
    // reverb
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0;
    this.convolver = c.createConvolver(); this.reverbSend.connect(this.convolver); this.convolver.connect(this.comp);
    // chorus: two modulated delay lines panned L/R
    this.chorusSend = c.createGain(); this.chorusSend.gain.value = 0;
    this.chorusMerge = c.createChannelMerger(2); this.chorusMerge.connect(this.comp);
    this.chorusLines = [0, 1].map((i) => {
      const d = c.createDelay(0.1); const fb = c.createGain(); fb.gain.value = 0;
      const lfo = c.createOscillator(); const lg = c.createGain(); lg.gain.value = 0;
      lfo.frequency.value = 0.7; lfo.start(i * 0.37); lfo.connect(lg); lg.connect(d.delayTime);
      this.chorusSend.connect(d); d.connect(fb); fb.connect(d); d.connect(this.chorusMerge, 0, i);
      return { d, fb, lfo, lg };
    });
    // noise buffer
    const len = c.sampleRate * 2; const nb = c.createBuffer(1, len, c.sampleRate); const data = nb.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // layer buses
    for (let i = 0; i < 16; i++) {
      const input = c.createGain(); const pan = c.createStereoPanner();
      const echo = c.createDelay(1.0); const echoFb = c.createGain(); const echoIn = c.createGain();
      echoIn.connect(echo); echo.connect(echoFb); echoFb.connect(echo); echo.connect(pan);
      echoFb.gain.value = 0.35; echo.delayTime.value = 0.3;
      input.connect(pan); pan.connect(this.master); pan.connect(this.reverbSend); pan.connect(this.chorusSend);
      this.layers.push({ input, pan, echo, echoFb, echoIn });
    }
    this.setReverb(...this._reverb); this.setChorus(...this._chorus); this.setMaster(...this._master);
    for (let i = 0; i < 16; i++) { this.setLayerVolume(i, this._layerVol[i]); this.setLayerPan(i, this._layerPan[i]); }
  }

  _ir(seconds, bright) {
    const c = this.ctx; const n = Math.floor(c.sampleRate * seconds); const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0; const k = bright;
      for (let i = 0; i < n; i++) {
        const t = i / n; const env = Math.exp(-6 * t) * (i < 400 ? i / 400 : 1);
        const w = Math.random() * 2 - 1; lp += k * (w - lp); d[i] = lp * env;
      }
    }
    return buf;
  }

  setReverb(type, param) {
    this._reverb = [type, param]; if (!this.ctx) return;
    const spec = REVERB_SPEC[type];
    if (!spec) { this.reverbSend.gain.value = 0; return; }
    if (this._irType !== type) { this.convolver.buffer = this._ir(spec[0], spec[1]); this._irType = type; }
    this.reverbSend.gain.value = (param / 127) * 0.9;
  }
  setChorus(type, param) {
    this._chorus = [type, param]; if (!this.ctx) return;
    const spec = CHORUS_SPEC[type];
    if (!spec) { this.chorusSend.gain.value = 0; return; }
    this.chorusLines.forEach((l, i) => {
      l.d.delayTime.value = spec.base * (i ? 1.3 : 1); l.lg.gain.value = spec.depth; l.lfo.frequency.value = spec.rate * (i ? 0.8 : 1); l.fb.gain.value = spec.fb;
    });
    this.chorusSend.gain.value = (param / 127) * 0.8;
  }
  setMaster(masterVol, hwVol, mute) {
    this._master = [masterVol, hwVol, mute]; if (!this.ctx) return;
    const g = mute ? 0 : Math.pow(masterVol / 127, 1.5) * Math.pow(hwVol / 127, 1.5);
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }
  setLayerVolume(i, vol) { this._layerVol[i] = vol; if (this.ctx) this.layers[i].input.gain.setTargetAtTime(Math.pow(vol / 127, 1.5), this.ctx.currentTime, 0.02); }
  setLayerPan(i, pan) { this._layerPan[i] = pan; if (this.ctx) this.layers[i].pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan / 64)), this.ctx.currentTime, 0.02); }
  setTuning(cents) { this.tuning = cents; }

  patch(cat, idx) {
    const k = cat * 100 + idx; let p = this.patchCache.get(k);
    if (!p) { p = TN.patchFor(cat, idx); this.patchCache.set(k, p); }
    return p;
  }

  // Track active voices for polyphony limiting.
  _register(entry) {
    const now = this.ctx.currentTime;
    this.active = this.active.filter((e) => e.stopAt > now);
    this.active.push(entry);
    while (this.active.length > MAX_POLY) { const old = this.active.shift(); old.kill(now); }
  }

  /** Play a note. Returns a handle with release(t) for held notes. */
  note(o) {
    if (!this.ctx || !this.localControl) return null;
    const patch = this.patch(o.cat, o.idx); const bus = this.layers[o.layer];
    const t0 = Math.max(o.time || 0, this.ctx.currentTime + 0.002); const vel = o.vel == null ? 1 : o.vel;
    if (patch.kind === 'kit') return this._drum(patch.kit, o.row, t0, vel, bus);
    if (patch.kind === 'user') return this._user(patch, o.midi, t0, o.gate, vel, bus);
    const freq = 440 * Math.pow(2, (o.midi - 69) / 12 + this.tuning / 1200);
    return this._tone(patch, freq, t0, o.gate, vel, bus);
  }

  _tone(p, freq, t0, gate, vel, bus) {
    const c = this.ctx; const nodes = []; const out = c.createGain(); out.gain.value = 0;
    let dest = out;
    if (p.filter) {
      const f = c.createBiquadFilter(); f.type = p.filter.type; f.Q.value = p.filter.q;
      const base = Math.min(18000, Math.max(p.filter.min, freq * p.filter.base));
      f.frequency.setValueAtTime(Math.min(18000, base * (1 + p.filter.envAmt)), t0);
      f.frequency.exponentialRampToValueAtTime(base, t0 + p.filter.decay);
      if (p.evolve) {
        f.frequency.setValueAtTime(base, t0 + p.filter.decay + 0.01);
        f.frequency.exponentialRampToValueAtTime(Math.min(16000, base * p.evolve.sweepTo), t0 + p.evolve.sweepTime);
        const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = p.evolve.lfoRate; lg.gain.value = base * p.evolve.lfoDepth * 0.5;
        lfo.connect(lg); lg.connect(f.frequency); lfo.start(t0); nodes.push(lfo);
      }
      f.connect(out); dest = f;
    }
    // vibrato LFO shared by carriers
    let vib = null;
    if (p.vibrato) {
      const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = p.vibrato.rate;
      lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(p.vibrato.depth, t0 + p.vibrato.delay + 0.3);
      lfo.connect(lg); lfo.start(t0); nodes.push(lfo); vib = lg;
    }
    let mod = null;
    if (p.fm) {
      const m = c.createOscillator(); const mg = c.createGain(); m.frequency.value = freq * p.fm.ratio;
      mg.gain.setValueAtTime(freq * p.fm.index, t0); mg.gain.exponentialRampToValueAtTime(freq * p.fm.index * 0.02 + 0.01, t0 + p.fm.decay + 0.4);
      m.connect(mg); m.start(t0); nodes.push(m); mod = mg;
    }
    const gsum = p.oscs.reduce((a, o) => a + o.gain, 0) || 1;
    for (const od of p.oscs) {
      const osc = c.createOscillator(); osc.type = od.type; const f = freq * od.ratio;
      if (p.pitchEnv) { osc.frequency.setValueAtTime(f * Math.pow(2, p.pitchEnv.amount / 12), t0); osc.frequency.exponentialRampToValueAtTime(f, t0 + p.pitchEnv.decay); }
      else osc.frequency.value = f;
      osc.detune.value = od.detune || 0;
      if (vib) vib.connect(osc.detune); if (mod) mod.connect(osc.frequency);
      const g = c.createGain(); g.gain.value = od.gain / gsum; osc.connect(g); g.connect(dest); osc.start(t0); nodes.push(osc);
    }
    if (p.noise) {
      const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.noise.hp;
      const ng = c.createGain(); ng.gain.setValueAtTime(p.noise.gain * vel, t0); ng.gain.exponentialRampToValueAtTime(0.0005, t0 + p.noise.decay + 0.01);
      n.connect(hp); hp.connect(ng); ng.connect(out); n.start(t0); n.stop(t0 + p.noise.decay + 0.1); nodes.push(n);
    }
    const peak = vel * p.level * 0.45; const e = p.env;
    out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(peak, t0 + e.a);
    out.gain.setTargetAtTime(Math.max(e.s * peak, 0.0001), t0 + e.a, e.d / 3);
    out.connect(bus.input);
    if (p.echo) { bus.echo.delayTime.setTargetAtTime(p.echo.time, t0, 0.05); bus.echoFb.gain.setTargetAtTime(p.echo.fb, t0, 0.05); const eg = c.createGain(); eg.gain.value = p.echo.level; out.connect(eg); eg.connect(bus.echoIn); }
    const entry = { stopAt: Infinity, kill: (t) => { try { out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.01); nodes.forEach((n) => n.stop(t + 0.1)); } catch (err) { /* ignore */ } } };
    const release = (t) => {
      const tr = Math.max(t, t0 + e.a + 0.005);
      out.gain.setTargetAtTime(0, tr, Math.max(0.01, e.r / 4));
      const end = tr + e.r * 2.5 + 0.05; entry.stopAt = end;
      nodes.forEach((n) => { try { n.stop(end); } catch (err) { /* already stopped */ } });
    };
    if (gate != null) {
      release(t0 + Math.max(0.01, gate));
      if (e.s === 0 && !p.sustain) entry.stopAt = Math.min(entry.stopAt, t0 + e.a + e.d * 3 + e.r + 0.2);
    }
    this._register(entry);
    return { release, kill: entry.kill };
  }

  _user(p, midi, t0, gate, vel, bus) {
    const buf = this.userBuffers[p.cat - 1]; if (!buf) return null;
    const c = this.ctx; const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = Math.pow(2, (midi - 60) / 12);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vel * 0.8, t0 + 0.005);
    src.connect(g); g.connect(bus.input); src.start(t0);
    const entry = { stopAt: t0 + Math.min(buf.duration, 0.97) + 0.1, kill: (t) => { try { g.gain.setTargetAtTime(0, t, 0.01); src.stop(t + 0.05); } catch (err) { /* ignore */ } } };
    const release = (t) => { g.gain.setTargetAtTime(0, t, 0.02); try { src.stop(t + 0.15); } catch (err) { /* ignore */ } entry.stopAt = t + 0.2; };
    if (gate != null) release(t0 + Math.max(0.01, gate)); src.stop(t0 + 0.97 + 0.05);
    this._register(entry); return { release, kill: entry.kill };
  }

  _drum(kit, row, t0, vel, bus) {
    const c = this.ctx; const spec = kit.rows[Math.max(0, Math.min(15, row | 0))]; const out = c.createGain(); out.connect(bus.input);
    const lvl = vel * kit.level * 0.5; const nodes = [];
    const noise = (hp, bp, q, gain, decay, attack = 0.001) => {
      const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true; let last = n;
      if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; last.connect(f); last = f; }
      if (bp) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q || 1; last.connect(f); last = f; }
      const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain * lvl, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0005, t0 + attack + decay);
      last.connect(g); g.connect(out); n.start(t0); n.stop(t0 + attack + decay + 0.05); nodes.push(n);
    };
    const tone = (type, f0, f1, slide, gain, decay) => {
      const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (slide) o.frequency.exponentialRampToValueAtTime(f1, t0 + slide);
      const g = c.createGain(); g.gain.setValueAtTime(gain * lvl, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + decay);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + decay + 0.05); nodes.push(o);
    };
    const d = spec.d; let end = d + 0.1;
    switch (spec.t) {
      case 'kick': tone('sine', spec.f * 4, spec.f, 0.04, 1.2, d); noise(1500, 0, 0, 0.25, 0.02); break;
      case 'snare': tone('triangle', spec.f, spec.f * 0.9, 0.05, 0.5, Math.min(d, 0.12)); noise(800, 1800, 0.8, 0.9, d); break;
      case 'clap': noise(1000, 1400, 1.2, 0.8, 0.012); noise(1000, 1400, 1.2, 0.8, d, 0.025); break;
      case 'hat': noise(7000, 9000, 0.7, 0.55, d); break;
      case 'tom': tone('sine', spec.f * 1.6, spec.f, 0.09, 1.0, d); noise(2000, 0, 0, 0.15, 0.02); break;
      case 'rim': tone('square', spec.f, spec.f, 0, 0.35, d); noise(3000, 0, 0, 0.3, 0.015); break;
      case 'cowbell': tone('square', spec.f, spec.f, 0, 0.3, d); tone('square', spec.f * 1.48, spec.f * 1.48, 0, 0.25, d); break;
      case 'shaker': noise(5000, 0, 0, 0.5, d, 0.012); break;
      case 'crash': noise(4000, 6000, 0.4, 0.6, d, 0.004); end = d + 0.2; break;
      case 'ride': noise(6000, 8000, 1.5, 0.35, d); tone('sine', 3200, 3200, 0, 0.12, 0.15); break;
      case 'zap': tone('sawtooth', spec.f, spec.f / 8, 0.15, 0.5, d); break;
      case 'wood': tone('sine', spec.f * 2.2, spec.f * 1.6, 0.03, 0.8, Math.max(0.08, d * 0.4)); noise(1200, 0, 0, 0.2, 0.01); break;
      default: tone('sine', spec.f, spec.f, 0, 0.8, d);
    }
    if (kit.echo) { bus.echo.delayTime.setTargetAtTime(kit.echo.time, t0, 0.05); bus.echoFb.gain.setTargetAtTime(kit.echo.fb, t0, 0.05); const eg = c.createGain(); eg.gain.value = kit.echo.level; out.connect(eg); eg.connect(bus.echoIn); }
    const entry = { stopAt: t0 + end, kill: (t) => { try { out.gain.setTargetAtTime(0, t, 0.01); nodes.forEach((n) => n.stop(t + 0.05)); } catch (err) { /* ignore */ } } };
    this._register(entry);
    return { release: () => {}, kill: entry.kill };
  }

  async loadUserVoice(slot, arrayBuffer) {
    this.ensure();
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    this.userBuffers[slot] = buf; return buf;
  }
  killAll() { const t = this.now; this.active.forEach((e) => e.kill(t)); this.active = []; }
};
})();
