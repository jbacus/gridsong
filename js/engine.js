'use strict';
(function () {
// State model, transport and the six performance modes.
const TN = window.TN || (window.TN = {});

const M = TN.MODE_OF_LAYER;
const clone = (o) => JSON.parse(JSON.stringify(o));

TN.emptyLayerData = function (i) {
  switch (M[i]) {
    case 'score': return { notes: new Array(256).fill(0) };
    case 'random': return { notes: [] };
    case 'draw': return { events: [] };
    case 'bounce': return { entry: new Array(16).fill(-1) };
    case 'push': return { latched: [] };
    default: return {};
  }
};
TN.emptyBlock = () => ({ layers: Array.from({ length: 16 }, (_, i) => TN.emptyLayerData(i)) });
TN.defaultLayerSettings = (i) => ({
  instrument: TN.DEFAULT_INSTRUMENT[i].slice(), volume: 96, loopSpeed: i === 13 ? 8 : 4, soundLength: 100, pan: 0, octave: 0,
  top: 1, end: 16, anim: { type: TN.DEFAULT_ANIM[i][0], size: TN.DEFAULT_ANIM[i][1], mode: TN.DEFAULT_ANIM[i][2] }, rotation: null,
});
TN.defaultState = () => ({
  tempo: 75, scale: 'Ionian', transpose: 0, masterVolume: 96, hardwareVolume: 96, mute: false, masterLoopSpeed: 4,
  masterTuning: 0, quantize: true, pushSensitivity: 120, localControl: true, loopIndicator: true,
  reverbType: 'HALL1', reverbParam: 40, chorusType: 'NO EFFECT', chorusParam: 0,
  ownerName: 'NO NAME', interiorType: 'Song (DEMO)', saverType: 'Interior', saverTime: 10, timeSignal: false, alarm: false, alarmHour: 0, alarmMinute: 0,
  currentLayer: 0, currentBlock: 0,
  layers: Array.from({ length: 16 }, (_, i) => TN.defaultLayerSettings(i)),
  blocks: Array.from({ length: 16 }, () => TN.emptyBlock()),
});

// Solo mode repeat interval, in layer steps, by row (15 = top). Bottom row = play once.
const SOLO_MULT = [null, 64, 48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1.5, 1, 0.75, 0.5];
// Random-mode rotation speeds (beats per 11.25 degree step), manual p.28
const ROT_SPEEDS = [4, 3, 2, 1, 0.75, 0.5, 0.25, 0.125];

TN.Engine = class {
  constructor(audio) {
    this.audio = audio; this.state = TN.defaultState();
    this.rt = Array.from({ length: 16 }, () => ({}));
    this.playing = true; this.pausedAt = null; this.origin = 0;
    this.anims = []; this.visQueue = []; this.flash = new Map(); // key r*16+c -> {until, layer}
    this.override = null; // interior playback block set
    this.recording = null; this.playback = null;
    this.onChange = () => {}; this.msg = null; this.undoSnap = null;
    this._timer = null; this.solo = new Map(); this.pushNotes = new Map();
    this.resetRuntime();
  }

  // ---- clocks -------------------------------------------------------------
  now() { return this.audio.ctx ? this.audio.ctx.currentTime : performance.now() / 1000; }
  beat() { return 60 / this.state.tempo; }
  stepDur(i) { return this.beat() / this.state.layers[i].loopSpeed; }
  blockData(i) { const b = this.override ? this.override.blocks[this.override.index % this.override.blocks.length] : this.state.blocks[this.state.currentBlock]; return b.layers[i]; }
  mode(i) { return M[i]; }
  layer() { return this.state.currentLayer; }

  resetRuntime() {
    const t = this.now(); this.origin = t;
    for (let i = 0; i < 16; i++) {
      const L = this.state.layers[i];
      this.rt[i] = { stepIndex: 0, nextTime: t, lastStepTime: t, stepDur: this.stepDur(i), col: L.top - 1, dispCol: L.top - 1,
        seg: 0, progress: 0, dispSeg: 0, dispProgress: 0, dispStepTime: t, rotStep: 0, rotNext: t, drawStep: 0, iter: 0, dispDraw: 0, dispIter: 0,
        pos: new Array(16).fill(null), dir: new Array(16).fill(-1), dispPos: new Array(16).fill(null) };
    }
  }
  resync() { const t = this.now(); this.origin = t; for (const rt of this.rt) { rt.nextTime = t; rt.lastStepTime = t; rt.rotNext = t; } this.visQueue = []; }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    if (!this.playing) return;
    const now = this.now(); const horizon = now + 0.12;
    for (let i = 0; i < 16; i++) {
      const rt = this.rt[i];
      if (now - rt.nextTime > 0.6) { rt.nextTime = now; } // tab was hidden: skip ahead
      while (rt.nextTime < horizon) {
        const t = rt.nextTime; rt.stepDur = this.stepDur(i);
        this.step(i, t); rt.lastStepTime = t; rt.nextTime = t + rt.stepDur; rt.stepIndex++;
      }
      const rot = this.state.layers[i].rotation;
      if (M[i] === 'random' && rot) {
        const iv = rot.beats * this.beat() * (4 / this.state.layers[i].loopSpeed);
        if (now - rt.rotNext > 1) rt.rotNext = now;
        while (rt.rotNext < horizon) { const t = rt.rotNext; const s = (rt.rotStep + rot.dir + 32) % 32; this.visQueue.push({ t, fn: () => { rt.rotStep = s; } }); rt.rotNext = t + iv; }
      }
    }
  }

  /** Apply scheduled visual updates whose time has come. Called from the render loop. */
  flushVisuals() {
    const now = this.now(); if (!this.visQueue.length) return;
    const keep = [];
    for (const v of this.visQueue) { if (v.t <= now) v.fn(); else keep.push(v); }
    this.visQueue = keep;
  }

  // ---- pitch --------------------------------------------------------------
  pitchIndexFor(i, r, c) { return (M[i] === 'bounce' || M[i] === 'push' || M[i] === 'solo') ? c : r; }
  midiFor(i, index) {
    const L = this.state.layers[i];
    return TN.scaleMidi(this.state.scale, index) + this.state.transpose + 12 * L.octave;
  }

  /** Sound + light for a note in layer i at (r,c) at audio time t. */
  trigger(i, r, c, t, opts = {}) {
    const L = this.state.layers[i]; const [cat, idx] = L.instrument; const index = this.pitchIndexFor(i, r, c);
    const gate = opts.gate === undefined ? L.soundLength / 1000 : opts.gate;
    const h = this.audio.note({ layer: i, cat, idx, midi: this.midiFor(i, index), row: index, time: t, gate, vel: opts.vel });
    if (!opts.silentLight) this.light(i, r, c, t, opts.animOverride);
    return h;
  }
  light(i, r, c, t, animOverride) {
    const a = animOverride || this.state.layers[i].anim;
    this.anims.push({ t, r, c, layer: i, type: a.type, size: a.size, mode: a.mode });
    if (this.anims.length > 400) this.anims.splice(0, this.anims.length - 400);
    this.visQueue.push({ t, fn: () => { this.flash.set(r * 16 + c, { until: t + Math.max(0.12, this.rt[i].stepDur * 0.9), layer: i }); } });
  }

  // ---- per-step behaviour ---------------------------------------------------
  step(i, t) {
    const L = this.state.layers[i]; const data = this.blockData(i); const rt = this.rt[i];
    switch (M[i]) {
      case 'score': {
        const top = L.top - 1, end = L.end - 1;
        if (rt.col < top || rt.col > end) rt.col = top;
        const col = rt.col;
        for (let r = 0; r < 16; r++) if (data.notes[r * 16 + col]) this.trigger(i, r, col, t);
        this.visQueue.push({ t, fn: () => { rt.dispCol = col; rt.dispStepTime = t; } });
        rt.col = col >= end ? top : col + 1;
        break;
      }
      case 'random': {
        const pts = this.randomPositions(i, data); const n = pts.length;
        if (n === 0) { rt.seg = 0; rt.progress = 0; break; }
        if (n === 1) { if (rt.stepIndex % 4 === 0) this.trigger(i, pts[0].r, pts[0].c, t); rt.seg = 0; rt.progress = 0; }
        else {
          if (rt.seg >= n) rt.seg = 0;
          const a = pts[rt.seg], b = pts[(rt.seg + 1) % n];
          const len = Math.max(1, Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)));
          rt.progress++;
          if (rt.progress >= len) { rt.seg = (rt.seg + 1) % n; rt.progress = 0; const p = pts[rt.seg]; this.trigger(i, p.r, p.c, t); }
        }
        const seg = rt.seg, progress = rt.progress;
        this.visQueue.push({ t, fn: () => { rt.dispSeg = seg; rt.dispProgress = progress; rt.dispStepTime = t; } });
        break;
      }
      case 'draw': {
        const s = rt.drawStep, iter = rt.iter;
        for (const ev of data.events) if (ev.step === s && ev.iter !== iter) this.trigger(i, ev.r, ev.c, t);
        this.visQueue.push({ t, fn: () => { rt.dispDraw = s; rt.dispIter = iter; rt.dispStepTime = t; } });
        rt.drawStep = (s + 1) % 16; if (rt.drawStep === 0) rt.iter++;
        break;
      }
      case 'bounce': {
        for (let c = 0; c < 16; c++) {
          const entry = data.entry[c];
          if (entry < 1) { rt.pos[c] = null; continue; }
          if (rt.pos[c] == null) { rt.pos[c] = entry; rt.dir[c] = -1; }
          let pos = rt.pos[c] + rt.dir[c];
          if (pos <= 0) { pos = 0; rt.dir[c] = 1; this.trigger(i, 0, c, t); }
          else if (pos >= entry) { pos = entry; rt.dir[c] = -1; }
          rt.pos[c] = pos;
        }
        const snap = rt.pos.slice();
        this.visQueue.push({ t, fn: () => { rt.dispPos = snap; rt.dispStepTime = t; } });
        break;
      }
      default: break;
    }
  }

  /** Random-mode note positions with rotation applied and clamped to the matrix. */
  randomPositions(i, data) {
    const rot = this.state.layers[i].rotation; const rt = this.rt[i];
    if (!rot || rt.rotStep === 0) return data.notes;
    const ang = rt.rotStep * Math.PI / 16; const cs = Math.cos(ang), sn = Math.sin(ang);
    return data.notes.map((n) => {
      const x = n.c - 7.5, y = n.r - 7.5;
      const c = Math.round(x * cs - y * sn + 7.5), r = Math.round(x * sn + y * cs + 7.5);
      return { r: Math.max(0, Math.min(15, r)), c: Math.max(0, Math.min(15, c)) };
    });
  }

  // ---- transport -------------------------------------------------------------
  togglePause() {
    if (this.playing) { this.playing = false; this.pausedAt = this.now(); this.stopSoloAll(); }
    else {
      const dt = this.now() - this.pausedAt; this.playing = true;
      for (const rt of this.rt) { rt.nextTime += dt; rt.rotNext += dt; rt.lastStepTime += dt; }
      this.origin += dt; for (const v of this.visQueue) v.t += dt;
    }
    this.onChange();
  }
  resetLoopTiming() {
    const t = this.now(); this.origin = t;
    for (let i = 0; i < 16; i++) { const rt = this.rt[i]; const L = this.state.layers[i]; rt.col = L.top - 1; rt.dispCol = rt.col; rt.seg = 0; rt.progress = 0; rt.drawStep = 0; rt.pos.fill(null); rt.nextTime = t; rt.lastStepTime = t; rt.stepIndex = 0; }
    this.visQueue = [];
  }
  setScorePosition(i, col) { const rt = this.rt[i]; rt.col = col; rt.dispCol = col; }

  // ---- note entry ----------------------------------------------------------------
  preview(i, r, c) { this.trigger(i, r, c, this.now(), {}); }

  toggleScoreNote(i, r, c) {
    const d = this.blockData(i); const k = r * 16 + c; d.notes[k] = d.notes[k] ? 0 : 1; this.onChange();
  }
  toggleRandomNote(i, r, c) {
    const d = this.blockData(i); const at = d.notes.findIndex((n) => n.r === r && n.c === c);
    if (at >= 0) { d.notes.splice(at, 1); const rt = this.rt[i]; if (rt.seg >= d.notes.length) rt.seg = 0; rt.progress = 0; }
    else d.notes.push({ r, c });
    this.onChange();
  }
  drawHit(i, r, c) {
    const rt = this.rt[i]; const d = this.blockData(i);
    this.trigger(i, r, c, this.now());
    if (!d.events.some((e) => e.step === rt.dispDraw && e.r === r && e.c === c)) d.events.push({ step: rt.dispDraw, r, c, iter: rt.dispIter });
  }
  bouncePress(i, r, c) {
    const d = this.blockData(i); const rt = this.rt[i];
    if (r === 0) { if (d.entry[c] >= 1) { d.entry[c] = -1; rt.pos[c] = null; } else this.trigger(i, 0, c, this.now()); }
    else if (d.entry[c] === r) { d.entry[c] = -1; rt.pos[c] = null; }
    else { d.entry[c] = r; rt.pos[c] = r; rt.dir[c] = -1; this.flash.set(r * 16 + c, { until: this.now() + 0.15, layer: i }); }
    this.onChange();
  }
  pushDown(i, r, c, id) {
    const key = r * 16 + c; const d = this.blockData(i);
    const existing = this.pushNotes.get(key);
    if (existing) { // pressing a sounding note stops it
      this.pushRelease(key); const at = d.latched.findIndex((n) => n.r === r && n.c === c); if (at >= 0) d.latched.splice(at, 1); return;
    }
    const h = this.trigger(i, r, c, this.now(), { gate: null, silentLight: true });
    this.pushNotes.set(key, { handle: h, start: this.now(), r, c, layer: i, latched: false, id });
  }
  pushUp(i, r, c) {
    const key = r * 16 + c; const n = this.pushNotes.get(key); if (!n) return;
    const held = this.now() - n.start;
    if (held < 0.6) this.pushRelease(key);
    else { n.latched = true; const d = this.blockData(i); if (!d.latched.some((x) => x.r === r && x.c === c)) d.latched.push({ r, c }); }
  }
  pushRelease(key) { const n = this.pushNotes.get(key); if (!n) return; if (n.handle) n.handle.release(this.now()); this.pushNotes.delete(key); }
  stopPushAll() { for (const key of Array.from(this.pushNotes.keys())) this.pushRelease(key); }
  restartPushLatched() {
    this.stopPushAll(); const i = 14; const d = this.blockData(i);
    for (const n of d.latched) { const h = this.trigger(i, n.r, n.c, this.now(), { gate: null, silentLight: true }); this.pushNotes.set(n.r * 16 + n.c, { handle: h, start: this.now() - 1, r: n.r, c: n.c, layer: i, latched: true }); }
  }

  soloDown(i, r, c, id) {
    this.soloUp(id);
    const s = { layer: i, r, c, id, handle: null, timer: null, nextT: null };
    this.solo.set(id, s); this.soloSchedule(s, true);
  }
  soloMove(id, r, c) {
    const s = this.solo.get(id); if (!s) return;
    if (s.r === r && s.c === c) return;
    const pitchChanged = s.c !== c; s.r = r; s.c = c;
    if (pitchChanged) { if (s.timer) clearTimeout(s.timer); if (s.handle) s.handle.release(this.now()); this.soloSchedule(s, true); }
  }
  soloUp(id) {
    const s = this.solo.get(id); if (!s) return;
    if (s.timer) clearTimeout(s.timer); if (s.handle) s.handle.release(this.now()); this.solo.delete(id);
  }
  stopSoloAll() { for (const id of Array.from(this.solo.keys())) this.soloUp(id); }
  soloSchedule(s, immediate) {
    const L = this.state.layers[s.layer]; const mult = SOLO_MULT[s.r]; const step = this.stepDur(s.layer);
    const now = this.now(); let t;
    if (immediate) t = now;
    else {
      const iv = mult * step;
      if (this.state.quantize) { const k = Math.floor((now - this.origin) / iv + 1e-6) + 1; t = this.origin + k * iv; }
      else t = s.nextT + iv;
      if (t < now) t = now;
    }
    s.nextT = t;
    const patch = this.audio.patch(L.instrument[0], L.instrument[1]);
    const sustained = patch.sustain || (patch.env && patch.env.s >= 0.5) || mult == null;
    const fire = () => {
      if (!this.solo.has(s.id)) return;
      if (s.handle) s.handle.release(t);
      s.handle = this.trigger(s.layer, s.r, s.c, t, { gate: sustained ? null : L.soundLength / 1000, animOverride: { type: 'VLine', size: 1, mode: 'None' } });
      if (mult != null) { const iv = mult * step; const next = this.state.quantize ? this.origin + (Math.floor((t - this.origin) / iv + 1e-6) + 1) * iv : t + iv; s.nextT = next - iv; this.soloSchedule(s, false); }
    };
    const delay = Math.max(0, (t - now - 0.08) * 1000);
    s.timer = setTimeout(() => { if (t < this.now()) t = this.now(); fire(); }, delay);
  }

  // ---- random-mode rotation -------------------------------------------------
  setRotation(i, dir, radPerSec) {
    if (!radPerSec || !isFinite(radPerSec)) { this.state.layers[i].rotation = null; this.onChange(); return; }
    const secPerStep = (Math.PI / 16) / radPerSec; const beats = secPerStep / this.beat();
    let best = ROT_SPEEDS[0]; for (const s of ROT_SPEEDS) if (Math.abs(Math.log(s / beats)) < Math.abs(Math.log(best / beats))) best = s;
    this.state.layers[i].rotation = { dir, beats: best }; this.rt[i].rotNext = this.now(); this.onChange();
  }
  stopRotation(i) { const L = this.state.layers[i]; if (L.rotation) { const pts = this.randomPositions(i, this.blockData(i)); this.blockData(i).notes = pts.map((p) => ({ r: p.r, c: p.c })); L.rotation = null; this.rt[i].rotStep = 0; this.onChange(); } }

  // ---- clear / copy / blocks -------------------------------------------------
  clearLayer(i = this.state.currentLayer, blockIndex = this.state.currentBlock) {
    const b = this.state.blocks[blockIndex]; b.layers[i] = TN.emptyLayerData(i);
    if (M[i] === 'push' && blockIndex === this.state.currentBlock) this.stopPushAll();
    if (M[i] === 'bounce') { this.rt[i].pos.fill(null); }
    this.msg = { text: 'Clear Layer\nBlock[' + String(blockIndex + 1).padStart(2, '0') + '] Layer[' + String(i + 1).padStart(2, '0') + ']', until: Date.now() + 1200 };
    this.onChange();
  }
  clearBlock(blockIndex = this.state.currentBlock) { for (let i = 0; i < 16; i++) this.clearLayer(i, blockIndex); this.msg = { text: 'Clear Block[' + String(blockIndex + 1).padStart(2, '0') + ']', until: Date.now() + 1200 }; }
  clearAll() { for (let b = 0; b < 16; b++) for (let i = 0; i < 16; i++) this.clearLayer(i, b); this.msg = { text: 'Clear All', until: Date.now() + 1200 }; }
  resetAll() {
    const s = TN.defaultState(); this.state.blocks = s.blocks; this.state.layers = s.layers;
    this.state.tempo = 75; this.state.transpose = 0; this.state.scale = 'Ionian'; this.state.masterLoopSpeed = 4; this.state.mute = false;
    this.stopPushAll(); this.syncAudio(); this.resetRuntime(); this.onChange();
  }
  copyBlock(from, to) { if (from === to) return; this.state.blocks[to] = clone(this.state.blocks[from]); this.onChange(); }
  copyLayer(fromBlock, layer, toBlock, toLayer) {
    if (M[layer] !== M[toLayer]) return false;
    this.state.blocks[toBlock].layers[toLayer] = clone(this.state.blocks[fromBlock].layers[layer]); this.onChange(); return true;
  }
  selectBlock(b) {
    if (b === this.state.currentBlock) return;
    const prev = this.state.blocks[this.state.currentBlock]; this.state.currentBlock = b; const cur = this.state.blocks[b];
    for (let i = 0; i < 16; i++) {
      const rt = this.rt[i];
      if (M[i] === 'random' && JSON.stringify(prev.layers[i].notes) !== JSON.stringify(cur.layers[i].notes)) { rt.seg = 0; rt.progress = 0; }
      if (M[i] === 'bounce' && JSON.stringify(prev.layers[i].entry) !== JSON.stringify(cur.layers[i].entry)) rt.pos.fill(null);
    }
    this.restartPushLatched(); this.onChange();
  }
  selectLayer(i) { this.state.currentLayer = i; this.onChange(); }
  snapshot() { this.undoSnap = { blocks: clone(this.state.blocks), layers: clone(this.state.layers) }; }
  undo() { if (!this.undoSnap) return; this.state.blocks = this.undoSnap.blocks; this.state.layers = this.undoSnap.layers; this.undoSnap = null; this.syncAudio(); this.onChange(); }

  // ---- settings -----------------------------------------------------------------
  setTempo(v) { this.state.tempo = Math.max(40, Math.min(240, Math.round(v))); this.onChange(); }
  setTranspose(v) { this.state.transpose = Math.max(-7, Math.min(8, v)); this.onChange(); }
  setScale(name) { this.state.scale = name; this.onChange(); }
  setOctave(i, v) { this.state.layers[i].octave = Math.max(-5, Math.min(5, v)); this.onChange(); }
  setSoundLength(i, ms) { this.state.layers[i].soundLength = Math.max(10, Math.min(9990, ms)); this.onChange(); }
  setLoopSpeed(i, v) { this.state.layers[i].loopSpeed = v; this.onChange(); }
  setMasterLoopSpeed(v) { this.state.masterLoopSpeed = v; for (const L of this.state.layers) L.loopSpeed = v; this.onChange(); }
  setLoopPoint(i, top, end) { const L = this.state.layers[i]; L.top = Math.max(1, Math.min(16, top)); L.end = Math.max(L.top, Math.min(16, end)); this.onChange(); }
  setMasterLoopPoint(top, end) { for (let i = 0; i < 16; i++) this.setLoopPoint(i, top, end); }
  setLayerVolume(i, v) { this.state.layers[i].volume = Math.max(0, Math.min(127, v)); this.audio.setLayerVolume(i, this.state.layers[i].volume); this.onChange(); }
  setPan(i, v) { this.state.layers[i].pan = Math.max(-64, Math.min(63, v)); this.audio.setLayerPan(i, this.state.layers[i].pan); this.onChange(); }
  setMasterVolume(v) { this.state.masterVolume = Math.max(0, Math.min(127, v)); this.syncMaster(); this.onChange(); }
  setHardwareVolume(v) { this.state.hardwareVolume = Math.max(0, Math.min(127, v)); this.syncMaster(); this.onChange(); }
  setMute(v) { this.state.mute = !!v; this.syncMaster(); this.onChange(); }
  syncMaster() { this.audio.setMaster(this.state.masterVolume, this.state.hardwareVolume, this.state.mute); }
  setInstrument(i, cat, idx) {
    const L = this.state.layers[i]; const wasUser = TN.isUserVoice(L.instrument[0], L.instrument[1]); const isUser = TN.isUserVoice(cat, idx);
    L.instrument = [cat, idx];
    if (isUser && !wasUser) L.soundLength = 1000; else if (!isUser && wasUser) L.soundLength = 100;
    this.onChange();
  }
  setAnim(i, type, size, mode) { const a = this.state.layers[i].anim; if (type) a.type = type; if (size) a.size = size; if (mode) a.mode = mode; this.onChange(); }
  setReverb(type, param) { if (type) this.state.reverbType = type; if (param != null) this.state.reverbParam = param; this.audio.setReverb(this.state.reverbType, this.state.reverbParam); this.onChange(); }
  setChorus(type, param) { if (type) this.state.chorusType = type; if (param != null) this.state.chorusParam = param; this.audio.setChorus(this.state.chorusType, this.state.chorusParam); this.onChange(); }
  setPref(key, v) { this.state[key] = v; if (key === 'masterTuning') this.audio.setTuning(v); if (key === 'localControl') this.audio.localControl = v; this.onChange(); }
  syncAudio() {
    const s = this.state; this.audio.setReverb(s.reverbType, s.reverbParam); this.audio.setChorus(s.chorusType, s.chorusParam); this.syncMaster();
    this.audio.setTuning(s.masterTuning); this.audio.localControl = s.localControl;
    for (let i = 0; i < 16; i++) { this.audio.setLayerVolume(i, s.layers[i].volume); this.audio.setLayerPan(i, s.layers[i].pan); }
  }

  // ---- files (localStorage stands in for the SD card) -----------------------------
  files() { try { return JSON.parse(localStorage.getItem('tenori.files') || '{}'); } catch (e) { return {}; } }
  saveFiles(f) { try { localStorage.setItem('tenori.files', JSON.stringify(f)); return true; } catch (e) { return false; } }
  fileList(kind) { const f = this.files(); return Object.keys(f[kind] || {}).sort(); }
  fileExists(kind, name) { const f = this.files(); return !!(f[kind] && f[kind][name]); }
  fileSave(kind, name, data) { const f = this.files(); f[kind] = f[kind] || {}; f[kind][name] = data; return this.saveFiles(f); }
  fileLoad(kind, name) { const f = this.files(); return f[kind] && f[kind][name]; }
  fileDelete(kind, name) { const f = this.files(); if (f[kind]) delete f[kind][name]; this.saveFiles(f); }
  fileRename(kind, from, to) { const f = this.files(); if (f[kind] && f[kind][from]) { f[kind][to] = f[kind][from]; if (from !== to) delete f[kind][from]; this.saveFiles(f); } }
  settingsData() { const s = clone(this.state); delete s.blocks; return s; }
  exportAllBlocks() { return { blocks: clone(this.state.blocks), settings: this.settingsData() }; }
  importAllBlocks(d) { if (d.blocks) this.state.blocks = clone(d.blocks); if (d.settings) this.applySettings(d.settings); this.stopPushAll(); this.resetRuntime(); this.restartPushLatched(); this.onChange(); }
  applySettings(s) { const keep = { currentLayer: this.state.currentLayer, currentBlock: this.state.currentBlock }; Object.assign(this.state, clone(s), keep); this.syncAudio(); }
  exportBlock() { return { block: clone(this.state.blocks[this.state.currentBlock]), settings: this.settingsData() }; }
  importBlock(d) { this.state.blocks[this.state.currentBlock] = clone(d.block); if (d.settings) this.applySettings(d.settings); this.stopPushAll(); this.resetRuntime(); this.restartPushLatched(); this.onChange(); }
  exportLayer() { const i = this.state.currentLayer; return { layer: i, data: clone(this.blockData(i)), settings: clone(this.state.layers[i]) }; }
  importLayer(d) { const i = this.state.currentLayer; if (M[d.layer] !== M[i]) return false; this.state.blocks[this.state.currentBlock].layers[i] = clone(d.data); if (d.settings) { this.state.layers[i] = clone(d.settings); this.state.layers[i].instrument = this.state.layers[i].instrument; } this.syncAudio(); this.onChange(); return true; }
  saveDefault() { try { localStorage.setItem('tenori.default', JSON.stringify(this.settingsData())); return true; } catch (e) { return false; } }
  loadDefault() { try { const d = JSON.parse(localStorage.getItem('tenori.default') || 'null'); if (d) { this.applySettings(d); this.state.currentLayer = 0; this.state.currentBlock = 0; } } catch (e) { /* ignore */ } }
  factoryReset() { try { localStorage.removeItem('tenori.default'); localStorage.removeItem('tenori.timesignal'); localStorage.removeItem('tenori.alarm'); } catch (e) { /* ignore */ } const s = TN.defaultState(); this.state = s; this.stopPushAll(); this.syncAudio(); this.resetRuntime(); this.onChange(); }

  // ---- song recording / playback ---------------------------------------------------
  act(name, ...args) {
    if (this.recording) { this.recording.events.push({ t: Date.now() - this.recording.startAt, name, args }); if (this.recording.events.length >= 1000) { this.recording.full = true; } }
    return this[name](...args);
  }
  startRecording() { this.recording = { startAt: Date.now(), events: [], snapshot: this.exportAllBlocks(), full: false }; this.onChange(); }
  stopRecording() { const r = this.recording; this.recording = null; if (!r) return null; return { snapshot: r.snapshot, events: r.events, composer: this.state.ownerName, duration: Date.now() - r.startAt }; }
  playSong(song, onEnd) {
    this.stopSong(); this.importAllBlocks(song.snapshot);
    const start = Date.now(); const pb = { song, start, timers: [], onEnd };
    for (const ev of song.events) pb.timers.push(setTimeout(() => { try { this[ev.name](...ev.args); } catch (e) { /* ignore */ } }, ev.t));
    pb.timers.push(setTimeout(() => { this.playback = null; if (onEnd) onEnd(); this.onChange(); }, (song.duration || 0) + 500));
    this.playback = pb; this.onChange();
  }
  stopSong() { if (!this.playback) return; this.playback.timers.forEach(clearTimeout); this.playback = null; this.onChange(); }

  // ---- interior mode -----------------------------------------------------------------
  startInterior(type) {
    if (this.interior) this.stopInterior();
    const withSong = /Song/.test(type); const withClock = /Clock/.test(type);
    this.interior = { type, start: Date.now(), withClock, withSong, lastSec: -1, lastPhase: -1 };
    if (withSong) {
      const songs = type.includes('SD') ? this.fileList('blocks').map((n) => this.fileLoad('blocks', n)).filter(Boolean) : [];
      const sets = songs.length ? songs : [TN.demoData()];
      const pick = sets[Math.floor(Math.random() * sets.length)];
      this.saved = this.exportAllBlocks(); this.override = { blocks: pick.blocks, index: 0 };
      if (pick.settings && pick.settings.tempo) this.state.tempo = pick.settings.tempo;
      this.resetRuntime(); this.stopPushAll();
    }
    this.onChange();
  }
  stopInterior() {
    if (!this.interior) return;
    if (this.override) { this.override = null; if (this.saved) { this.state.tempo = this.saved.settings.tempo; } this.saved = null; this.stopPushAll(); this.resetRuntime(); }
    this.interior = null; this.powerSave = false; this.onChange();
  }
  startPowerSave() { this.powerSave = true; if (this.playing) this.togglePause(); this.stopPushAll(); this.onChange(); }
  stopPowerSave() { if (!this.powerSave) return; this.powerSave = false; if (!this.playing) this.togglePause(); this.onChange(); }
  interiorTick() {
    const it = this.interior; if (!it) return;
    const d = new Date(); const sec = d.getSeconds();
    if (sec === it.lastSec) return; it.lastSec = sec;
    if (it.withSong && this.override && sec % 20 === 0) { this.override.index = (this.override.index + 1) % this.override.blocks.length; }
    if (it.withClock && d.getMinutes() === 0 && sec === 0 && this.state.timeSignal) this.playStored('tenori.timesignal', 8);
    if (it.withClock && d.getHours() === this.state.alarmHour && d.getMinutes() === this.state.alarmMinute && sec === 0 && this.state.alarm) this.playStored('tenori.alarm', 48);
  }
  playStored(key, seconds) {
    let data = null; try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
    const blocks = data ? [data] : [TN.demoData().blocks[0]];
    if (!this.saved) this.saved = this.exportAllBlocks();
    this.override = { blocks, index: 0 }; this.resetRuntime(); this.msg = { text: key.includes('alarm') ? 'Alarm Playing...' : 'Time Signal...', until: Date.now() + seconds * 1000 };
    setTimeout(() => { if (this.interior && this.interior.withSong) { this.startInterior(this.interior.type); } else if (this.override) { this.override = null; this.resetRuntime(); } }, seconds * 1000);
  }
  storeCurrentBlock(key) { try { localStorage.setItem(key, JSON.stringify(this.state.blocks[this.state.currentBlock])); return true; } catch (e) { return false; } }
};

// A small built-in demo: score melody + bass + drums, a random arpeggio, a bounce pattern.
TN.demoData = function () {
  const blocks = [TN.emptyBlock(), TN.emptyBlock()];
  const put = (b, layer, r, c) => { blocks[b].layers[layer].notes[r * 16 + c] = 1; };
  const mel = [[0, 7], [2, 9], [4, 11], [6, 12], [8, 11], [10, 9], [12, 7], [14, 9]];
  mel.forEach(([c, r]) => put(0, 0, r, c));
  [[1, 4], [3, 6], [5, 8], [7, 6], [9, 4], [11, 6], [13, 8], [15, 6]].forEach(([c, r]) => put(0, 1, r, c));
  [0, 4, 8, 12].forEach((c) => put(0, 3, 0, c)); [2, 6, 10, 14].forEach((c) => put(0, 3, 4, c));
  for (let c = 0; c < 16; c += 4) put(0, 6, 0, c); for (let c = 4; c < 16; c += 8) put(0, 6, 2, c); for (let c = 2; c < 16; c += 4) put(0, 6, 5, c);
  blocks[0].layers[7].notes = [{ r: 3, c: 3 }, { r: 10, c: 5 }, { r: 12, c: 12 }, { r: 5, c: 11 }];
  blocks[0].layers[13].entry[6] = 5; blocks[0].layers[13].entry[9] = 8;
  mel.forEach(([c, r]) => put(1, 0, Math.min(15, r + 2), c)); [0, 4, 8, 12].forEach((c) => put(1, 3, 0, c)); [2, 6, 10, 14].forEach((c) => put(1, 3, 3, c));
  for (let c = 0; c < 16; c += 2) put(1, 6, 0, c); for (let c = 1; c < 16; c += 2) put(1, 6, 5, c); for (let c = 4; c < 16; c += 8) put(1, 6, 2, c);
  blocks[1].layers[7].notes = [{ r: 3, c: 3 }, { r: 10, c: 5 }, { r: 12, c: 12 }, { r: 5, c: 11 }, { r: 8, c: 8 }];
  blocks[1].layers[13].entry[6] = 5; blocks[1].layers[13].entry[9] = 8; blocks[1].layers[13].entry[12] = 11;
  return { blocks, settings: { tempo: 96 } };
};
})();
