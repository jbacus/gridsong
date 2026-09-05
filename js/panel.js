// Panel chrome: scales the chassis to fit the viewport (or the iframe it is embedded in) and draws the
// pulled-out control labels with leader lines around it, in the style of a hardware overview drawing.
(function () {
  'use strict';
  const html = document.documentElement;
  const stage = document.getElementById('stage'), wrap = document.getElementById('deviceWrap'), device = wrap.firstElementChild;
  const footer = document.querySelector('.footer'), svg = document.getElementById('leaders'), labelsEl = document.getElementById('labels');
  const btnLabels = document.getElementById('btnLabels');
  const NS = 'http://www.w3.org/2000/svg';

  const embedded = (function () { try { return window.self !== window.top; } catch (e) { return true; } })() || /[?&]embed\b/.test(location.search);
  if (embedded) html.classList.add('embed');

  // Labels default on when standalone and off when embedded; the HELP switch under the chassis toggles them.
  let labelsOn = !embedded;
  try { const v = localStorage.getItem('tenori.help'); if (v === 'on' || v === 'off') labelsOn = v === 'on'; } catch (e) { /* private mode */ }

  // side: which margin the label sits in. k: the printed key on the body. web: not on the original instrument.
  const CALLOUTS = [
    { sel: '[data-fn=L1]', side: 'left', k: 'L1', text: 'Changing voices', sub: 'Crosshair on the 16 × 16 voice grid' },
    { sel: '[data-fn=L2]', side: 'left', k: 'L2', text: 'Changing note length', sub: 'Gate time, 50 ms to 9990 ms' },
    { sel: '[data-fn=L3]', side: 'left', k: 'L3', text: 'Changing octaves', sub: '−5 to +5' },
    { sel: '[data-fn=L4]', side: 'left', k: 'L4', text: 'Changing loop points', sub: 'Rotation in Random mode' },
    { sel: '[data-fn=L5]', side: 'left', k: 'L5', text: 'Changing loop speed', sub: 'Quarter to thirty-second notes' },
    { sel: '#modes', side: 'left', text: 'Mode shortcuts', sub: 'Jump between layers by mode · web only', web: true },
    { sel: '#jog', side: 'left', text: 'Jog scroller', sub: 'Drag up or down, or scroll: menus and values' },
    { sel: '[data-fn=R1]', side: 'right', k: 'R1', text: 'Switching layers', sub: 'Sixteen layers, one mode each' },
    { sel: '[data-fn=R2]', side: 'right', k: 'R2', text: 'Changing tempo', sub: '50 to 200 BPM, jog for 40 to 240' },
    { sel: '[data-fn=R3]', side: 'right', k: 'R3', text: 'Transposition', sub: '−7 to +8 semitones' },
    { sel: '[data-fn=R4]', side: 'right', k: 'R4', text: 'Changing the layer volume' },
    { sel: '[data-fn=R5]', side: 'right', k: 'R5', text: 'Switching blocks', sub: 'Sixteen blocks of sixteen layers' },
    { sel: '#matrixWrap', side: 'right', text: 'LED buttons', sub: '16 × 16 matrix', at: 0.62 },
    { sel: '#btnPower', side: 'right', text: 'Power', sub: 'Press to switch the instrument off and on' },
    { sel: '#btnOk', side: 'right', k: 'OK', text: 'Play, pause, confirm' },
    { sel: '#btnCancel', side: 'right', k: 'CANCEL', text: 'Back, release a button' },
    { sel: '#btnClear', side: 'top', k: 'CLEAR', text: 'Clear layer · hold for all' },
    { sel: '#lcd', side: 'bottom', text: 'Display', sub: 'Layer, block, voice, clock, menus' },
  ];
  CALLOUTS.forEach((c) => {
    c.el = document.querySelector(c.sel);
    const d = document.createElement('div'); d.className = 'callout c-' + c.side + (c.web ? ' c-web' : '');
    d.innerHTML = (c.k ? '<span class="k">' + c.k + '</span>' : '') + c.text + (c.sub ? '<span class="sub">' + c.sub + '</span>' : '');
    labelsEl.appendChild(d); c.label = d;
  });

  function line(pts, cls) {
    const p = document.createElementNS(NS, 'polyline'); p.setAttribute('points', pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '));
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'var(--hi)'); p.setAttribute('stroke-width', '1'); if (cls) p.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(p);
  }
  function dot(x, y) {
    const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '2.6'); c.setAttribute('fill', 'var(--hi)');
    svg.appendChild(c);
  }

  function drawLabels() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const S = stage.getBoundingClientRect(); const cs = getComputedStyle(stage);
    const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight), padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
    svg.setAttribute('viewBox', '0 0 ' + S.width + ' ' + S.height);
    const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height }; };
    const GAP = 26; // label height plus breathing room when leaders have to fan out
    ['left', 'right'].forEach((side) => {
      const items = CALLOUTS.filter((c) => c.side === side).map((c) => { const r = rel(c.el); return { c, r, ty: r.y + r.h * (c.at || 0.5) }; }).sort((a, b) => a.ty - b.ty);
      let last = -Infinity;
      items.forEach((it) => {
        const lh = it.c.label.offsetHeight;
        let ly = it.ty; if (ly - lh < last + 6) ly = last + 6 + lh; last = ly; it.ly = ly;
      });
      // If the fan pushed labels below the stage, shift the whole column up as one.
      const over = last - (S.height - 4); if (over > 0) items.forEach((it) => { it.ly -= over; });
      items.forEach((it) => {
        const { c, r, ty } = it; const ly = it.ly;
        const tx = side === 'left' ? r.x - 4 : r.x + r.w + 4;
        const lx = side === 'left' ? padL - 22 : S.width - padR + 22;   // end of the label underline
        const bx = side === 'left' ? tx - 30 : tx + 30;                   // elbow
        c.label.style.top = (ly - c.label.offsetHeight) + 'px';
        if (side === 'left') { c.label.style.left = ''; c.label.style.right = (S.width - lx) + 'px'; } else { c.label.style.right = ''; c.label.style.left = lx + 'px'; }
        line(Math.abs(ly - ty) < 0.5 ? [[lx, ly], [tx, ty]] : [[lx, ly], [bx, ly], [tx, ty]], c.web);
        dot(tx, ty);
      });
    });
    CALLOUTS.filter((c) => c.side === 'top' || c.side === 'bottom').forEach((c) => {
      const r = rel(c.el); const tx = r.x + r.w / 2; const top = c.side === 'top';
      const ty = top ? r.y - 4 : r.y + r.h + 4;
      const lh = c.label.offsetHeight, lw = c.label.offsetWidth;
      const ly = top ? padT - 26 : S.height - padB + 26 + lh;  // underline y
      c.label.style.left = (tx - lw / 2) + 'px'; c.label.style.right = ''; c.label.style.top = (ly - lh) + 'px';
      line([[tx, ly], [tx, ty]]); dot(tx, ty);
    });
  }

  let raf = 0;
  function layout() {
    raf = 0;
    const vw = window.innerWidth, vh = window.innerHeight;
    const showLabels = labelsOn && vw >= 700;
    html.classList.toggle('labels', showLabels); html.classList.toggle('narrow', vw < 700);
    btnLabels.setAttribute('aria-pressed', String(labelsOn));
    if (showLabels) {
      // Side margins are as wide as the widest label plus its leader, so nothing is clipped at the viewport edge.
      let maxW = 0; CALLOUTS.forEach((c) => { if (c.side === 'left' || c.side === 'right') maxW = Math.max(maxW, c.label.offsetWidth); });
      stage.style.setProperty('--label-pad', Math.min(Math.max(maxW + 36, 200), Math.floor(vw * 0.36)) + 'px');
    }
    const cs = getComputedStyle(stage);
    const availW = vw - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
    wrap.style.transform = ''; wrap.style.height = '';
    const natW = device.offsetWidth, natH = device.offsetHeight;
    let s = Math.min(1, availW / natW);
    if (embedded) s = Math.min(s, (vh - footer.offsetHeight - 30) / natH);
    s = Math.max(s, 0.3);
    wrap.style.transform = 'scale(' + s.toFixed(4) + ')'; wrap.style.height = (natH * s) + 'px';
    footer.style.maxWidth = Math.max(320, natW * s) + 'px';
    if (showLabels) drawLabels();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(layout); }
  window.addEventListener('resize', schedule);
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(footer);
  btnLabels.addEventListener('click', () => { labelsOn = !labelsOn; try { localStorage.setItem('tenori.help', labelsOn ? 'on' : 'off'); } catch (e) { /* ignore */ } layout(); });

  // Light / dark: the house-style text switch. The class is applied before paint by the inline script in index.html.
  const themeBtns = document.querySelectorAll('[data-theme]');
  function syncTheme() { const dark = html.classList.contains('theme-dark'); themeBtns.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.theme === 'dark') === dark))); }
  themeBtns.forEach((b) => b.addEventListener('click', () => {
    html.classList.toggle('theme-dark', b.dataset.theme === 'dark'); try { localStorage.setItem('commonplace.theme', b.dataset.theme); } catch (e) { /* ignore */ } syncTheme();
  }));
  syncTheme();
  layout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  setTimeout(schedule, 300);
})();
