'use strict';
// Rendering, pointer/keyboard handling and the glue between engine, menu and DOM.
(function () {
  const TN = window.TN;
  const pad2 = (n) => String(n).padStart(2, '0');
  const audio = new TN.AudioEngine(); const engine = new TN.Engine(audio);
  const $ = (id) => document.getElementById(id);
  const canvas = $('matrix'); const ctx2d = canvas.getContext('2d');
  const lcdEl = $('lcd'); const hintEl = $('hint'); const knob = $('knob');
  const FN_KEYS = { KeyQ: 'L1', KeyW: 'L2', KeyE: 'L3', KeyR: 'L4', KeyT: 'L5', KeyY: 'R1', KeyU: 'R2', KeyI: 'R3', KeyO: 'R4', KeyP: 'R5' };
  const MODES = [['score', 'SCORE', 'L1-7'], ['random', 'RANDOM', 'L8-11'], ['draw', 'DRAW', 'L12-13'], ['bounce', 'BOUNCE', 'L14'], ['push', 'PUSH', 'L15'], ['solo', 'SOLO', 'L16']];

  const ui = {
    fn: null, fnLatched: false, fnOverlay: null, fnDown: 0, fnUsed: false, fnKey: false,
    pointers: new Map(), lastInput: Date.now(), audioReady: false, jogAngle: 0, lcdHtml: '', hintText: '', clearTimer: null, clearFired: false,
    touch() { this.lastInput = Date.now(); },
    pickFile(accept, cb) { const inp = $('fileInput'); inp.accept = accept; inp.value = ''; inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); }; inp.click(); },
    download(name, data) {
      try { const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } catch (e) { /* ignore */ }
    },
  };
  const menu = new TN.Menu(engine, ui);

  // ---- audio unlock -------------------------------------------------------------------------
  function ensureAudio() {
    if (ui.audioReady) { audio.ensure(); return; }
    if (audio.ensure()) { ui.audioReady = true; engine.syncAudio(); engine.resync(); }
  }
  function wake() {
    ui.touch();
    if (engine.interior) { engine.stopInterior(); return true; }
    if (engine.powerSave) { engine.stopPowerSave(); return true; }
    return false;
  }

  // ---- function buttons ------------------------------------------------------------------------
  function setFn(fn, latched) {
    if (ui.fn && ui.fnOverlay && ui.fnOverlay.up) ui.fnOverlay.up();
    ui.fn = fn; ui.fnLatched = !!latched; ui.fnOverlay = fn ? TN.overlayForFn(engine, fn) : null; ui.fnUsed = false;
    document.querySelectorAll('.fn').forEach((b) => b.classList.toggle('on', b.dataset.fn === fn));
  }
  document.querySelectorAll('.fn').forEach((btn) => {
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ensureAudio(); if (wake()) return;
      const fn = btn.dataset.fn;
      if (ui.fn === fn && ui.fnLatched) { setFn(null); return; }
      setFn(fn, false); ui.fnDown = performance.now(); ui.fnKey = false;
    });
    const up = () => { if (ui.fn === btn.dataset.fn && !ui.fnLatched && !ui.fnKey) { if (performance.now() - ui.fnDown < 350 && !ui.fnUsed) ui.fnLatched = true; else setFn(null); } };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', (ev) => { if (ev.buttons) up(); });
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  });

  // ---- mode buttons -------------------------------------------------------------------------
  const modesEl = $('modes');
  MODES.forEach(([mode, label, range]) => {
    const b = document.createElement('div'); b.className = 'mode'; b.dataset.mode = mode; b.innerHTML = label + '<span class="n">' + range + '</span>';
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ensureAudio(); if (wake()) return;
      const layers = TN.MODE_OF_LAYER.map((m, i) => (m === mode ? i : -1)).filter((i) => i >= 0);
      const cur = engine.state.currentLayer; const at = layers.indexOf(cur);
      engine.act('selectLayer', layers[(at + 1) % layers.length]);
      if (ui.fn) setFn(ui.fn, ui.fnLatched);
    });
    modesEl.appendChild(b);
  });

  // ---- transport buttons --------------------------------------------------------------------
  function pressOK() {
    ensureAudio(); if (wake()) return;
    if (menu.open) { menu.ok(); return; }
    if (engine.playback) { engine.stopSong(); return; }
    if (engine.recording) { menu.finishRecording(); return; }
    engine.act('togglePause');
  }
  function pressCancel() { ui.touch(); if (wake()) return; if (menu.open) { menu.cancel(); return; } if (ui.fn) setFn(null); }
  function clearDown() { ensureAudio(); if (wake()) return; ui.clearFired = false; ui.clearTimer = setTimeout(() => { ui.clearFired = true; engine.act('clearAll'); }, 700); }
  function clearUp() { if (ui.clearTimer) clearTimeout(ui.clearTimer); ui.clearTimer = null; if (!ui.clearFired) { if (menu.screen && menu.screen.type === 'undo') menu.pop(); else engine.act('clearLayer'); } }
  $('btnOk').addEventListener('pointerdown', (ev) => { ev.preventDefault(); pressOK(); });
  $('btnCancel').addEventListener('pointerdown', (ev) => { ev.preventDefault(); pressCancel(); });
  $('btnClear').addEventListener('pointerdown', (ev) => { ev.preventDefault(); clearDown(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => $('btnClear').addEventListener(t, () => { if (ui.clearTimer) clearUp(); }));
  $('btnHelp').addEventListener('click', () => { $('help').hidden = false; });
  $('btnHelpClose').addEventListener('click', () => { $('help').hidden = true; });
  $('help').addEventListener('click', (ev) => { if (ev.target === $('help')) $('help').hidden = true; });

  // ---- jog dial ------------------------------------------------------------------------------
  function jog(d) {
    ensureAudio(); if (wake()) return;
    ui.jogAngle += d * 18; knob.style.transform = 'rotate(' + ui.jogAngle + 'deg)';
    if (ui.fn && ui.fnOverlay) { ui.fnOverlay.jog(d); ui.fnUsed = true; return; }
    if (!menu.open) { menu.openMain(); return; }
    menu.jog(d);
  }
  const jogEl = $('jog'); let jogDrag = null;
  jogEl.addEventListener('wheel', (ev) => { ev.preventDefault(); jog(ev.deltaY > 0 ? 1 : -1); }, { passive: false });
  jogEl.addEventListener('pointerdown', (ev) => { ev.preventDefault(); jogEl.setPointerCapture(ev.pointerId); const r = jogEl.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; jogDrag = { cx, cy, last: Math.atan2(ev.clientY - cy, ev.clientX - cx), acc: 0 }; });
  jogEl.addEventListener('pointermove', (ev) => {
    if (!jogDrag) return; const a = Math.atan2(ev.clientY - jogDrag.cy, ev.clientX - jogDrag.cx); let d = a - jogDrag.last; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    jogDrag.last = a; jogDrag.acc += d; const stepA = Math.PI / 10;
    while (jogDrag.acc > stepA) { jogDrag.acc -= stepA; jog(1); } while (jogDrag.acc < -stepA) { jogDrag.acc += stepA; jog(-1); }
  });
  ['pointerup', 'pointercancel'].forEach((t) => jogEl.addEventListener(t, () => { jogDrag = null; }));

  // ---- keyboard --------------------------------------------------------------------------------
  window.addEventListener('keydown', (ev) => {
    if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    if (!$('help').hidden) { if (ev.key === 'Escape' || ev.key === '?') $('help').hidden = true; return; }
    if (menu.screen && menu.screen.type === 'name' && menu.keyChar(ev.key)) { ev.preventDefault(); return; }
    if (FN_KEYS[ev.code]) { ev.preventDefault(); if (!ev.repeat) { ensureAudio(); if (wake()) return; if (ui.fn === FN_KEYS[ev.code] && ui.fnLatched) return; setFn(FN_KEYS[ev.code], false); ui.fnKey = true; } return; }
    switch (ev.key) {
      case 'ArrowUp': case 'ArrowLeft': ev.preventDefault(); jog(-1); break;
      case 'ArrowDown': case 'ArrowRight': ev.preventDefault(); jog(1); break;
      case 'Enter': case ' ': ev.preventDefault(); if (!ev.repeat) pressOK(); break;
      case 'Escape': pressCancel(); break;
      case 'Backspace': case 'Delete': ev.preventDefault(); if (!ev.repeat) clearDown(); break;
      case '?': $('help').hidden = false; break;
      default: break;
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (FN_KEYS[ev.code] && ui.fn === FN_KEYS[ev.code] && ui.fnKey && !ui.fnLatched) setFn(null);
    if ((ev.key === 'Backspace' || ev.key === 'Delete') && ui.clearTimer) clearUp();
  });
  window.addEventListener('blur', () => { if (ui.fn && ui.fnKey && !ui.fnLatched) setFn(null); });

  // ---- matrix pointer handling ---------------------------------------------------------------------
  function cellAt(ev) {
    const r = canvas.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * 16; const y = (ev.clientY - r.top) / r.height * 16;
    if (x < 0 || y < 0 || x >= 16 || y >= 16) return null;
    return { c: Math.floor(x), r: 15 - Math.floor(y) };
  }
  function activeOverlay() { if (ui.fn && ui.fnOverlay) return ui.fnOverlay; if (menu.open) return menu.overlay; return null; }

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ensureAudio(); if (wake()) return;
    const cell = cellAt(ev); if (!cell) return; canvas.setPointerCapture(ev.pointerId);
    const { r, c } = cell;
    if (menu.screen && menu.screen.type === 'undo') { menu.pop(); return; }
    const ov = activeOverlay();
    if (ov) { ui.fnUsed = true; if (ui.fn) ov.press(r, c, 'down'); else menu.ledPress(r, c, 'down'); ui.pointers.set(ev.pointerId, { r, c, overlay: true }); return; }
    if (ui.fn && !ui.fnOverlay) return; // L5 in push mode: no display
    const i = engine.state.currentLayer; const mode = TN.MODE_OF_LAYER[i];
    const p = { r, c, layer: i, mode, downAt: performance.now(), timer: null, longFired: false };
    ui.pointers.set(ev.pointerId, p);
    switch (mode) {
      case 'score': case 'random': {
        if (mode === 'score' && !engine.playing) engine.act('setScorePosition', i, c);
        engine.preview(i, r, c);
        p.timer = setTimeout(() => {
          p.longFired = true;
          if (mode === 'score') engine.act('toggleScoreNote', i, r, c);
          else if (engine.state.layers[i].rotation) engine.act('stopRotation', i);
          else engine.act('toggleRandomNote', i, r, c);
        }, engine.state.pushSensitivity);
        break;
      }
      case 'draw': engine.act('drawHit', i, r, c); break;
      case 'bounce': engine.act('bouncePress', i, r, c); break;
      case 'push': engine.act('pushDown', i, r, c, ev.pointerId); break;
      case 'solo': engine.act('soloDown', i, r, c, ev.pointerId); break;
      default: break;
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = ui.pointers.get(ev.pointerId); if (!p) return;
    const cell = cellAt(ev); if (!cell || (cell.r === p.r && cell.c === p.c)) return;
    p.r = cell.r; p.c = cell.c;
    if (p.overlay) { const ov = activeOverlay(); if (ov) { if (ui.fn) ov.press(cell.r, cell.c, 'move'); else menu.ledPress(cell.r, cell.c, 'move'); } return; }
    if (p.mode === 'draw') engine.act('drawHit', p.layer, cell.r, cell.c);
    else if (p.mode === 'solo') engine.act('soloMove', ev.pointerId, cell.r, cell.c);
    else if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  });
  function pointerEnd(ev) {
    const p = ui.pointers.get(ev.pointerId); if (!p) return; ui.pointers.delete(ev.pointerId);
    if (p.overlay) { const ov = activeOverlay(); if (ov && ov.up) ov.up(); return; }
    if (p.timer) clearTimeout(p.timer);
    if (p.mode === 'push') engine.act('pushUp', p.layer, p.r, p.c);
    else if (p.mode === 'solo') engine.act('soloUp', ev.pointerId);
  }
  canvas.addEventListener('pointerup', pointerEnd); canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // ---- rendering ------------------------------------------------------------------------------------
  const lum = new Float32Array(256);
  function dist(type, dr, dc) {
    switch (type) {
      case 'Circle': return Math.sqrt(dr * dr + dc * dc);
      case 'Square': return Math.max(Math.abs(dr), Math.abs(dc));
      case 'Diamond': return Math.abs(dr) + Math.abs(dc);
      case 'Cross': return Math.abs(dr) === Math.abs(dc) ? Math.abs(dr) : 99;
      case 'Plus': return dr === 0 || dc === 0 ? Math.abs(dr) + Math.abs(dc) : 99;
      default: return 99;
    }
  }
  function ring(a, R, gain) {
    const d = Math.round(R); if (d < 0) return;
    for (let r = Math.max(0, a.r - d - 1); r <= Math.min(15, a.r + d + 1); r++) for (let c = Math.max(0, a.c - d - 1); c <= Math.min(15, a.c + d + 1); c++) {
      const dd = dist(a.type, r - a.r, c - a.c); if (dd > 98) continue;
      const w = 1 - Math.min(1, Math.abs(dd - R) / 0.9); if (w > 0) { const k = r * 16 + c; lum[k] = Math.max(lum[k], w * gain); }
    }
  }
  function computeLeds(now) {
    lum.fill(0);
    const st = engine.state; const i = st.currentLayer; const mode = TN.MODE_OF_LAYER[i]; const rt = engine.rt[i];
    if (engine.powerSave) return;
    if (engine.interior && engine.interior.withClock) { drawClock(); if (!engine.interior.withSong) return; }
    const ov = activeOverlay();
    if (ov && !engine.interior) { ov.draw(lum); return; }
    if (!engine.interior) {
      const data = engine.blockData(i);
      if (mode === 'score') {
        for (let k = 0; k < 256; k++) if (data.notes[k]) lum[k] = 0.75;
        if (st.loopIndicator) for (let r = 0; r < 16; r++) { const k = r * 16 + rt.dispCol; lum[k] = Math.max(lum[k], data.notes[k] ? 1 : 0.17); }
      } else if (mode === 'random') {
        const pts = engine.randomPositions(i, data);
        for (const p of pts) lum[p.r * 16 + p.c] = Math.max(lum[p.r * 16 + p.c], 0.7);
        if (pts.length > 1) {
          const a = pts[rt.dispSeg % pts.length], b = pts[(rt.dispSeg + 1) % pts.length];
          const len = Math.max(1, Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)));
          const frac = engine.playing ? Math.min(1, (now - rt.dispStepTime) / rt.stepDur) : 0;
          const t = Math.min(1, (rt.dispProgress + frac) / len);
          const r = Math.round(a.r + (b.r - a.r) * t), c = Math.round(a.c + (b.c - a.c) * t);
          lum[r * 16 + c] = 1;
        }
      } else if (mode === 'bounce') {
        for (let c = 0; c < 16; c++) {
          const e = data.entry[c]; if (e < 1) continue; lum[e * 16 + c] = Math.max(lum[e * 16 + c], 0.35);
          const pos = rt.dispPos[c]; if (pos == null) continue;
          lum[pos * 16 + c] = 1; const trail = pos + (rt.dir[c] > 0 ? -1 : 1); if (trail >= 0 && trail <= e) lum[trail * 16 + c] = Math.max(lum[trail * 16 + c], 0.3);
        }
      } else if (mode === 'push') {
        for (const n of data.latched) lum[n.r * 16 + n.c] = 0.8;
      }
      for (const s of engine.solo.values()) lum[s.r * 16 + s.c] = Math.max(lum[s.r * 16 + s.c], 0.9);
    }
    // push flashing: expanding, brightening rings around held/latched notes
    for (const n of engine.pushNotes.values()) {
      const age = now - n.start; const grow = Math.min(1, age / 4); const R = 1 + ((age * 1.6) % (2 + grow * 3));
      ring({ r: n.r, c: n.c, type: 'Circle' }, R, 0.35 + 0.6 * grow); lum[n.r * 16 + n.c] = 1;
    }
    for (const [k, f] of engine.flash) { if (f.until <= now) { engine.flash.delete(k); continue; } lum[k] = 1; }
    const speed = 14; const keep = [];
    for (const a of engine.anims) {
      const age = now - a.t; if (age < 0) { keep.push(a); continue; }
      if (a.type === 'VLine') { const rowUp = Math.floor(age * 45); if (rowUp > 17) continue; for (let r = Math.max(0, rowUp - 2); r <= Math.min(15, rowUp); r++) { const k = r * 16 + a.c; lum[k] = Math.max(lum[k], 1 - (rowUp - r) * 0.35); } keep.push(a); continue; }
      if (a.type === 'Simple' || a.mode === 'None') { if (age < 0.15) { lum[a.r * 16 + a.c] = 1; keep.push(a); } continue; }
      const size = a.size + 1; let R;
      if (a.mode === 'Shrink') { R = a.size - age * speed; if (R < -0.5) continue; ring(a, R, 0.55 + 0.4 * (R / size)); }
      else { R = age * speed; if (R > size) continue; ring(a, R, 0.95 * (1 - R / size) + 0.1); }
      keep.push(a);
    }
    engine.anims = keep;
  }
  const DIGITS = { 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'], 6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'], 8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'] };
  function drawClock() {
    const d = new Date(); const h = pad2(d.getHours()), m = pad2(d.getMinutes()); const s = d.getSeconds() + d.getMilliseconds() / 1000;
    const digit = (ch, top, left) => { const g = DIGITS[ch]; for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (g[y][x] === '1') lum[(top - y) * 16 + left + x] = 0.75; };
    digit(h[0], 13, 4); digit(h[1], 13, 9); digit(m[0], 6, 4); digit(m[1], 6, 9);
    const idx = Math.floor(s) % 60; let r, c;
    if (idx < 16) { r = 15; c = idx; } else if (idx < 30) { c = 15; r = 15 - (idx - 15); } else if (idx < 46) { r = 0; c = 15 - (idx - 30); } else { c = 0; r = idx - 45; }
    lum[r * 16 + c] = 1;
    const frac = s - Math.floor(s); const R = frac * 8;
    for (let rr = 0; rr < 16; rr++) for (let cc = 0; cc < 16; cc++) { const dd = Math.max(Math.abs(rr - 7.5), Math.abs(cc - 7.5)); if (Math.abs(dd - R) < 0.6) lum[rr * 16 + cc] = Math.max(lum[rr * 16 + cc], 0.25 * (1 - frac)); }
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const size = Math.round(canvas.clientWidth * dpr) || 800;
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  }
  function draw() {
    resize(); const W = canvas.width; const cell = W / 16; const rad = cell * 0.36;
    ctx2d.clearRect(0, 0, W, W);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
      const v = Math.min(1, lum[r * 16 + c]); const x = (c + 0.5) * cell, y = (15 - r + 0.5) * cell;
      if (v > 0.05) { ctx2d.fillStyle = 'rgba(255,160,40,' + (v * 0.45).toFixed(3) + ')'; ctx2d.beginPath(); ctx2d.arc(x, y, rad * (1.25 + v * 0.7), 0, 6.283); ctx2d.fill(); }
      let col;
      if (v <= 0.02) col = '#3a3129';
      else if (v < 0.5) { const t = v / 0.5; col = 'rgb(' + Math.round(58 + 197 * t) + ',' + Math.round(49 + 122 * t) + ',' + Math.round(41 - 10 * t) + ')'; }
      else { const t = (v - 0.5) / 0.5; col = 'rgb(255,' + Math.round(171 + 69 * t) + ',' + Math.round(31 + 159 * t) + ')'; }
      ctx2d.fillStyle = col; ctx2d.beginPath(); ctx2d.arc(x, y, rad, 0, 6.283); ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(0,0,0,.35)'; ctx2d.lineWidth = 1; ctx2d.stroke();
    }
  }

  // ---- LCD -----------------------------------------------------------------------------------------
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').split(TN.SEL_ON).join('<span class="sel">').split(TN.SEL_OFF).join('</span>'); }
  function fmtTime(ms) { const s = Math.floor(ms / 1000); return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60); }
  function statusLines() {
    const st = engine.state; const i = st.currentLayer; const now = new Date();
    if (engine.msg && engine.msg.until > Date.now()) { const l = engine.msg.text.split('\n'); return ['', ' ' + (l[0] || ''), ' ' + (l[1] || ''), '']; }
    if (engine.playback) { const s = engine.playback.song; return ['Song:', ' "' + (s.name || 'SONG') + '"', ' ' + (s.composer || 'NO NAME'), ' PLAY ' + fmtTime(Date.now() - engine.playback.start) + '  [OK]stop']; }
    if (engine.powerSave) return ['', ' Power Save...', '', ''];
    if (engine.interior) return [engine.interior.type, engine.override ? ' "DEMO"' : '', ' ' + st.ownerName, ' ' + now.toLocaleTimeString('en-GB')];
    const l1 = 'TENORI-ON' + (ui.audioReady ? '        [AC]' : '   (tap: sound)');
    const l2 = ' L' + pad2(i + 1) + '-' + TN.MODE_LABEL[TN.MODE_OF_LAYER[i]].padEnd(7) + ' B' + pad2(st.currentBlock + 1);
    const l3 = ' ' + TN.voiceLabel(...st.layers[i].instrument);
    const clock = engine.recording ? 'REC ' + fmtTime(Date.now() - engine.recording.startAt) : now.toLocaleTimeString('en-GB');
    const l4 = ' ' + clock.padEnd(13) + (engine.playing ? '[OK]stop' : '[OK]play');
    return [l1, l2, l3, l4];
  }
  function updateLcd() {
    let lines;
    if (ui.fn && ui.fnOverlay) lines = ui.fnOverlay.lcd(); else if (ui.fn) lines = ['Loop Speed', ' Layer[' + pad2(engine.state.currentLayer + 1) + ']', ' not available in', ' Push Mode'];
    else lines = menu.lines() || statusLines();
    const html = lines.slice(0, 4).map((t) => esc(String(t).padEnd(20))).join('\n');
    if (html !== ui.lcdHtml) { ui.lcdHtml = html; lcdEl.innerHTML = html; }
  }
  const FN_HINTS = {
    L1: 'Instrument: press an LED to pick a voice (row = category, column = voice). Jog steps through voices.',
    L2: 'Sound length: press a column, 50 ms (left) to 9990 ms (right). Jog adjusts by 10 ms.',
    L3: 'Octave: press a row. Eighth row from the bottom = 0, up to +5 / -5.',
    L5: 'Loop speed: leftmost four columns = quarter, eighth, sixteenth, thirty-second notes.',
    R1: 'Layer: press a row. Bottom row = layer 1.', R2: 'Tempo: press a column, 50 to 200 BPM. Jog for 40 to 240.',
    R3: 'Transpose: press a row, -7 to +8 semitones.', R4: 'Volume: each row is a layer, slide along it. Jog sets master volume.',
    R5: 'Block: press a column. Tap the bottom LED of the lit column to cycle dim / medium / bright, then press a destination column to move / copy layer / copy all.',
  };
  const MODE_HINTS = {
    score: '<b>Score</b>: tap an LED to audition, hold to enter a note. Time runs left to right, pitch bottom to top.',
    random: '<b>Random</b>: hold LEDs to enter notes; the light travels between them in the order entered.',
    draw: '<b>Draw</b>: press or drag across the LEDs; your gestures loop every 16 steps. CLEAR wipes the layer.',
    bounce: '<b>Bounce</b>: press an LED to drop a ball. It sounds at the bottom row. Press the bottom LED to stop a column.',
    push: '<b>Push</b>: hold an LED and listen to it change. Hold longer to keep it sounding; press again to stop.',
    solo: '<b>Solo</b>: hold an LED to repeat a note. Higher rows repeat faster; the bottom row plays once.',
  };
  function updateChrome() {
    const st = engine.state; const mode = TN.MODE_OF_LAYER[st.currentLayer];
    modesEl.querySelectorAll('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('btnOk').classList.toggle('on', !engine.playing && !menu.open);
    $('powerLight').classList.toggle('off', !!engine.powerSave);
    let hint;
    if (!ui.audioReady) hint = 'Click or tap anywhere on the instrument to enable sound.';
    else if (engine.interior) hint = 'Interior mode. Press any button to return.';
    else if (ui.fn === 'L4') hint = mode === 'random' ? 'Rotation: stroke a circle around the matrix to spin the shape. Press the same LED twice to stop.' : 'Loop point: upper half sets TOP, lower half sets END. Jog slides the range.';
    else if (ui.fn) hint = FN_HINTS[ui.fn];
    else if (menu.open) hint = 'Menu: jog to move, <b>OK</b> to select, <b>CANCEL</b> to go back.';
    else hint = MODE_HINTS[mode] + ' &nbsp;Hold <span class="kbd">Q</span>-<span class="kbd">T</span> / <span class="kbd">Y</span>-<span class="kbd">P</span> for L1-L5 / R1-R5, <span class="kbd">?</span> for help.';
    if (engine.recording) hint = '<b>Recording.</b> Press OK to stop and save the song. ' + hint;
    if (hint !== ui.hintText) { ui.hintText = hint; hintEl.innerHTML = hint; }
  }

  function frame() {
    const now = engine.now();
    engine.flushVisuals(); computeLeds(now); draw(); updateLcd(); updateChrome();
    requestAnimationFrame(frame);
  }

  // ---- idle / saver / interior ticks ---------------------------------------------------------------
  setInterval(() => {
    engine.interiorTick();
    const st = engine.state; if (!st.saverTime || engine.interior || engine.powerSave || engine.recording || engine.playback || ui.pointers.size) return;
    if (Date.now() - ui.lastInput > st.saverTime * 60000) { if (st.saverType === 'Power Save') engine.startPowerSave(); else engine.startInterior(st.interiorType); }
  }, 1000);
  document.addEventListener('pointerdown', () => ui.touch(), true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) engine.resync(); });

  // ---- boot ---------------------------------------------------------------------------------------------
  engine.loadDefault(); engine.resetRuntime(); engine.start();
  window.tenori = { engine, audio, menu, ui };
  requestAnimationFrame(frame);
})();
