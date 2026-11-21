// A small toy for each tool, filling the space under the left column of its page.
//   Scrawl: a doodle pad that draws with your pencil color and size
//   Spin:   a record you can fling, or set playing on the turntable
//   Away:   a coffee mug to sip from (and refill)
(() => {
  const toy = (id) => document.querySelector(`.toy[data-toy="${id}"]`);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Scrawl: doodle pad ----------
  {
    const box = toy('scrawl');
    box.innerHTML = `<span class="toy-tag">Doodle pad</span><span class="toy-hint">Draw here with your pencil</span>
      <button class="toy-btn" aria-label="Clear the doodle pad"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Clear</button>
      <canvas aria-label="Doodle pad"></canvas>`;
    const canvas = box.querySelector('canvas');
    const hint = box.querySelector('.toy-hint');
    const ctx = canvas.getContext('2d');
    let last = null;

    function size() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const k = devicePixelRatio || 1;
      if (canvas.width === Math.round(r.width * k)) return;
      canvas.width = Math.round(r.width * k);
      canvas.height = Math.round(r.height * k);
      ctx.setTransform(k, 0, 0, k, 0, 0);
    }
    const pen = () => ({
      color: (typeof S !== 'undefined' && S?.pencilColor) || css('--accent-lip'),
      width: Math.max(2, Math.min(18, (typeof S !== 'undefined' && S?.pencilSize) || 4)),
    });
    function at(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', (e) => {
      size();
      canvas.setPointerCapture(e.pointerId);
      last = at(e);
      const p = pen();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(last.x, last.y, p.width / 2, 0, Math.PI * 2);
      ctx.fill();
      hint.classList.add('gone');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pen();
      const now = at(e);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(now.x, now.y);
      ctx.stroke();
      last = now;
    });
    const up = () => { last = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    box.querySelector('.toy-btn').addEventListener('click', () => {
      canvas.classList.add('wipe');
      setTimeout(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.classList.remove('wipe');
        hint.classList.remove('gone');
      }, 260);
    });
    new ResizeObserver(size).observe(canvas);
  }

  // ---------- Spin: turntable ----------
  {
    const box = toy('spin');
    const grooves = Array.from({ length: 9 }, (_, i) => `<circle cx="50" cy="50" r="${46 - i * 3.4}" fill="none" stroke="rgba(255,255,255,${i % 3 ? 0.05 : 0.11})" stroke-width="0.6"/>`).join('');
    box.innerHTML = `
      <div class="tt">
        <div class="tt-platter"></div>
        <div class="tt-disc" role="img" aria-label="A record you can spin">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="50" fill="#1C1B22"/>${grooves}
            <circle cx="50" cy="50" r="17" fill="var(--accent)"/>
            <path d="M50 35a15 15 0 0 1 13 7.5" fill="none" stroke="var(--accent-lip)" stroke-width="3" stroke-linecap="round"/>
            <text x="50" y="45" text-anchor="middle" font-size="5.2" font-weight="800" fill="var(--ink)" font-family="inherit">PANE</text>
            <text x="50" y="60" text-anchor="middle" font-size="3.6" font-weight="700" fill="var(--ink)" opacity="0.7" font-family="inherit">SIDE A</text>
            <circle cx="50" cy="50" r="2" fill="var(--well)"/>
          </svg>
        </div>
        <div class="tt-shine"></div>
        <svg class="tt-arm" viewBox="0 0 40 120" aria-hidden="true">
          <circle cx="30" cy="12" r="10" fill="var(--card)" stroke="var(--edge)" stroke-width="2"/>
          <path d="M30 12 L30 82 Q30 96 20 104" fill="none" stroke="var(--ink-2)" stroke-width="3.5" stroke-linecap="round"/>
          <rect x="11" y="98" width="13" height="18" rx="3" transform="rotate(32 17 107)" fill="var(--ink)"/>
          <circle cx="30" cy="12" r="4" fill="var(--accent-lip)"/>
        </svg>
      </div>
      <div class="tt-side">
        <b>Give it a spin</b>
        <small>Drag the record to fling it, or let the turntable play it.</small>
        <span class="tt-rpm" style="font-size:12px;font-weight:800;color:var(--ink-2)">0 rpm</span>
        <button class="toy-btn"><svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.2v7.6L9.8 6z" fill="currentColor"/></svg><span>Play</span></button>
      </div>`;
    const tt = box.querySelector('.tt');
    const disc = box.querySelector('.tt-disc');
    const rpmEl = box.querySelector('.tt-rpm');
    const playBtn = box.querySelector('.toy-btn');
    const MOTOR = 200; // 33⅓ rpm, in degrees per second
    let angle = 0, vel = 0, motor = false, drag = null, frame = 0, lastT = 0, shownRpm = -1;

    const centre = () => { const r = disc.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const pointerAngle = (e) => { const c = centre(); return Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI; };

    function tick(t) {
      const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
      lastT = t;
      if (!drag) {
        const target = motor ? MOTOR : 0;
        // The motor pulls gently toward 33⅓; a free record slows down with friction.
        vel += (target - vel) * Math.min(1, dt * (motor ? 2.2 : 0.9));
        if (!motor && Math.abs(vel) < 2) vel = 0;
        angle += vel * dt;
      }
      disc.style.transform = `rotate(${angle}deg)`;
      const rpm = Math.round(Math.abs(vel) / 6);
      if (rpm !== shownRpm) { shownRpm = rpm; rpmEl.textContent = `${rpm} rpm`; }
      frame = (vel || drag || motor) && !document.hidden ? requestAnimationFrame(tick) : 0;
      if (!frame) lastT = 0;
    }
    const wake = () => { if (!frame) frame = requestAnimationFrame(tick); };

    disc.addEventListener('pointerdown', (e) => {
      disc.setPointerCapture(e.pointerId);
      drag = { a: pointerAngle(e), t: performance.now() };
      vel = 0;
      wake();
    });
    disc.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = pointerAngle(e), now = performance.now();
      let d = a - drag.a;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      angle += d;
      const dt = Math.max(8, now - drag.t) / 1000;
      vel = vel * 0.6 + (d / dt) * 0.4; // smoothed, so the fling follows the last few moves
      drag = { a, t: now };
    });
    const release = () => { if (!drag) return; drag = null; vel = Math.max(-1800, Math.min(1800, vel)); wake(); };
    disc.addEventListener('pointerup', release);
    disc.addEventListener('pointercancel', release);

    playBtn.addEventListener('click', () => {
      motor = !motor;
      tt.classList.toggle('on', motor);
      playBtn.querySelector('span').textContent = motor ? 'Stop' : 'Play';
      playBtn.querySelector('path').setAttribute('d', motor ? 'M3 2.5h2.4v7H3zM6.6 2.5H9v7H6.6z' : 'M3.5 2.2v7.6L9.8 6z');
      wake();
    });
    if (reduced) disc.style.transition = 'none';
  }

  // ---------- Away: coffee mug ----------
  {
    const box = toy('away');
    const SIPS = 5;
    box.innerHTML = `
      <div class="mug" role="button" tabindex="0" aria-label="Take a sip">
        <svg width="132" height="150" viewBox="0 0 132 150" aria-hidden="true">
          <defs><clipPath id="mugInside"><path d="M14 58h68v52a20 20 0 0 1-20 20H34a20 20 0 0 1-20-20z"/></clipPath></defs>
          <g class="steam"><path d="M34 46c-6-8 6-12 0-22"/><path d="M50 46c-6-8 6-12 0-22"/><path d="M66 46c-6-8 6-12 0-22"/></g>
          <path class="pour" d="M60 0v64" stroke="#7A4B2E" stroke-width="6" stroke-linecap="round"/>
          <path d="M82 72h8a16 16 0 0 1 0 32h-8" fill="none" stroke="var(--accent-lip)" stroke-width="9" stroke-linecap="round"/>
          <path d="M10 54h76v56a24 24 0 0 1-24 24H34a24 24 0 0 1-24-24z" fill="var(--accent)"/>
          <g clip-path="url(#mugInside)"><rect class="coffee" x="10" y="60" width="80" height="80" fill="#7A4B2E"/><rect class="coffee" x="10" y="60" width="80" height="5" fill="#A0704F"/></g>
          <path d="M10 54h76" stroke="var(--accent-lip)" stroke-width="6" stroke-linecap="round"/>
          <ellipse cx="48" cy="142" rx="40" ry="5" fill="var(--ink)" opacity="0.08"/>
        </svg>
      </div>
      <div class="mug-side">
        <b>Coffee break</b>
        <small>Click the mug to take a sip.</small>
        <div class="mug-cups">${'<i></i>'.repeat(SIPS)}</div>
      </div>`;
    const mug = box.querySelector('.mug');
    const title = box.querySelector('.mug-side b');
    const line = box.querySelector('.mug-side small');
    const cups = [...box.querySelectorAll('.mug-cups i')];
    const coffee = [...box.querySelectorAll('.coffee')];
    let left = SIPS, busy = false;

    function show() {
      const drop = ((SIPS - left) / SIPS) * 66; // the level sinks with each sip
      coffee.forEach((c) => { c.style.transform = `translateY(${drop}px)`; });
      cups.forEach((c, i) => c.classList.toggle('gone', i >= left));
      mug.classList.toggle('empty', left === 0);
      title.textContent = left === 0 ? 'All gone' : left === SIPS ? 'Coffee break' : 'Still warm';
      line.textContent = left === 0 ? 'Click the mug for a refill.' : `${left} sip${left === 1 ? '' : 's'} left. Take your time.`;
      mug.setAttribute('aria-label', left === 0 ? 'Refill the mug' : 'Take a sip');
    }
    function act() {
      if (busy) return;
      busy = true;
      if (left > 0) {
        mug.classList.add('sip');
        setTimeout(() => { left--; show(); mug.classList.remove('sip'); }, 380);
        setTimeout(() => { busy = false; }, 760);
      } else {
        mug.classList.add('pouring');
        setTimeout(() => { left = SIPS; show(); }, 250);
        setTimeout(() => { mug.classList.remove('pouring'); busy = false; }, 1000);
      }
    }
    mug.addEventListener('click', act);
    mug.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    show();
  }
})();
