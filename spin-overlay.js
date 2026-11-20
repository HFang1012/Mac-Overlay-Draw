// Spin's wheel on the drawing layer. The main process decides what's under the pointer; this draws it.
(function () {
  const box = document.getElementById('spin');
  const label = document.getElementById('spinLabel');
  const pointerEl = document.getElementById('pointer'); // shared with Scrawl's wheel (only one is ever open)
  let st = null; // { x, y, size, count, layout, np, view, volume, hover, error, app, linked }
  let leaveTimer = null;
  let pointerAngle = null;
  let lastLocal = 0;

  const svg = () => box.querySelector('svg');
  const APP_NAME = { spotify: 'Spotify', music: 'Music', other: 'your player' };

  function renderBeads(shift) {
    const s = svg();
    if (!s || !st) return;
    const v = st.view;
    for (const side of ['up', 'back', 'pl']) {
      const g = s.querySelector(`.beads[data-side="${side}"]`);
      if (!g) continue;
      g.innerHTML = Spin.beads(st.size, st.count, side, v[side] || [], {
        more: v[`${side}More`], less: v[`${side}Less`], layout: st.layout, current: side === 'pl' ? v.plCurrent : null,
      });
      // Scrolling: the records slide one place along the arc, like flipping through a crate.
      if (shift?.side === side) {
        const step = (Spin.metrics(st.size).step * 180) / Math.PI;
        const deg = Spin.sideDir(side, st.layout) * shift.dir * step;
        g.querySelectorAll('.bead').forEach((b) => b.animate(
          [{ transform: `rotate(${deg}deg)` }, { transform: 'none' }],
          { duration: 150, easing: 'cubic-bezier(.2,.9,.3,1.15)' }));
      }
    }
  }

  function text(t) { return t == null ? '' : String(t); }
  function updateLabel() {
    if (!st) return;
    const { hover, np, view, error, app } = st;
    const track = np?.track;
    let title = track?.title || 'Nothing playing', sub = track?.artist || '';
    const appName = APP_NAME[app] || 'your player';
    if (error === 'denied') { title = `Pane can’t control ${appName}`; sub = 'Allow it in Privacy & Security › Automation'; }
    else if (np && !np.running) { title = `${appName} isn’t open`; sub = ''; }
    else if (app === 'other' && !track) { title = 'Media keys'; sub = 'Controls whichever player is on'; }
    const playing = np?.state === 'playing';
    const noList = !view.total && app !== 'other';
    const listHint = app === 'spotify' && !st.linked ? 'Link Spotify in Pane to see your queue' : 'No songs to show';
    const plNote = { link: 'Link Spotify in Pane to pick playlists', closed: `Open ${appName} to pick a playlist`, none: 'No playlists yet',
      unsupported: 'Playlists need Spotify or Music', denied: `Allow Pane to control ${appName}`, failed: 'Couldn’t get your playlists', loading: 'Looking for playlists…' }[view.plNote];
    if (hover === 0) { sub = title !== 'Nothing playing' ? title : ''; title = playing ? 'Pause' : 'Play'; }
    else if (hover === Spin.SLICE.lists) { title = 'Playlists'; sub = plNote || (view.plName ? `Playing ${view.plName}` : 'Slide out to pick one'); }
    else if (hover === 1) { title = 'Next'; sub = view.up[0] ? view.up[0].title : noList ? listHint : ''; }
    else if (hover === 3) { title = 'Previous'; sub = view.back[0] ? view.back[0].title : noList ? listHint : ''; }
    else if (hover === 2) { title = `Volume ${st.volume ?? '–'}`; sub = 'Slide out along the arc'; }
    else if (Spin.isVol(hover)) { title = `Volume ${hover - Spin.VOL}`; sub = ''; }
    else if (Spin.isPl(hover) && Spin.isBead(hover)) {
      const item = view.pl[hover - Spin.PL];
      if (item) {
        title = item.title;
        sub = item.count != null ? `${item.count} song${item.count === 1 ? '' : 's'}` : 'Playlist';
        st.when = item.id === view.plCurrent ? 'Playing' : 'Play from the top';
      }
    } else if (hover === Spin.PL_MORE || hover === Spin.PL_LESS) {
      title = hover === Spin.PL_LESS ? 'Back to the start' : 'Scrolling…';
      const a = view.pl[0], b = view.pl[view.pl.length - 1];
      if (a && b) sub = `Playlists ${a.at + 1}–${b.at + 1} of ${view.plTotal}`;
    } else if (Spin.isBead(hover)) {
      const up = Spin.isUp(hover);
      const item = up ? view.up[hover - Spin.UP] : view.back[hover - Spin.BACK];
      if (item) {
        title = item.title; sub = item.artist;
        const n = Math.abs(item.at - view.index);
        st.when = up ? (n === 1 ? 'Up next' : `In ${n} songs`) : (n === 1 ? 'Just played' : `${n} songs ago`);
        if (item.tag) st.when = `${item.tag} · ${st.when}`; // songs you queued, or Spotify's suggestions
      }
    } else if (hover === Spin.UP_MORE || hover === Spin.BACK_MORE || hover === Spin.UP_LESS || hover === Spin.BACK_LESS) {
      const up = Spin.isUp(hover);
      const list = up ? view.up : view.back;
      const a = list[0], b = list[list.length - 1];
      title = (hover === Spin.UP_LESS || hover === Spin.BACK_LESS) ? 'Back toward now' : 'Scrolling…';
      if (a && b) {
        const n1 = Math.abs(a.at - view.index), n2 = Math.abs(b.at - view.index);
        sub = `${up ? 'Songs' : 'Back'} ${n1}–${n2} of ${up ? view.total - view.index - 1 : view.index}`;
      }
    }
    label.querySelector('b').textContent = text(title);
    label.querySelector('span').textContent = text(sub);
    const when = Spin.isBead(hover) ? st.when : '';
    const w = label.querySelector('i');
    w.textContent = when || '';
    w.hidden = !when;
    placeLabel();
  }
  function placeLabel() {
    const m = Spin.metrics(st.size);
    const h = label.offsetHeight || 46;
    // Above the wheel, or below it near the top of the screen.
    const above = st.y - m.rc - m.beadR - 14 - h > 8;
    const y = above ? st.y - m.rc - m.beadR - 14 - h : st.y + m.rc + m.beadR + 14;
    const w = label.offsetWidth || 200;
    const x = Math.max(8, Math.min(innerWidth - w - 8, st.x - w / 2));
    label.style.translate = `${x}px ${y}px`;
  }

  function aim(h) {
    const hot = h >= 0;
    if (hot) {
      const m = Spin.metrics(st.size);
      let rad;
      if (Spin.isSlice(h)) rad = Spin.sliceMid(h, st.layout) ?? 0;
      else if (Spin.isVol(h)) rad = Spin.volAngle(h - Spin.VOL, st.layout);
      else {
        const side = Spin.sideOf(h), base = Spin.SIDES[side].base;
        rad = Spin.beadAngle(side, h === base + 50 ? st.count : h === base + 51 ? -1 : h - base, st.count, m.step, st.layout);
      }
      let a = (rad * 180) / Math.PI;
      if (pointerAngle !== null) {
        while (a - pointerAngle > 180) a -= 360;
        while (a - pointerAngle < -180) a += 360;
      }
      const arrow = pointerEl.querySelector('.arrow');
      if (!pointerEl.classList.contains('hot')) {
        arrow.style.transition = 'none';
        pointerEl.style.setProperty('--a', `${a}deg`);
        void arrow.offsetWidth;
        arrow.style.transition = '';
      } else pointerEl.style.setProperty('--a', `${a}deg`);
      pointerAngle = a;
    }
    pointerEl.classList.toggle('hot', hot);
  }

  function open(m) {
    clearTimeout(leaveTimer);
    st = { ...m, hover: -1 };
    const { cx, cy } = Spin.metrics(m.size);
    box.innerHTML = Spin.build({ size: m.size, count: m.count, np: m.np, layout: m.layout });
    box.style.transform = `translate(${m.x - cx}px, ${m.y - cy}px)`;
    renderBeads();
    Spin.setHover(svg(), -1, st);
    document.body.classList.add('spinning');
    pointerAngle = null;
    pointerEl.classList.remove('hot');
    pointerEl.style.translate = `${m.x}px ${m.y}px`;
    pointerEl.classList.add('show');
    label.classList.remove('leave');
    label.classList.add('show');
    updateLabel();
  }
  function close(choice) {
    const s = svg();
    if (!st) return;
    pointerEl.classList.remove('show');
    label.classList.remove('show');
    document.body.classList.remove('spinning');
    if (s) {
      const slice = choice ? { toggle: 0, next: 1, volume: 2, prev: 3, playlist: 4 }[choice.cmd] ?? (choice.side === 'up' ? 1 : 3) : null;
      if (slice != null) s.querySelector(`.slice[data-i="${slice}"]`)?.classList.add('picked', 'hot');
      if (choice?.cmd === 'play' || choice?.cmd === 'playlist') s.querySelector(`.beads[data-side="${choice.side}"] .bead[data-k="${choice.k}"]`)?.classList.add('picked');
      s.classList.remove('enter');
      s.classList.add('leave');
      leaveTimer = setTimeout(() => { box.innerHTML = ''; }, 220);
    }
    st = null;
  }

  function follow(p) {
    if (st && p) pointerEl.style.translate = `${p.x}px ${p.y}px`;
  }
  const onLocal = (e) => { lastLocal = performance.now(); follow({ x: e.clientX, y: e.clientY }); };
  addEventListener('pointerrawupdate', onLocal, { passive: true });
  addEventListener('pointermove', onLocal, { passive: true });

  scrawl.on('cursor', (p) => { if (performance.now() - lastLocal > 60) follow(p); });
  scrawl.on('spin:open', open);
  scrawl.on('spin:close', close);
  scrawl.on('spin:hover', ({ hover, volume }) => {
    if (!st) return;
    st.hover = hover;
    if (volume != null) st.volume = volume;
    Spin.setHover(svg(), hover, st);
    aim(hover);
    updateLabel();
  });
  scrawl.on('spin:view', ({ view, shift }) => {
    if (!st) return;
    st.view = view;
    renderBeads(shift);
    Spin.setHover(svg(), st.hover, st);
    updateLabel();
  });
  // Fresh news from the music app: a new song, cover art, the list arriving.
  scrawl.on('spin:data', (d) => {
    if (!st) return;
    const songChanged = d.np?.track?.id !== st.np?.track?.id || d.np?.track?.art !== st.np?.track?.art || d.np?.state !== st.np?.state;
    Object.assign(st, { np: d.np, view: d.view, error: d.error, app: d.app, linked: d.linked, volume: st.volume ?? d.volume });
    if (songChanged) {
      // Rebuild the middle record and the play/pause icon, keeping the wheel where it is.
      const s = svg();
      const fresh = document.createElement('div');
      fresh.innerHTML = Spin.build({ size: st.size, count: st.count, np: st.np, enter: false, layout: st.layout });
      const nh = fresh.querySelector('.hub-now'), oh = s?.querySelector('.hub-now');
      if (nh && oh) oh.replaceWith(nh);
      const ni = fresh.querySelector('.slice[data-i="0"] .ico'), oi = s?.querySelector('.slice[data-i="0"] .ico');
      if (ni && oi) oi.parentNode.replaceWith(ni.parentNode);
    }
    renderBeads();
    Spin.setHover(svg(), st.hover, st);
    updateLabel();
  });
})();
