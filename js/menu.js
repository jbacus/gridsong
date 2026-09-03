'use strict';
(function () {
// LCD menu system and the LED-matrix "setting displays" shared by the function buttons.
const TN = window.TN || (window.TN = {});

const pad2 = (n) => String(n).padStart(2, '0');
const LENGTHS = [50, 100, 200, 300, 400, 500, 600, 800, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 9990];
const VOLS = [0, 10, 20, 30, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 127];
const TEMPO_BOUNDS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 240];
const SPEEDS = [1, 2, 4, 8];
// LCD highlight markers, turned into <span class="sel"> by the UI.
TN.SEL_ON = '«'; TN.SEL_OFF = '»';
const colFor = (bounds, v) => { for (let i = 0; i < bounds.length; i++) if (v <= bounds[i]) return i; return 15; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const line = (buf, cells, v) => { for (const k of cells) buf[k] = Math.max(buf[k], v); };
const col = (c) => Array.from({ length: 16 }, (_, r) => r * 16 + c);
const row = (r) => Array.from({ length: 16 }, (_, c) => r * 16 + c);
const layerTag = (e) => ' Layer[' + pad2(e.state.currentLayer + 1) + ']';

// ---- LED setting displays ---------------------------------------------------------
TN.overlays = {
  instrument(e) {
    const i = e.state.currentLayer;
    return {
      lcd: () => ['Instrument', layerTag(e), '  ' + TN.voiceLabel(...e.state.layers[i].instrument), ''],
      draw: (b) => { const [cat, idx] = e.state.layers[i].instrument; line(b, row(cat - 1), 0.35); line(b, col(idx - 1), 0.35); b[(cat - 1) * 16 + idx - 1] = 1; },
      press: (r, c) => e.act('setInstrument', i, r + 1, c + 1),
      jog: (d) => { let [cat, idx] = e.state.layers[i].instrument; idx += d; if (idx > 16) { idx = 1; cat = cat % 16 + 1; } if (idx < 1) { idx = 16; cat = (cat + 14) % 16 + 1; } e.act('setInstrument', i, cat, idx); },
    };
  },
  soundLength(e) {
    const i = e.state.currentLayer;
    return {
      lcd: () => ['Sound Length', layerTag(e), '  ' + e.state.layers[i].soundLength + 'msec', ''],
      draw: (b) => line(b, col(colFor(LENGTHS, e.state.layers[i].soundLength)), 0.9),
      press: (r, c) => e.act('setSoundLength', i, LENGTHS[c]),
      jog: (d) => e.act('setSoundLength', i, e.state.layers[i].soundLength + d * 10),
    };
  },
  octave(e) {
    const i = e.state.currentLayer;
    return {
      lcd: () => ['Octave', layerTag(e), '  ' + (e.state.layers[i].octave > 0 ? '+' : '') + e.state.layers[i].octave, ''],
      draw: (b) => { line(b, row(7 + e.state.layers[i].octave), 0.9); for (let r = 2; r <= 12; r++) b[r * 16] = Math.max(b[r * 16], 0.12); },
      press: (r) => { const v = r - 7; if (v >= -5 && v <= 5) e.act('setOctave', i, v); },
      jog: (d) => e.act('setOctave', i, e.state.layers[i].octave + d),
    };
  },
  loopPoint(e, all) {
    const i = e.state.currentLayer; const L = () => e.state.layers[i];
    return {
      lcd: () => [all ? 'Master Loop Point' : 'Loop Point', all ? '' : layerTag(e), '  TOP:' + String(L().top).padStart(2) + ' / END:' + String(L().end).padStart(2), ''],
      draw: (b) => { for (let r = 8; r < 16; r++) b[r * 16 + L().top - 1] = 0.9; for (let r = 0; r < 8; r++) b[r * 16 + L().end - 1] = 0.9; },
      press: (r, c) => { const set = (t, en) => (all ? e.act('setMasterLoopPoint', t, en) : e.act('setLoopPoint', i, t, en)); if (r >= 8) set(c + 1, Math.max(c + 1, L().end)); else set(Math.min(L().top, c + 1), c + 1); },
      jog: (d) => { const len = L().end - L().top; const top = clamp(L().top + d, 1, 16 - len); if (all) e.act('setMasterLoopPoint', top, top + len); else e.act('setLoopPoint', i, top, top + len); },
    };
  },
  rotation(e) {
    const i = e.state.currentLayer; const pts = []; let lastPress = null;
    return {
      lcd: () => { const rot = e.state.layers[i].rotation; return ['Rotation', ' Layer[' + pad2(i + 1) + '] [Random]', rot ? '  ' + (rot.dir > 0 ? 'CW ' : 'CCW ') + rot.beats + ' beat' : '  none', ' stroke a circle']; },
      draw: (b) => { const d = e.blockData(i); for (const p of e.randomPositions(i, d)) b[p.r * 16 + p.c] = 0.8; },
      press: (r, c, phase) => {
        const now = performance.now(); const ang = Math.atan2(r - 7.5, c - 7.5);
        if (phase === 'down') {
          if (lastPress && lastPress.r === r && lastPress.c === c && now - lastPress.t < 700) { e.act('stopRotation', i); lastPress = null; pts.length = 0; return; }
          lastPress = { r, c, t: now }; pts.length = 0;
        }
        pts.push({ ang, t: now });
      },
      up: () => {
        if (pts.length < 3) return; let total = 0;
        for (let k = 1; k < pts.length; k++) { let d = pts[k].ang - pts[k - 1].ang; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; total += d; }
        const dt = (pts[pts.length - 1].t - pts[0].t) / 1000; if (dt < 0.05 || Math.abs(total) < 0.6) return;
        e.act('setRotation', i, total > 0 ? -1 : 1, Math.abs(total) / dt); pts.length = 0;
      },
      jog: () => {},
    };
  },
  loopSpeed(e, all) {
    const i = e.state.currentLayer;
    return {
      lcd: () => [all ? 'Master Loop Speed' : 'Loop Speed', all ? '' : layerTag(e), '  ' + (all ? e.state.masterLoopSpeed : e.state.layers[i].loopSpeed), ''],
      draw: (b) => { line(b, col(SPEEDS.indexOf(all ? e.state.masterLoopSpeed : e.state.layers[i].loopSpeed)), 0.9); for (let c = 0; c < 4; c++) b[c] = Math.max(b[c], 0.12); },
      press: (r, c) => { if (c < 4) { if (all) e.act('setMasterLoopSpeed', SPEEDS[c]); else e.act('setLoopSpeed', i, SPEEDS[c]); } },
      jog: (d) => { const cur = SPEEDS.indexOf(all ? e.state.masterLoopSpeed : e.state.layers[i].loopSpeed); const n = SPEEDS[clamp(cur + d, 0, 3)]; if (all) e.act('setMasterLoopSpeed', n); else e.act('setLoopSpeed', i, n); },
    };
  },
  layerNo(e) {
    return {
      lcd: () => ['Layer No.', '  ' + pad2(e.state.currentLayer + 1) + '-' + TN.MODE_LABEL[TN.MODE_OF_LAYER[e.state.currentLayer]], '', ''],
      draw: (b) => line(b, row(e.state.currentLayer), 0.9),
      press: (r) => e.act('selectLayer', r),
      jog: (d) => e.act('selectLayer', clamp(e.state.currentLayer + d, 0, 15)),
    };
  },
  tempo(e) {
    return {
      lcd: () => ['Master Tempo', '  BPM: ' + e.state.tempo, '', ''],
      draw: (b) => line(b, col(colFor(TEMPO_BOUNDS, e.state.tempo)), 0.9),
      press: (r, c) => e.act('setTempo', 50 + c * 10),
      jog: (d) => e.act('setTempo', e.state.tempo + d),
    };
  },
  transpose(e) {
    return {
      lcd: () => ['Master Transpose', '  ' + (e.state.transpose > 0 ? '+' : '') + e.state.transpose, '', ''],
      draw: (b) => line(b, row(7 + e.state.transpose), 0.9),
      press: (r) => e.act('setTranspose', r - 7),
      jog: (d) => e.act('setTranspose', e.state.transpose + d),
    };
  },
  volume(e) {
    const i = e.state.currentLayer;
    return {
      lcd: () => ['Volume', ' Layer[' + pad2(i + 1) + ']    : ' + String(e.state.layers[i].volume).padStart(3), ' Master       : ' + String(e.state.masterVolume).padStart(3), ''],
      draw: (b) => { for (let r = 0; r < 16; r++) { const cc = colFor(VOLS, e.state.layers[r].volume); for (let c = 0; c <= cc; c++) b[r * 16 + c] = c === cc ? (r === i ? 1 : 0.8) : 0.14; } },
      press: (r, c) => e.act('setLayerVolume', r, VOLS[c]),
      jog: (d) => e.act('setMasterVolume', e.state.masterVolume + d),
    };
  },
  block(e) {
    let level = 0; let src = e.state.currentBlock;
    const names = ['', ' copy 1 layer ->', ' copy all layers ->'];
    return {
      lcd: () => ['Block No.', layerTag(e), '  ' + pad2(e.state.currentBlock + 1), names[level]],
      draw: (b) => line(b, col(src), [0.35, 0.65, 1][level]),
      press: (r, c, phase) => {
        if (phase !== 'down') { if (level === 0) { e.act('selectBlock', c); src = c; } return; }
        if (c === src && r === 0) { level = (level + 1) % 3; return; }
        if (level === 0) { e.act('selectBlock', c); src = c; return; }
        if (level === 1) e.act('copyLayer', src, e.state.currentLayer, c, e.state.currentLayer); else e.act('copyBlock', src, c);
        e.act('selectBlock', c); src = c; level = 0;
      },
      jog: (d) => { e.act('selectBlock', clamp(e.state.currentBlock + d, 0, 15)); src = e.state.currentBlock; },
    };
  },
  destBlock(e, holder) {
    return {
      lcd: () => ['Copy this Block', ' Block[' + pad2(e.state.currentBlock + 1) + ']', ' Dest. Block: ' + pad2(holder.block + 1), ''],
      draw: (b) => line(b, col(holder.block), 0.9), press: (r, c) => { holder.block = c; }, jog: (d) => { holder.block = clamp(holder.block + d, 0, 15); },
    };
  },
  destLayer(e, holder) {
    return {
      lcd: () => ['Copy this Layer', ' Block[' + pad2(e.state.currentBlock + 1) + '] Layer[' + pad2(e.state.currentLayer + 1) + ']', ' Dest. Block: ' + pad2(holder.block + 1), ' Dest. Layer: ' + pad2(holder.layer + 1)],
      draw: (b) => { line(b, col(holder.block), 0.35); line(b, row(holder.layer), 0.35); b[holder.layer * 16 + holder.block] = 1; },
      press: (r, c) => { holder.block = c; holder.layer = r; }, jog: (d) => { holder.block = clamp(holder.block + d, 0, 15); },
    };
  },
};
TN.FN_OVERLAY = { L1: 'instrument', L2: 'soundLength', L3: 'octave', L4: 'loopPoint', L5: 'loopSpeed', R1: 'layerNo', R2: 'tempo', R3: 'transpose', R4: 'volume', R5: 'block' };
TN.overlayForFn = (e, fn) => {
  if (fn === 'L4' && TN.MODE_OF_LAYER[e.state.currentLayer] === 'random') return TN.overlays.rotation(e);
  if (fn === 'L5' && TN.MODE_OF_LAYER[e.state.currentLayer] === 'push') return null;
  return TN.overlays[TN.FN_OVERLAY[fn]](e);
};

// ---- menu ------------------------------------------------------------------------------
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const FILE_KIND = { song: 'Song', blocks: 'All Blocks', block: 'Current Block', layer: 'Current Layer', settings: 'All Settings', samplings: 'Samplings' };
const FILE_TAG = { song: 'SONG', blocks: 'BLOCKS', block: 'BLOCK', layer: 'LAYER', settings: 'SET', samplings: 'SAMPLE' };

TN.Menu = class {
  constructor(engine, ui) { this.e = engine; this.ui = ui; this.stack = []; this.userNames = ['--------', '--------', '--------']; }
  get screen() { return this.stack[this.stack.length - 1] || null; }
  get open() { return this.stack.length > 0; }
  push(s) { this.stack.push(s); this.ui.touch(); }
  pop() { this.stack.pop(); this.ui.touch(); }
  close() { this.stack = []; this.ui.touch(); }
  openMain() { this.stack = [this.mainMenu()]; }
  get overlay() { const s = this.screen; return s && s.overlay ? s.overlay : null; }

  // ---- input --------------------------------------------------------------------------
  jog(d) {
    const s = this.screen; if (!s) return;
    switch (s.type) {
      case 'list': s.sel = clamp(s.sel + d, 0, s.items.length - 1); break;
      case 'param': this.adjust(s, d); break;
      case 'fields': this.adjust(s.fields[s.idx], d); break;
      case 'confirm': s.choice = s.choice === 'OK' ? 'CANCEL' : 'OK'; break;
      case 'name': s.cur = (s.cur + d + CHARS.length + 2) % (CHARS.length + 2); break;
      case 'undo': this.pop(); break;
      default: break;
    }
    this.ui.touch();
  }
  adjust(p, d) {
    if (p.overlay && p.overlay.jog && !p.values) { p.overlay.jog(d); return; }
    if (p.values) { const i = p.values.indexOf(p.get()); p.set(p.values[clamp(i + d, 0, p.values.length - 1)]); }
    else p.set(clamp(p.get() + d * (p.step || 1), p.min, p.max));
  }
  ok() {
    const s = this.screen; if (!s) return;
    switch (s.type) {
      case 'list': { const it = s.items[s.sel]; if (it.run) it.run(); else if (it.open) { const n = it.open(); if (n) this.push(n); } break; }
      case 'param': if (s.onOK) s.onOK(); else this.pop(); break;
      case 'fields': if (s.idx < s.fields.length - 1) s.idx++; else if (s.onOK) s.onOK(); else this.pop(); break;
      case 'confirm': if (s.choice === 'OK') { this.pop(); s.run(); } else this.pop(); break;
      case 'undo': this.pop(); this.e.undo(); this.message(['', '  Undone', '', ''], null, 700); break;
      case 'name': this.nameKey(s, s.cur); break;
      case 'message': this.pop(); if (s.then) s.then(); break;
      default: break;
    }
    this.ui.touch();
  }
  cancel() {
    const s = this.screen; if (!s) return;
    if (s.restore) s.restore();
    this.pop(); if (s.type === 'message' && s.then) s.then();
  }
  ledPress(r, c, phase) {
    const s = this.screen; if (!s) return false;
    if (s.type === 'undo') { this.pop(); return true; }
    if (s.overlay && s.overlay.press) { s.overlay.press(r, c, phase); this.ui.touch(); return true; }
    return false;
  }
  keyChar(ch) {
    const s = this.screen; if (!s || s.type !== 'name') return false;
    const up = ch.toUpperCase();
    if (ch.length === 1 && CHARS.includes(up)) { if (s.text.length < 16) s.text += up; } else if (ch === 'Backspace') s.text = s.text.slice(0, -1); else if (ch === 'Enter') this.nameKey(s, CHARS.length + 1); else return false;
    this.ui.touch(); return true;
  }
  nameKey(s, k) {
    if (k < CHARS.length) { if (s.text.length < 16) s.text += CHARS[k]; }
    else if (k === CHARS.length) s.text = s.text.slice(0, -1);
    else { if (!s.text.length) return; this.pop(); s.done(s.text); }
  }

  // ---- rendering ------------------------------------------------------------------------
  lines() {
    const s = this.screen; if (!s) return null;
    const sel = (t) => TN.SEL_ON + t + TN.SEL_OFF;
    switch (s.type) {
      case 'list': {
        const start = clamp(s.sel - 2, 0, Math.max(0, s.items.length - 3)); const out = [s.title];
        for (let k = start; k < Math.min(s.items.length, start + 3); k++) out.push(k === s.sel ? sel(' ' + s.items[k].label) : ' ' + s.items[k].label);
        while (out.length < 4) out.push(''); return out;
      }
      case 'param': {
        if (s.overlay) { const l = s.overlay.lcd(); return [l[0], l[1], sel(l[2]), l[3] || '']; }
        return [s.title, s.sub ? s.sub() : '', '  ' + sel(s.fmt ? s.fmt(s.get()) : String(s.get())), s.note || ''];
      }
      case 'fields': {
        if (s.overlay) { const l = s.overlay.lcd(); return l.map((t, k) => (k === 2 + s.idx ? sel(t) : t)); }
        const out = [s.title, s.sub ? s.sub() : ''];
        s.fields.forEach((f, k) => { const v = f.fmt ? f.fmt(f.get()) : String(f.get()); out.push('  ' + f.label + (k === s.idx ? sel(v) : v)); });
        while (out.length < 4) out.push(''); return out.slice(0, 4);
      }
      case 'confirm': return [s.title, s.sub || '', s.line3 || '', '        ' + sel(s.choice)];
      case 'undo': return ['', '       ' + sel('UNDO?'), '', ''];
      case 'name': {
        const text = '[' + s.text.padEnd(16) + ']'; const k = s.cur;
        const l3 = CHARS.slice(0, 20).split('').map((ch, i) => (i === k ? sel(ch) : ch)).join('');
        const rest = CHARS.slice(20).split('').map((ch, i) => (i + 20 === k ? sel(ch) : ch)).join('');
        const l4 = rest + ' ' + (k === CHARS.length ? sel('<') : '<') + (k === CHARS.length + 1 ? sel('#') : '#');
        return [s.title, ' ' + text, l3, l4];
      }
      case 'message': return s.lines;
      default: return ['', '', '', ''];
    }
  }

  // ---- screen builders ------------------------------------------------------------------
  list(title, items) { return { type: 'list', title, items, sel: 0 }; }
  param(o) {
    const original = o.get(); const s = Object.assign({ type: 'param' }, o);
    s.restore = () => { if (s.live !== false) o.set(original); };
    return s;
  }
  confirm(title, run, opts = {}) { return Object.assign({ type: 'confirm', title, choice: 'OK', run }, opts); }
  message(lines, then, ms) { const s = { type: 'message', lines, then }; this.push(s); if (ms) setTimeout(() => { if (this.screen === s) { this.pop(); if (then) then(); } }, ms); return s; }
  undoScreen() { const s = { type: 'undo' }; this.push(s); setTimeout(() => { if (this.screen === s) this.pop(); }, 15000); }
  withUndo(run) { return () => { this.e.snapshot(); run(); this.undoScreen(); }; }
  onoff(title, key) { const e = this.e; return this.param({ title, get: () => (e.state[key] ? 'ON' : 'OFF'), set: (v) => e.setPref(key, v === 'ON'), values: ['ON', 'OFF'] }); }

  mainMenu() {
    return this.list('[Main menu]', [
      { label: '1 Play menu', open: () => this.playMenu() }, { label: '2 Layer menu', open: () => this.layerMenu() },
      { label: '3 Edit menu', open: () => this.editMenu() }, { label: '4 Preference menu', open: () => this.prefMenu() },
      { label: '5 File menu', open: () => this.fileMenu() }, { label: '6 Effect menu', open: () => this.effectMenu() },
      { label: '7 Interior menu', open: () => this.interiorMenu() }, { label: '8 System menu', open: () => this.systemMenu() },
      { label: '9 Recording menu', open: () => this.recordingMenu() },
    ]);
  }
  playMenu() {
    const e = this.e;
    return this.list('[Play menu]', [
      { label: 'Hardware Volume', open: () => this.param({ title: 'Hardware Volume', get: () => e.state.hardwareVolume, set: (v) => e.setHardwareVolume(v), min: 0, max: 127 }) },
      { label: 'Master Tempo', open: () => this.param({ title: 'Master Tempo', overlay: TN.overlays.tempo(e), get: () => e.state.tempo, set: (v) => e.setTempo(v), min: 40, max: 240 }) },
      { label: 'Master Scale', open: () => this.param({ title: 'Master Scale', get: () => e.state.scale, set: (v) => e.setScale(v), values: TN.SCALE_NAMES }) },
      { label: 'Master Transpose', open: () => this.param({ title: 'Master Transpose', overlay: TN.overlays.transpose(e), get: () => e.state.transpose, set: (v) => e.setTranspose(v), min: -7, max: 8 }) },
      { label: 'Master Loop Speed', open: () => this.param({ title: 'Master Loop Speed', overlay: TN.overlays.loopSpeed(e, true), get: () => e.state.masterLoopSpeed, set: (v) => e.setMasterLoopSpeed(v), values: SPEEDS }) },
      { label: 'Master Loop Point', open: () => this.param({ title: 'Master Loop Point', overlay: TN.overlays.loopPoint(e, true), get: () => 0, set: () => {}, live: false }) },
      { label: 'Reset Loop Timing', open: () => this.confirm('Reset Loop Timing', () => e.act('resetLoopTiming')) },
      { label: 'Mute', open: () => this.param({ title: 'Mute', get: () => (e.state.mute ? 'ON' : 'OFF'), set: (v) => e.setMute(v === 'ON'), values: ['ON', 'OFF'] }) },
    ]);
  }
  layerMenu() {
    const e = this.e; const i = e.state.currentLayer; const L = e.state.layers[i];
    return this.list('[Layer menu]', [
      { label: 'Instrument', open: () => this.param({ title: 'Instrument', overlay: TN.overlays.instrument(e), get: () => L.instrument.join('/'), set: () => {}, live: false }) },
      { label: 'Volume', open: () => this.param({ title: 'Volume', overlay: TN.overlays.volume(e), get: () => L.volume, set: (v) => e.setLayerVolume(i, v), min: 0, max: 127 }) },
      { label: 'Loop Speed', open: () => this.param({ title: 'Loop Speed', overlay: TN.overlays.loopSpeed(e), get: () => L.loopSpeed, set: (v) => e.setLoopSpeed(i, v), values: SPEEDS }) },
      { label: 'Sound Length', open: () => this.param({ title: 'Sound Length', overlay: TN.overlays.soundLength(e), get: () => L.soundLength, set: (v) => e.setSoundLength(i, v), min: 10, max: 9990, step: 10 }) },
      { label: 'Panpot', open: () => this.param({ title: 'Panpot', sub: () => layerTag(e), get: () => L.pan, set: (v) => e.setPan(i, v), min: -64, max: 63, fmt: (v) => (v === 0 ? 'CENTER' : v < 0 ? 'L' + pad2(-v) : 'R' + pad2(v)) }) },
      { label: 'Animation', open: () => {
        const a = L.anim; const orig = { ...a };
        return { type: 'fields', title: 'Animation', sub: () => layerTag(e), idx: 0, fields: [
          { label: 'Type:', get: () => a.type, set: (v) => e.setAnim(i, v), values: TN.ANIM_TYPES.concat(i === 15 ? ['VLine'] : []) },
          { label: 'Size:', get: () => a.size, set: (v) => e.setAnim(i, null, v), min: 1, max: 22, fmt: (v) => v + ' ' },
          { label: 'Mode:', get: () => a.mode, set: (v) => e.setAnim(i, null, null, v), values: ['Expand', 'Shrink', 'Pulse', 'None'] },
        ], restore: () => Object.assign(a, orig) };
      } },
    ]);
  }
  editMenu() {
    const e = this.e; const b = e.state.currentBlock; const i = e.state.currentLayer;
    return this.list('[Edit menu]', [
      { label: 'Copy this Block', open: () => { const h = { block: (b + 1) % 16 }; return this.param({ title: 'Copy this Block', overlay: TN.overlays.destBlock(e, h), get: () => h.block, set: () => {}, live: false, onOK: () => { this.pop(); this.withUndo(() => e.act('copyBlock', b, h.block))(); } }); } },
      { label: 'Clear this Block', open: () => this.confirm('Clear this Block', this.withUndo(() => e.act('clearBlock', b)), { sub: ' Block[' + pad2(b + 1) + ']' }) },
      { label: 'Copy this Layer', open: () => { const h = { block: (b + 1) % 16, layer: i }; return this.param({ title: 'Copy this Layer', overlay: TN.overlays.destLayer(e, h), get: () => h.block, set: () => {}, live: false, onOK: () => {
        this.pop(); if (TN.MODE_OF_LAYER[h.layer] !== TN.MODE_OF_LAYER[i]) { this.message(['Mode different.', "Can't copy!", '', ''], null); return; }
        this.withUndo(() => e.act('copyLayer', b, i, h.block, h.layer))(); } }); } },
      { label: 'Clear this Layer', open: () => this.confirm('Clear this Layer', this.withUndo(() => e.act('clearLayer', i, b)), { sub: ' Block[' + pad2(b + 1) + '] Layer[' + pad2(i + 1) + ']' }) },
      { label: 'Clear All Blocks', open: () => this.confirm('Clear All Blocks', this.withUndo(() => e.act('clearAll'))) },
      { label: 'Reset All Blocks', open: () => this.confirm('Reset All Blocks', this.withUndo(() => e.act('resetAll'))) },
    ]);
  }
  prefMenu() {
    const e = this.e;
    return this.list('[Preference menu]', [
      { label: 'Quantize', open: () => this.onoff('Quantize', 'quantize') },
      { label: 'Push Sensitivity', open: () => this.param({ title: 'Push Sensitivity', get: () => e.state.pushSensitivity, set: (v) => e.setPref('pushSensitivity', v), min: 50, max: 500, step: 10, fmt: (v) => v + 'msec' }) },
      { label: 'Master Tuning', open: () => this.param({ title: 'Master Tuning', get: () => e.state.masterTuning, set: (v) => e.setPref('masterTuning', v), min: -100, max: 100, fmt: (v) => v + 'CENT' }) },
      { label: 'Local Control', open: () => this.onoff('Local Control', 'localControl') },
      { label: 'Synchronize', open: () => this.param({ title: 'Synchronize', get: () => e.state.sync || 'MASTER', set: (v) => { e.state.sync = v; }, values: ['MASTER', 'SLAVE'], note: ' (no MIDI in browser)' }) },
      { label: 'Loop Indicator', open: () => this.onoff('Loop Indicator', 'loopIndicator') },
    ]);
  }
  effectMenu() {
    const e = this.e;
    return this.list('[Effect menu]', [
      { label: 'Reverb Type', open: () => this.param({ title: 'Reverb Type', get: () => e.state.reverbType, set: (v) => e.setReverb(v, null), values: TN.REVERB_TYPES }) },
      { label: 'Reverb Param', open: () => this.param({ title: 'Reverb:' + e.state.reverbType, get: () => e.state.reverbParam, set: (v) => e.setReverb(null, v), min: 0, max: 127, fmt: (v) => 'Param ' + v }) },
      { label: 'Chorus Type', open: () => this.param({ title: 'Chorus Type', get: () => e.state.chorusType, set: (v) => e.setChorus(v, null), values: TN.CHORUS_TYPES }) },
      { label: 'Chorus Param', open: () => this.param({ title: 'Chorus:' + e.state.chorusType, get: () => e.state.chorusParam, set: (v) => e.setChorus(null, v), min: 0, max: 127, fmt: (v) => 'Param ' + v }) },
    ]);
  }
  interiorMenu() {
    const e = this.e;
    return this.list('[Interior menu]', [
      { label: 'Interior START', open: () => this.confirm('Interior START', () => { e.state.saverType = 'Interior'; this.close(); e.startInterior(e.state.interiorType); }) },
      { label: 'Interior Type', open: () => this.param({ title: 'Interior Type', get: () => e.state.interiorType, set: (v) => { e.state.interiorType = v; }, values: ['Song (DEMO)', 'Song (SD)', 'Clock', 'Clock+Song (DEMO)', 'Clock+Song (SD)'] }) },
      { label: 'Saver Type', open: () => this.param({ title: 'Saver Type', get: () => e.state.saverType, set: (v) => { e.state.saverType = v; }, values: ['Interior', 'Power Save'] }) },
      { label: 'Saver Time', open: () => this.param({ title: 'Saver Time', get: () => e.state.saverTime, set: (v) => { e.state.saverTime = v; }, min: 0, max: 1440, fmt: (v) => (v === 0 ? 'OFF' : v + ' min') }) },
      { label: 'Time Signal ON/OFF', open: () => this.onoff('Time Signal', 'timeSignal') },
      { label: 'Alarm ON/OFF', open: () => this.onoff('Alarm', 'alarm') },
      { label: 'Set Alarm', open: () => ({ type: 'fields', title: 'Set Alarm', idx: 0, fields: [
        { label: 'Hour: ', get: () => e.state.alarmHour, set: (v) => { e.state.alarmHour = v; }, min: 0, max: 23, fmt: pad2 },
        { label: 'Min:  ', get: () => e.state.alarmMinute, set: (v) => { e.state.alarmMinute = v; }, min: 0, max: 59, fmt: pad2 }] }) },
      { label: 'Save As Time Signal', open: () => this.confirm('SaveAs Time Signal', () => { e.storeCurrentBlock('tenori.timesignal'); this.message(['', '  Saving...', '', ''], null, 600); }) },
      { label: 'Save As Alarm', open: () => this.confirm('SaveAs Alarm', () => { e.storeCurrentBlock('tenori.alarm'); this.message(['', '  Saving...', '', ''], null, 600); }) },
      { label: 'Clock Adjust', open: () => ({ type: 'message', lines: ['Clock Adjust', ' Uses the browser', ' clock:', ' ' + new Date().toLocaleTimeString()] }) },
    ]);
  }
  systemMenu() {
    const e = this.e;
    return this.list('[System menu]', [
      { label: 'SaveAs Default', open: () => this.confirm('SaveAs Default', () => { e.saveDefault(); this.message(['', '  Saving...', '', ''], null, 600); }) },
      { label: 'SD Format', open: () => this.confirm('SD Format', () => { e.saveFiles({}); this.message(['', '  Formatting...', '', ''], null, 800); }, { sub: ' (browser storage)' }) },
      { label: 'Owner Name', open: () => ({ type: 'name', title: 'Input Owner Name', text: e.state.ownerName, cur: 0, done: (t) => { e.state.ownerName = t; } }) },
      { label: 'Version Check', open: () => ({ type: 'message', lines: ['Version Check', ' GRIDSONG Ver.1.00', ' web simulation', ''] }) },
      { label: 'Factory Reset', open: () => this.confirm('Factory Reset', () => { e.factoryReset(); this.close(); }) },
    ]);
  }
  recordingMenu() {
    const e = this.e;
    return { type: 'confirm', title: '[Recording menu]', choice: 'OK', run: () => { this.close(); e.startRecording(); }, sub: '       START' };
  }
  /** Called from OK on the status display while recording. */
  finishRecording() {
    const song = this.e.stopRecording(); if (!song) return;
    this.stack = [this.confirm('Save this Song?', () => this.saveAs('song', song))];
  }

  // ---- file menu ----------------------------------------------------------------------------
  fileMenu() {
    return this.list('[File menu]', Object.keys(FILE_KIND).map((k) => ({ label: FILE_KIND[k], open: () => this.fileOps(k) })));
  }
  defaultName(kind) {
    const d = new Date(); const h = '0123456789ABCDEFGHIJKLMN'[d.getHours()];
    const base = pad2(d.getMonth() + 1) + pad2(d.getDate()) + h + '-' + FILE_TAG[kind] + '-';
    let n = 1; while (this.e.fileExists(kind, base + pad2(n))) n++; return base + pad2(n);
  }
  fileOps(kind) {
    const e = this.e; const title = kind === 'block' ? 'Block[' + pad2(e.state.currentBlock + 1) + ']:' : kind === 'layer' ? 'Layer[' + pad2(e.state.currentLayer + 1) + ']:' : FILE_KIND[kind] + ':';
    const ops = kind === 'song' ? ['Load', 'Rename', 'Delete', 'Export', 'Import'] : kind === 'samplings' ? ['Load', 'Info', 'Delete'] : ['Load', 'Save', 'Rename', 'Delete', 'Export', 'Import'];
    const holder = { op: ops[0] };
    return this.param({ title, get: () => holder.op, set: (v) => { holder.op = v; }, values: ops, fmt: (v) => 'Operation: ' + v, live: false, onOK: () => this.runFileOp(kind, holder.op, title) });
  }
  runFileOp(kind, op, title) {
    const e = this.e;
    if (kind === 'samplings') {
      if (op === 'Info') { this.message(['Samplings: Info', ' 1.' + this.userNames[0], ' 2.' + this.userNames[1], ' 3.' + this.userNames[2]], null); return; }
      const holder = { slot: 0 };
      this.push(this.param({ title: 'Samplings: ' + op, get: () => holder.slot, set: (v) => { holder.slot = v; }, min: 0, max: 2, fmt: (v) => 'Dest.= User' + (v + 1), live: false, onOK: () => {
        this.pop();
        if (op === 'Delete') { e.audio.userBuffers[holder.slot] = null; this.userNames[holder.slot] = '--------'; this.message(['', '  Executing...', '', ''], null, 500); return; }
        this.ui.pickFile('audio/*,.wav,.aif,.aiff,.mp3,.ogg', async (file) => {
          const m = this.message(['Samplings:', ' "' + file.name.slice(0, 16) + '"', '', '  Loading...'], null);
          try { await e.audio.loadUserVoice(holder.slot, await file.arrayBuffer()); this.userNames[holder.slot] = file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 16); if (this.screen === m) this.pop(); }
          catch (err) { if (this.screen === m) this.pop(); this.message(['SD Card Error!', ' Not Supported File.', '', ''], null); }
        });
      } }));
      return;
    }
    const exporters = { blocks: () => e.exportAllBlocks(), block: () => e.exportBlock(), layer: () => e.exportLayer(), settings: () => e.settingsData() };
    const importers = { song: (d) => { e.playSong(d); this.close(); }, blocks: (d) => e.importAllBlocks(d), block: (d) => e.importBlock(d), layer: (d) => e.importLayer(d), settings: (d) => e.applySettings(d) };
    if (op === 'Save') { this.saveAs(kind, exporters[kind]()); return; }
    if (op === 'Export') {
      const names = e.fileList(kind);
      if (kind === 'song') { if (!names.length) { this.message(['SD Card Error!', ' No files.', '', ''], null); return; } this.push(this.list(title + ' Export', names.map((n) => ({ label: n, run: () => { this.ui.download(n + '.gridsong-song.json', e.fileLoad(kind, n)); this.message(['', '  Exported', '', ''], null, 800); } })))); }
      else { this.ui.download(this.defaultName(kind) + '.gridsong-' + kind + '.json', exporters[kind]()); this.message(['', '  Exported', ' (download)', ''], null, 900); }
      return;
    }
    if (op === 'Import') { this.ui.pickFile('.json,application/json', async (file) => { try { const d = JSON.parse(await file.text()); importers[kind](d); this.message(['', '  Loading...', '', ''], null, 600); } catch (err) { this.message(['SD Card Error!', ' The File is Broken.', '', ''], null); } }); return; }
    const names = e.fileList(kind);
    if (!names.length) { this.message(['SD Card Error!', ' No files.', '', ''], null); return; }
    this.push(this.list(title + ' ' + op, names.map((n) => ({ label: n, run: () => {
      if (op === 'Load') {
        const d = e.fileLoad(kind, n); if (kind === 'song') d.name = n;
        const m = this.message(['', ' "' + n + '"', '', '  Loading...'], null);
        setTimeout(() => { if (this.screen === m) this.pop(); const ok = importers[kind](d); if (kind === 'layer' && ok === false) this.message(['SD Card Error!', ' Mode is Different.', '', ''], null); else if (kind !== 'song') { this.pop(); if (!e.playing) e.togglePause(); } }, 300);
      } else if (op === 'Rename') {
        this.push({ type: 'name', title: 'Input File Name', text: n, cur: 0, done: (t) => { e.fileRename(kind, n, t); this.pop(); this.message(['', '  Executing...', '', ''], null, 500); } });
      } else if (op === 'Delete') {
        this.push(this.confirm('Delete', () => { e.fileDelete(kind, n); this.pop(); this.message(['', '  Executing...', '', ''], null, 500); }, { sub: ' "' + n + '"' }));
      }
    } }))));
  }
  saveAs(kind, data) {
    const e = this.e;
    this.push({ type: 'name', title: 'Input File Name', text: this.defaultName(kind), cur: CHARS.length + 1, done: (name) => {
      const doSave = () => { e.fileSave(kind, name, data); this.message(['', ' "' + name + '"', '', '  Saving...'], null, 600); };
      if (e.fileExists(kind, name)) this.push(this.confirm(FILE_KIND[kind], doSave, { sub: ' "' + name + '"', line3: '  Already Exists!  Overwrite?' })); else doSave();
    } });
  }
};
})();
