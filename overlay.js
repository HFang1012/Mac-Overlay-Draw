const displayId = new URLSearchParams(location.search).get('id');
const cv = document.getElementById('ink');
const ctx = cv.getContext('2d');
const wheelEl = document.getElementById('wheel');
const badge = document.getElementById('badge');
const ring = document.getElementById('ring');
const SMOOTH = getComputedStyle(document.documentElement).getPropertyValue('--smooth').trim();

let state = { activeTool: null, visible: true, settings: null };
let strokes = [];
let live = null;
let menu = null; // { x, y, items, hover }
let leaveTimer = null;
let penKey = false; // the draw key is holding the pen down

// ---------- ink ----------
function resize() {
  const dpr = devicePixelRatio || 1;
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}
function pen(s) {
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.tool === 'eraser' ? '#000' : s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}
function drawStroke(s) {
  const p = s.points;
  if (!p.length) return;
  pen(s);
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
  // Midpoint quadratic smoothing: each point is a control point, curves pass through midpoints.
  for (let i = 1; i < p.length - 1; i++) {
    ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
  }
  if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  ctx.stroke();
}
function wipe() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.restore();
}
function redraw() {
  wipe();
  strokes.forEach(drawStroke);
  if (live) drawStroke(live);
}

// One stroke, fed by the mouse button or by the draw key. Both end in finish().
function begin(x, y) {
  if (!state.activeTool) return;
  const s = state.settings;
  live = {
    tool: state.activeTool,
    color: s.pencilColor,
    size: state.activeTool === 'eraser' ? s.eraserSize : s.pencilSize,
    points: [[x, y]],
  };
  drawStroke(live);
  ring.classList.add('down');
}
function extend(x, y) {
  if (!live) return;
  const last = live.points[live.points.length - 1];
  if (Math.hypot(x - last[0], y - last[1]) < 1) return;
  live.points.push([x, y]);
  // Draw just the newest segment while the pen is down; the smooth version is drawn on release.
  pen(live);
  ctx.beginPath();
  ctx.moveTo(last[0], last[1]);
  ctx.lineTo(x, y);
  ctx.stroke();
}
function finish() {
  ring.classList.remove('down');
  if (!live) return;
  live.points = live.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  strokes.push(live);
  scrawl.send('stroke:add', displayId, live);
  live = null;
  redraw();
}

cv.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { scrawl.send('tool:drop'); return; }
  if (e.button !== 0 || penKey) return;
  cv.setPointerCapture(e.pointerId);
  begin(e.clientX, e.clientY);
});
cv.addEventListener('pointermove', (e) => {
  if (!live || penKey) return;
  for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) extend(ev.clientX, ev.clientY);
});
cv.addEventListener('pointerup', () => { if (!penKey) finish(); });
cv.addEventListener('pointercancel', () => { if (!penKey) finish(); });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- drawing animations ----------
// Hide: the ink blurs and sinks away (it's kept). Show: it sharpens back into place.
let shownVisible = null;
function setVisible(v, animate) {
  if (shownVisible === v) return;
  shownVisible = v;
  cv.getAnimations().forEach((a) => a.cancel());
  if (!animate) { cv.style.opacity = v ? 1 : 0; return; }
  if (v) {
    cv.style.opacity = 1;
    cv.animate([
      { opacity: 0, filter: 'blur(12px)', transform: 'scale(1.02)' },
      { opacity: 1, filter: 'blur(0px)', transform: 'none' },
    ], { duration: 560, easing: SMOOTH });
  } else {
    cv.animate([
      { opacity: 1, filter: 'blur(0px)', transform: 'none' },
      { opacity: 0, filter: 'blur(12px)', transform: 'scale(0.975)' },
    ], { duration: 460, easing: 'cubic-bezier(.45,0,.7,.4)', fill: 'forwards' }).finished
      .then((a) => { if (!shownVisible) cv.style.opacity = 0; a?.cancel?.(); })
      .catch(() => {});
  }
}

// ---------- stroke animations: clear, undo, redo ----------
// `strokes` always holds the final state right away; these only change what's painted meanwhile.
// 'out' strokes rewind from their end (thinning as they go); 'in' strokes draw themselves on.
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let animToken = 0;
function animateStrokes(fixed, moving, dir, total, newestFirst) {
  const token = ++animToken;
  const n = moving.length;
  if (!n) { redraw(); return; }
  const t0 = performance.now();
  const frame = (now) => {
    if (token !== animToken) return; // a newer animation took over
    const t = (now - t0) / total;
    wipe();
    fixed.forEach(drawStroke);
    moving.forEach((s, i) => {
      const order = newestFirst ? n - 1 - i : i;
      const start = n > 1 ? (order / (n - 1)) * 0.45 : 0;
      const p = easeInOut(Math.min(1, Math.max(0, (t - start) / (n > 1 ? 0.55 : 1))));
      const amount = dir === 'out' ? 1 - p : p;
      if (amount <= 0) return;
      const count = Math.max(1, Math.ceil(s.points.length * amount));
      drawStroke({ ...s, points: s.points.slice(0, count), size: s.size * (0.5 + 0.5 * amount) });
    });
    if (live) drawStroke(live);
    if (t < 1) requestAnimationFrame(frame);
    else redraw();
  };
  requestAnimationFrame(frame);
}
const strokeTime = (n) => Math.min(1000, 480 + n * 10);

// Clear: every stroke rewinds, newest first.
function rewindClear() {
  const list = strokes;
  strokes = [];
  animateStrokes([], list, 'out', strokeTime(list.length), true);
}
// Undo: the last stroke rewinds. Redo: it draws itself back on.
function undoStroke() {
  const s = strokes.pop();
  if (s) animateStrokes(strokes, [s], 'out', 380);
}
function redoStroke(s) {
  const before = strokes.slice();
  strokes.push(s);
  animateStrokes(before, [s], 'in', 420);
}
// Undoing a Clear all: everything draws itself back, oldest first.
function restoreStrokes(list) {
  strokes = list;
  animateStrokes([], list, 'in', strokeTime(list.length), false);
}

// ---------- tool chip and area circle ----------
// macOS only lets the active app change the cursor, and this layer never becomes active
// (your own app keeps focus). So the chip and the area circle are drawn on the layer itself,
// moved straight from raw pointer events.
const chipCache = new Map();
function chipArt(tool) {
  if (chipCache.has(tool)) return chipCache.get(tool);
  const chip = 18, W = chip, H = chip + 2, scale = 2;
  const can = document.createElement('canvas');
  can.width = W * scale; can.height = H * scale;
  const g = can.getContext('2d');
  g.scale(scale, scale);
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  rr(0, 2, chip, chip, 6); g.fillStyle = tool === 'pencil' ? '#D96F8A' : '#C6CFDB'; g.fill();
  rr(0, 0, chip, chip, 6); g.fillStyle = tool === 'pencil' ? '#F49CB0' : '#F8FAFC'; g.fill();
  g.save();
  g.translate(3, 3); g.scale(12 / 24, 12 / 24);
  g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#262B36';
  for (const p of Wheel.CURSOR_PATHS[tool]) g.stroke(new Path2D(p));
  g.restore();
  const art = { src: can.toDataURL('image/png'), W, H };
  chipCache.set(tool, art);
  return art;
}

let lastLocal = 0;
let pos = null; // latest pointer position, from this window's own events or from the main process
const CHIP_OFFSET = { x: 13, y: 15 }; // tucked under the right of the system arrow

function applyCursor() {
  const tool = state.activeTool;
  const on = !!tool && !menu && !!state.settings;
  ring.classList.toggle('pencil', tool === 'pencil');
  if (on) {
    const s = state.settings;
    // Eraser: its exact width. Pencil: the line's width, with a little room so thin pencils stay visible.
    const d = tool === 'eraser' ? s.eraserSize : Math.max(s.pencilSize + 6, 10);
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.marginLeft = ring.style.marginTop = `${-d / 2}px`;
    ring.style.setProperty('--ink-color', s.pencilColor);
    ring.style.setProperty('--dot', `${Math.max(2, s.pencilSize)}px`);
    const art = chipArt(tool);
    if (badge.dataset.tool !== tool) {
      badge.src = art.src; badge.width = art.W; badge.height = art.H; badge.dataset.tool = tool;
      badge.classList.remove('swap'); void badge.offsetWidth; badge.classList.add('swap');
    }
  } else {
    badge.dataset.tool = '';
  }
  ring.classList.toggle('show', on && !!pos);
  badge.classList.toggle('show', on && !!pos);
  follow();
}
// Positions use the `translate` property, not `transform`: CSS applies `scale` after `transform`,
// so a scaled ring placed with `transform` would also have its screen position scaled toward the corner.
function follow() {
  if (!pos) return;
  ring.style.translate = `${pos.x}px ${pos.y}px`;
  badge.style.translate = `${pos.x + CHIP_OFFSET.x}px ${pos.y + CHIP_OFFSET.y}px`;
  if (menu) pointerEl.style.translate = `${pos.x}px ${pos.y}px`;
}

// ---------- wheel pointer ----------
// While the wheel is up, a pointer sits under the cursor: a hollow ring over the centre (nothing picked),
// a solid graphite dot with an arrow aimed at the slice you'd get when you're over one.
const pointerEl = document.getElementById('pointer');
let pointerAngle = null;
function setPointerHover(h) {
  const hot = h >= 0;
  if (hot) {
    let a = (Wheel.layout(menu.items)[h].mid * 180) / Math.PI; // aim at the slice's middle (slices can be half-size)
    if (pointerAngle !== null) { // turn the short way round
      while (a - pointerAngle > 180) a -= 360;
      while (a - pointerAngle < -180) a += 360;
    }
    const arrow = pointerEl.querySelector('.arrow');
    if (!pointerEl.classList.contains('hot')) { // first slice: appear already aimed, no spin
      arrow.style.transition = 'none';
      pointerEl.style.setProperty('--a', `${a}deg`);
      void arrow.offsetWidth;
      arrow.style.transition = '';
    } else {
      pointerEl.style.setProperty('--a', `${a}deg`);
    }
    pointerAngle = a;
  }
  pointerEl.classList.toggle('hot', hot);
  // Over the middle button the pink hub is the feedback; the pointer tucks away so the eye stays clear.
  pointerEl.classList.toggle('center', h === -1);
}
// Raw pointer updates arrive at the device's rate, ahead of the next frame.
function onLocal(e) {
  lastLocal = performance.now();
  const first = !pos;
  pos = { x: e.clientX, y: e.clientY };
  if (first) applyCursor(); else follow();
  if (penKey && live) extend(e.clientX, e.clientY);
}
addEventListener('pointerrawupdate', onLocal, { passive: true });
addEventListener('pointermove', onLocal, { passive: true });

// ---------- wheel ----------
function svgEl() { return wheelEl.querySelector('svg'); }
function openWheel(m) {
  clearTimeout(leaveTimer);
  menu = { x: m.x, y: m.y, items: m.items, hover: -1 };
  const size = state.settings.wheelSize;
  const { cx, cy } = Wheel.metrics(size);
  wheelEl.innerHTML = Wheel.build({ items: m.items, size, visible: state.visible, active: state.activeTool });
  wheelEl.style.transform = `translate(${m.x - cx}px, ${m.y - cy}px)`;
  Wheel.setHover(svgEl(), -1, m.items, state.visible); // the pointer starts on the middle button
  ring.classList.remove('show');
  pos = { x: m.x, y: m.y };
  pointerAngle = null;
  pointerEl.classList.remove('hot'); pointerEl.classList.add('center'); // the wheel opens with the pointer on the middle button
  pointerEl.style.translate = `${m.x}px ${m.y}px`;
  pointerEl.classList.add('show');
  applyCursor();
}
function closeWheel(choice) {
  const svg = svgEl();
  const m = menu;
  menu = null;
  pointerEl.classList.remove('show');
  if (svg && m) {
    if (choice) svg.querySelector(`.slice[data-i="${m.items.indexOf(choice)}"]`)?.classList.add('picked', 'hot');
    svg.classList.remove('enter');
    svg.classList.add('leave');
    leaveTimer = setTimeout(() => { wheelEl.innerHTML = ''; }, 200);
  } else {
    wheelEl.innerHTML = '';
  }
  applyCursor();
}

// ---------- IPC ----------
scrawl.on('state', (s) => {
  const wasTool = state.activeTool;
  state = s;
  setVisible(state.visible, true);
  if (!state.activeTool && wasTool) { if (penKey) { penKey = false; finish(); } }
  applyCursor();
});
scrawl.on('cursor', (p) => {
  if (!p) {
    pos = null;
    ring.classList.remove('show'); badge.classList.remove('show');
    if (penKey) { penKey = false; finish(); }
    return;
  }
  // Prefer this window's own pointer events; the main process's poll fills in when they don't arrive.
  if (performance.now() - lastLocal < 60) return;
  const first = !pos;
  pos = p;
  if (first) applyCursor(); else follow();
  if (penKey && live) extend(p.x, p.y);
});
scrawl.on('pen:down', (p) => {
  if (!state.activeTool || live) return;
  penKey = true;
  const at = performance.now() - lastLocal < 150 && pos ? pos : p;
  begin(at.x, at.y);
});
scrawl.on('pen:up', () => { if (penKey) { penKey = false; finish(); } });
scrawl.on('menu:open', (m) => {
  state = { activeTool: m.activeTool, visible: m.visible, settings: m.settings };
  openWheel(m);
});
scrawl.on('menu:hover', (h) => {
  if (!menu) return;
  menu.hover = h;
  Wheel.setHover(svgEl(), h, menu.items, state.visible);
  setPointerHover(h);
});
scrawl.on('menu:close', closeWheel);
scrawl.on('strokes:clear', rewindClear);
scrawl.on('stroke:undo', undoStroke);
scrawl.on('stroke:redo', redoStroke);
scrawl.on('strokes:restore', restoreStrokes);

addEventListener('resize', resize);
scrawl.invoke('overlay:init', displayId).then(({ strokes: saved, state: s }) => {
  strokes = saved;
  state = s;
  setVisible(state.visible, false);
  resize();
  applyCursor();
});
