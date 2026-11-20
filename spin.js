// Spin's wheel: one module shared by the overlay, the settings preview and the main process
// (for hit-testing), like Scrawl's wheel.js.
//
// Slices: play/pause, next, volume, previous and playlists, in the order (and with the ones) you choose.
// They share the circle evenly, starting at the top. The default is play on top, next on the right,
// volume at the bottom, previous on the left.
// Pointing at next (or previous) fans the coming (or past) songs out beside it as little records;
// pointing at playlists fans out your playlists the same way.
// Past the last record is the edge: rest there and the list scrolls on through the queue or playlist.
// Under the volume slice an arc comes out; slide along it to set the volume.
// The middle cancels: going back there puts the list and the volume back where they were.
(function () {
  const ICONS = {
    play: '<path d="M8 5.2v13.6L18.8 12z"/>',
    pause: '<path d="M8.5 5.5v13"/><path d="M15.5 5.5v13"/>',
    next: '<path d="M5.5 6.2l8.5 5.8-8.5 5.8z"/><path d="M18.5 6v12"/>',
    prev: '<path d="M18.5 6.2L10 12l8.5 5.8z"/><path d="M5.5 6v12"/>',
    volume: '<path d="M4.5 9.5h3.2L12 5.6v12.8l-4.3-3.9H4.5z"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    chevron: '<path d="M6.5 9l5.5 5.5L17.5 9" stroke-width="3"/>',
    note: '<path d="M9.5 17.5V6.5l9-2v11"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
    lists: '<path d="M4 6.5h11"/><path d="M4 11.5h11"/><path d="M4 16.5h6"/><path d="M17.5 18.5v-8l3.5-1"/><circle cx="15.6" cy="18.5" r="1.9"/>',
  };

  // Every slice there can be. A slice's code (its place in this list) is its hover code, wherever it sits.
  const SLICES = [
    { id: 'play', name: 'Play / pause' },
    { id: 'next', name: 'Next' },
    { id: 'volume', name: 'Volume' },
    { id: 'prev', name: 'Previous' },
    { id: 'lists', name: 'Playlists' },
  ];
  const SLICE = { play: 0, next: 1, volume: 2, prev: 3, lists: 4 };
  const DEFAULT_LAYOUT = ['play', 'next', 'volume', 'prev']; // top, right, bottom, left
  const ALL_SLICES = SLICES.map((x) => x.id);

  // Hover codes. -1 is the middle, 0..4 the slices (by SLICE code).
  const UP = 100, UP_MORE = 150, UP_LESS = 151; // coming songs: UP + k is the k-th record
  const BACK = 200, BACK_MORE = 250, BACK_LESS = 251; // songs already played
  const VOL = 300; // VOL + 0..100
  const PL = 500, PL_MORE = 550, PL_LESS = 551; // playlists (VOL runs to 400)
  const isSlice = (h) => h != null && h >= 0 && h < SLICES.length;
  const isUp = (h) => h >= UP && h <= UP_LESS;
  const isBack = (h) => h >= BACK && h <= BACK_LESS;
  const isPl = (h) => h >= PL && h <= PL_LESS;
  const isVol = (h) => h >= VOL && h <= VOL + 100;
  const isBead = (h) => (h >= UP && h < UP_MORE) || (h >= BACK && h < BACK_MORE) || (h >= PL && h < PL_MORE);
  // Which slice a hover belongs to (records belong to next / previous / playlists, the arc to volume).
  const sliceOf = (h) => (h == null || h < 0 ? h : isSlice(h) ? h : isUp(h) ? SLICE.next : isBack(h) ? SLICE.prev : isPl(h) ? SLICE.lists : isVol(h) ? SLICE.volume : null);
  // The records on each side, and the slice they come out of.
  const SIDES = { up: { slice: 'next', base: UP }, back: { slice: 'prev', base: BACK }, pl: { slice: 'lists', base: PL } };
  const sideOf = (h) => (isUp(h) ? 'up' : isBack(h) ? 'back' : isPl(h) ? 'pl' : null);

  const VSPAN = (70 * Math.PI) / 180; // the volume arc, centred beyond the volume slice
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  /** The slices in `layout` (ids), each with its code and the angle of its middle. Top first, clockwise. */
  const lay = (layout) => (layout && layout.length ? layout : DEFAULT_LAYOUT);
  function layoutOf(layout) {
    const ids = lay(layout), n = ids.length;
    return ids.map((id, i) => ({ id, code: SLICE[id], mid: -Math.PI / 2 + (i * Math.PI * 2) / n, half: Math.PI / n }));
  }
  /** The middle of a slice (by code), or null if it isn't on the wheel. */
  function sliceMid(code, layout) {
    const x = layoutOf(layout).find((s) => s.code === code);
    return x ? x.mid : null;
  }
  // Records run down the wheel: clockwise on the right half, counter-clockwise on the left;
  // left to right along the top and bottom.
  function sideDir(side, layout) {
    const c = sliceMid(SLICE[SIDES[side].slice], layout) ?? 0;
    const x = Math.cos(c);
    return x > 0.01 ? 1 : x < -0.01 ? -1 : Math.sin(c) < 0 ? 1 : -1;
  }
  const V0 = (layout) => (sliceMid(SLICE.volume, layout) ?? Math.PI / 2) + VSPAN / 2; // 0%

  // Record-label colors for songs without cover art.
  const LABELS = ['#FFC94D', '#7ED3A8', '#F49CB0', '#A9C1EC', '#FF9C78', '#B9A5F4'];
  function labelColor(item) {
    const s = `${item?.title || ''}|${item?.artist || ''}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return LABELS[h % LABELS.length];
  }

  /** Geometry shared by rendering and hit-testing. `compact` leaves out the room for records. */
  function metrics(size, compact = false) {
    const R = size, r = size * 0.4, depth = Math.max(3, Math.round(size * 0.055));
    const hubR = r - Math.max(4, size * 0.07);
    const beadR = Math.max(9, size * 0.14);
    const rc = R + beadR + Math.max(8, size * 0.1); // the records' arc
    const step = (beadR * 2 + Math.max(5, size * 0.07)) / rc; // angle between neighbouring records
    const vw = Math.max(7, size * 0.1); // volume arc thickness
    const rv = R + vw / 2 + Math.max(7, size * 0.09); // volume arc radius
    const outer = compact ? R : rc + beadR + 6;
    const pad = 4, box = Math.ceil(outer * 2 + depth + pad * 2);
    return { R, r, hubR, depth, press: depth * 0.7, beadR, rc, step, vw, rv, outer, box, cx: box / 2, cy: pad + outer };
  }

  // A fan of records (and the scroll nubs at either end) stays inside its own slice, so sliding along
  // it never wanders over to a neighbouring slice. With more slices or more records, they sit closer.
  const sectorOf = (layout) => (Math.PI * 2) / lay(layout).length;
  const fitStep = (step, count, layout) => Math.min(step, (sectorOf(layout) * 0.94) / (count + 1));
  /** The fan's spacing and record size for this wheel. */
  function fan(size, count, layout) {
    const m = metrics(size);
    const step = fitStep(m.step, count, layout);
    const beadR = Math.min(m.beadR, Math.max(4.5, (step * m.rc - Math.max(3, size * 0.04)) / 2));
    return { step, beadR };
  }

  /** Where the k-th record of a side sits: fanned out around its slice. */
  function beadAngle(side, k, count, step, layout) {
    step = fitStep(step, count, layout);
    const spread = (count - 1) * step;
    const c = sliceMid(SLICE[SIDES[side].slice], layout) ?? (side === 'back' ? Math.PI : 0);
    const dir = sideDir(side, layout);
    return c - (dir * spread) / 2 + dir * k * step;
  }
  const volAngle = (v, layout) => V0(layout) - (Math.max(0, Math.min(100, v)) / 100) * VSPAN;

  function sliceAt(angle, layout) {
    const L = layoutOf(layout), n = L.length;
    const t = angle + Math.PI / 2; // top is 0
    const i = ((Math.round(t / ((Math.PI * 2) / n)) % n) + n) % n;
    return L[i].code;
  }

  /**
   * What's under an offset from the wheel's centre. `ctx` says what's there to point at:
   * { prev, layout, up, back, pl, upMore, upLess, backMore, backLess, plMore, plLess } (counts of
   * records shown and which edges can scroll). Once you're on a slice's records or the volume arc it
   * holds you a little, so sliding past an end clamps instead of jumping somewhere else.
   */
  function hitTest(size, count, dx, dy, ctx = {}) {
    const m = metrics(size);
    const layout = lay(ctx.layout);
    const d = Math.hypot(dx, dy);
    if (d < m.hubR + 2) return -1;
    const a = Math.atan2(dy, dx);
    if (d <= m.R + 2) return sliceAt(a, layout);

    const volFrom = (slack) => {
      const t = wrap(V0(layout) - a) / VSPAN;
      if (t < -slack || t > 1 + slack) return null;
      return VOL + Math.round(Math.max(0, Math.min(1, t)) * 100);
    };
    const f = fan(size, count, layout);
    const beadFrom = (side, sticky) => {
      const n = ctx[side] || 0;
      const more = ctx[`${side}More`], less = ctx[`${side}Less`];
      const base = SIDES[side].base;
      // Reaching a list: only out past the wheel, in this slice's own direction.
      // Once on it (sticky), it holds you until you come back inside the wheel: past either end you
      // stay on that end, so scrolling never lands on another slice's list.
      const c = sliceMid(SLICE[SIDES[side].slice], layout);
      const rel = sideDir(side, layout) * wrap(a - c); // along the list, from its middle
      if (!sticky && (d > m.rc + f.beadR + 22 || Math.abs(rel) > sectorOf(layout) / 2)) return null;
      const k = Math.round((rel + ((count - 1) * f.step) / 2) / f.step);
      if (k >= n) return more ? base + 50 : n ? base + n - 1 : null;
      if (k < 0) return less ? base + 51 : n ? base : null;
      return base + k;
    };
    // What comes out of a slice: the volume arc, or its records.
    const outOf = (code, sticky) => {
      if (code == null || code < 0 || !layout.includes(ALL_SLICES[code])) return null;
      if (code === SLICE.volume) return sticky ? volFrom(Infinity) : d < m.rv + 26 && Math.abs(wrap(a - sliceMid(code, layout))) <= sectorOf(layout) / 2 ? volFrom(0) : null;
      const side = Object.keys(SIDES).find((k) => SLICE[SIDES[k].slice] === code);
      return side ? beadFrom(side, sticky) : null;
    };
    // Hold on to the slice you came from; otherwise, whatever comes out of the slice in this direction.
    const h = outOf(sliceOf(ctx.prev ?? -1), true);
    if (h != null) return h;
    const under = sliceAt(a, layout);
    return outOf(under, false) ?? under;
  }

  // ---------- drawing ----------
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const safeArt = (u) => (typeof u === 'string' && (/^https:\/\//.test(u) || /^data:image\/(png|jpeg|gif|webp);base64,/.test(u)) ? u : null);

  function iconGroup(name, x, y, size, cls, extra = '') {
    return `<g transform="translate(${(x - size / 2).toFixed(2)} ${(y - size / 2).toFixed(2)}) scale(${(size / 24).toFixed(4)})">` +
      `<g class="${cls}" ${extra} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
      `<rect width="24" height="24" fill="none" stroke="none"/>${ICONS[name]}</g></g>`;
  }

  /** A song as a little record: its cover art with a spindle hole, or a black disc with a colored label. */
  function disc(item, x, y, r, cls = 'disc') {
    const art = safeArt(item?.art);
    const X = x.toFixed(2), Y = y.toFixed(2);
    if (art) {
      return `<g class="${cls}"><image href="${esc(art)}" x="${(x - r).toFixed(2)}" y="${(y - r).toFixed(2)}" width="${(r * 2).toFixed(2)}" height="${(r * 2).toFixed(2)}" ` +
        `preserveAspectRatio="xMidYMid slice" clip-path="url(#spinClip)"/>` +
        `<circle cx="${X}" cy="${Y}" r="${r.toFixed(2)}" class="disc-rim"/>` +
        `<circle cx="${X}" cy="${Y}" r="${Math.max(1.2, r * 0.13).toFixed(2)}" class="disc-hole"/></g>`;
    }
    return `<g class="${cls}"><circle cx="${X}" cy="${Y}" r="${r.toFixed(2)}" class="vinyl"/>` +
      `<circle cx="${X}" cy="${Y}" r="${(r * 0.74).toFixed(2)}" class="groove"/>` +
      `<circle cx="${X}" cy="${Y}" r="${(r * 0.42).toFixed(2)}" fill="${labelColor(item)}"/>` +
      `<circle cx="${X}" cy="${Y}" r="${Math.max(1.2, r * 0.11).toFixed(2)}" class="disc-hole"/></g>`;
  }

  /** The records on one side, plus the edge nubs that scroll. Goes inside <g class="beads" data-side>. */
  function beads(size, count, side, items, { more = false, less = false, layout, current = null } = {}) {
    const m = metrics(size);
    const { cx, cy, rc } = m;
    const { step, beadR } = fan(size, count, layout);
    const nub = (k, dir) => {
      const a = beadAngle(side, k, count, step, layout);
      const x = cx + rc * Math.cos(a), y = cy + rc * Math.sin(a);
      // The chevron points the way the list runs: down the sides (left to right along the top or bottom)
      // for "more", the other way for "back toward now".
      const c = sliceMid(SLICE[SIDES[side].slice], layout) ?? 0;
      const runsDown = Math.abs(Math.cos(c)) > 0.01;
      const rot = runsDown ? (dir > 0 ? 0 : 180) : (dir > 0 ? -90 : 90);
      const nr = beadR * 0.72;
      return `<g class="nub ${dir > 0 ? 'more' : 'less'}" style="--k:${Math.max(0, k)}">` +
        `<circle class="nub-edge" cx="${x.toFixed(2)}" cy="${(y + 2).toFixed(2)}" r="${nr.toFixed(2)}"/>` +
        `<circle class="nub-top" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${nr.toFixed(2)}"/>` +
        `<g transform="rotate(${rot.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})">${iconGroup('chevron', x, y + nr * 0.12, nr * 2, 'nub-ico')}</g></g>`;
    };
    let out = '';
    items.forEach((item, k) => {
      const a = beadAngle(side, k, count, step, layout);
      const x = cx + rc * Math.cos(a), y = cy + rc * Math.sin(a);
      const cur = current != null && item?.id === current ? ' cur' : '';
      out += `<g class="bead${cur}" data-k="${k}" style="--k:${k}">` +
        `<circle class="bead-lip" cx="${x.toFixed(2)}" cy="${(y + 2.2).toFixed(2)}" r="${beadR.toFixed(2)}"/>` +
        `${disc(item, x, y, beadR)}<circle class="bead-ring" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(beadR + 3.2).toFixed(2)}"/></g>`;
    });
    if (less) out += nub(-1, -1);
    if (more) out += nub(count, 1);
    return out;
  }

  /** Builds the wheel SVG. Records and the hover state are filled in later (beads(), setHover()). */
  function build({ size = 76, count = 5, np = null, enter = true, compact = false, layout }) {
    const m = metrics(size, compact);
    const { R, r, hubR, depth, press, box, cx, cy, rv, vw } = m;
    const gap = Math.max(2.2, size * 0.03);
    const pt = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    const playing = np?.state === 'playing';
    let slices = '';
    const L = layoutOf(layout);
    L.forEach(({ id, code, mid, half }, i) => {
      const start = mid - half, end = mid + half;
      const a0 = start + gap / R, a1 = end - gap / R, b0 = start + gap / r, b1 = end - gap / r;
      const big = half * 2 - gap / R * 2 > Math.PI ? 1 : 0;
      const d = `M${pt(R, a0)}A${R},${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, b1)}A${r},${r} 0 ${big} 0 ${pt(r, b0)}Z`;
      const ir = (R + r) / 2, iconSize = Math.max(13, size * (L.length > 4 ? 0.23 : 0.25));
      const ix = cx + ir * Math.cos(mid), iy = cy + ir * Math.sin(mid);
      const name = id === 'play' ? (playing ? 'pause' : 'play') : id;
      slices += `<g class="slice" data-i="${code}" data-id="${id}" style="--i:${i}">` +
        `<path class="edge" d="${d}" transform="translate(0 ${depth})"/>` +
        `<g class="face"><path class="top" d="${d}"/>${iconGroup(name, ix, iy, iconSize, 'ico')}</g></g>`;
    });

    // The volume arc, under the wheel: a track, the filled part, and a knob.
    let vol = '';
    if (!compact && L.some((x) => x.id === 'volume')) {
      const v0 = V0(layout);
      const arc = `M${pt(rv, v0)}A${rv},${rv} 0 0 0 ${pt(rv, v0 - VSPAN)}`;
      vol = `<g class="vol">` +
        `<path class="vol-lip" d="${arc}" transform="translate(0 2.5)" stroke-width="${vw.toFixed(2)}"/>` +
        `<path class="vol-track" d="${arc}" stroke-width="${vw.toFixed(2)}"/>` +
        `<path class="vol-fill" d="${arc}" pathLength="100" stroke-width="${vw.toFixed(2)}" stroke-dasharray="0 100"/>` +
        `<circle class="vol-knob" r="${(vw * 0.9).toFixed(2)}" cx="${pt(rv, v0).split(',')[0]}" cy="${pt(rv, v0).split(',')[1]}"/></g>`;
    }

    // The middle: the song that's on, as a record that turns while it plays. Pointing at a slice
    // swaps in that slice's icon; at a record, that song; at the volume arc, the number.
    const hubIcon = Math.max(14, hubR * 1.05);
    const hubIcons = ['play', 'pause', 'next', 'prev', 'volume', 'lists'].map((n) => iconGroup(n, cx, cy, hubIcon, 'hub-ico', `data-icon="${n}"`)).join('');
    const hub =
      `<g class="hub"><circle class="hub-edge" cx="${cx}" cy="${cy + depth * 0.7}" r="${hubR}"/>` +
      `<g class="hub-face"><circle class="hub-top" cx="${cx}" cy="${cy}" r="${hubR}"/>` +
      `<g class="hub-now${playing ? ' turning' : ''}">${np?.track ? disc(np.track, cx, cy, hubR - 2.5, 'disc now') : iconGroup('note', cx, cy, hubIcon, 'hub-note')}</g>` +
      `<g class="hub-pick"></g>${hubIcons}` +
      `<text class="hub-vol" x="${cx}" y="${cy}" dy="0.36em" text-anchor="middle" font-size="${(hubR * 0.78).toFixed(1)}"></text></g></g>`;

    return `<svg class="wheel spin-wheel${enter ? ' enter' : ''}" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" ` +
      `style="--cx:${cx}px;--cy:${cy}px;--press:${press}px" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Music wheel">` +
      `<defs><clipPath id="spinClip" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath></defs>` +
      `${vol}<g class="wheel-body">${slices}</g>` +
      `<g class="beads" data-side="back"></g><g class="beads" data-side="up"></g><g class="beads" data-side="pl"></g>${hub}</svg>`;
  }

  /**
   * Shows what you're pointing at. `st` = { view, volume, np, size, count, layout }.
   * The records for a side show while you point at its slice or its records.
   */
  function setHover(svg, hover, st = {}) {
    if (!svg) return;
    const slice = sliceOf(hover);
    svg.querySelectorAll('.slice').forEach((g) => g.classList.toggle('hot', slice != null && slice >= 0 && Number(g.dataset.i) === slice));
    svg.querySelector('.hub')?.classList.toggle('hot', false);
    const up = svg.querySelector('.beads[data-side="up"]'), back = svg.querySelector('.beads[data-side="back"]');
    const pl = svg.querySelector('.beads[data-side="pl"]');
    up?.classList.toggle('show', slice === SLICE.next);
    back?.classList.toggle('show', slice === SLICE.prev);
    pl?.classList.toggle('show', slice === SLICE.lists);
    for (const [g, base] of [[up, UP], [back, BACK], [pl, PL]]) {
      g?.querySelectorAll('.bead').forEach((b) => b.classList.toggle('hot', hover === base + Number(b.dataset.k)));
      g?.querySelector('.nub.more')?.classList.toggle('hot', hover === base + 50);
      g?.querySelector('.nub.less')?.classList.toggle('hot', hover === base + 51);
    }

    // Volume: the arc follows the value you're pointing at (or shows the current one).
    const volEl = svg.querySelector('.vol');
    const showVol = slice === SLICE.volume;
    volEl?.classList.toggle('show', showVol);
    volEl?.classList.toggle('hot', isVol(hover));
    const v = isVol(hover) ? hover - VOL : st.volume;
    if (volEl && v != null) {
      volEl.querySelector('.vol-fill').setAttribute('stroke-dasharray', `${Math.max(0.01, v)} 100`);
      const m = metrics(st.size || 76);
      const a = volAngle(v, st.layout);
      const knob = volEl.querySelector('.vol-knob');
      knob.setAttribute('cx', (m.cx + m.rv * Math.cos(a)).toFixed(2));
      knob.setAttribute('cy', (m.cy + m.rv * Math.sin(a)).toFixed(2));
    }

    // The middle.
    const playing = st.np?.state === 'playing';
    const sliceIcon = isSlice(hover) ? (hover === 0 ? (playing ? 'pause' : 'play') : SLICES[hover].id) : null;
    const icon = sliceIcon || (hover === UP_MORE || hover === UP_LESS ? 'next' : hover === BACK_MORE || hover === BACK_LESS ? 'prev'
      : hover === PL_MORE || hover === PL_LESS ? 'lists' : null);
    svg.querySelectorAll('.hub-ico').forEach((g) => g.classList.toggle('on', g.dataset.icon === icon));
    const volText = svg.querySelector('.hub-vol');
    const showNum = showVol && !sliceIcon;
    volText.textContent = showNum && v != null ? String(Math.round(v)) : '';
    volText.classList.toggle('on', showNum);
    const pick = svg.querySelector('.hub-pick');
    const side = sideOf(hover);
    const item = isBead(hover) ? st.view?.[side]?.[hover - SIDES[side].base] : null;
    const key = item ? `${hover}:${item.at}` : '';
    if (pick.dataset.key !== key) {
      pick.dataset.key = key;
      const m = metrics(st.size || 76);
      pick.innerHTML = item ? disc(item, m.cx, m.cy, m.hubR - 2.5) : '';
      if (item) pick.animate?.([{ transform: 'scale(0.6) rotate(-30deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    }
    svg.querySelector('.hub-now')?.classList.toggle('away', !!(icon || showNum || item));
  }

  const api = {
    ICONS, SLICES, SLICE, SIDES, DEFAULT_LAYOUT, ALL_SLICES, UP, UP_MORE, UP_LESS, BACK, BACK_MORE, BACK_LESS, VOL, PL, PL_MORE, PL_LESS,
    isSlice, isUp, isBack, isPl, isVol, isBead, sliceOf, sideOf, layoutOf, sliceMid, sideDir, metrics, fan, beadAngle, volAngle, hitTest, build, beads, setHover, disc, labelColor, iconGroup,
  };
  if (typeof window !== 'undefined') window.Spin = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
