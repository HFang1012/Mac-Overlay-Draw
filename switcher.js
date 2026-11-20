// The tool button in the top-right corner: pick which of Pane's tools the window shows.
const switchBtn = document.getElementById('switchBtn');
const switchMenu = document.getElementById('switchMenu');
const PAGES = { scrawl: document.getElementById('page'), away: document.getElementById('awayPage') };
let currentPage = null;

// Each tool in the menu: its glyph on a tile, name, one line about it, and a tick on the open one.
Tools.TOOLS.forEach((t, k) => {
  const b = document.createElement('button');
  b.className = 'tool-item';
  b.setAttribute('role', 'menuitemradio');
  b.dataset.tool = t.id;
  b.style.setProperty('--k', k);
  b.innerHTML = `<span class="tile-glyph">${Tools.glyph(t.id, 24)}</span><span><b>${t.name}</b><small>${t.blurb}</small></span>` +
    '<span class="tick" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2l2 2L8 3" fill="none" stroke="#FBF8F3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  b.addEventListener('click', () => { closeSwitcher(true); showPage(t.id, true); });
  switchMenu.appendChild(b);
});
const items = () => [...switchMenu.querySelectorAll('.tool-item')];

function openSwitcher() {
  switchMenu.classList.add('open');
  switchBtn.setAttribute('aria-expanded', 'true');
  (items().find((b) => b.dataset.tool === currentPage) || items()[0]).focus({ preventScroll: true });
}
function closeSwitcher(refocus = false) {
  if (!switchMenu.classList.contains('open')) return;
  switchMenu.classList.remove('open');
  switchBtn.setAttribute('aria-expanded', 'false');
  if (refocus) switchBtn.focus({ preventScroll: true });
}
switchBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (switchMenu.classList.contains('open')) closeSwitcher();
  else openSwitcher();
});
addEventListener('pointerdown', (e) => { if (!e.target.closest('#switcher')) closeSwitcher(); });
addEventListener('blur', () => closeSwitcher());
switchMenu.addEventListener('keydown', (e) => {
  const list = items(), i = list.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeSwitcher(true); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
  }
});

// The button's label rolls over to the new tool's name.
function labelButton(id, animate) {
  const t = Tools.TOOLS.find((x) => x.id === id);
  const name = document.getElementById('swName');
  document.getElementById('swGlyph').innerHTML = Tools.glyph(id, 16);
  switchBtn.setAttribute('aria-label', `Tool: ${t.name}. Switch tools`);
  if (!animate) { name.textContent = t.name; return; }
  name.classList.add('out');
  setTimeout(() => { name.textContent = t.name; name.classList.remove('out'); }, 140);
}

function showPage(id, animate) {
  if (!PAGES[id] || id === currentPage) return;
  const from = PAGES[currentPage];
  const to = PAGES[id];
  currentPage = id;
  items().forEach((b) => b.setAttribute('aria-checked', b.dataset.tool === id));
  labelButton(id, animate);
  if (typeof cancelAwayListening === 'function') cancelAwayListening();
  if (S && S.page !== id) save({ page: id });
  if (!animate || !from) {
    for (const p of Object.values(PAGES)) p.hidden = p !== to;
    fit(false);
    return;
  }
  // Old page sinks away, the new one rises in, and the window grows or shrinks to fit it.
  from.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(0.985)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' })
    .finished.then(() => {
      from.getAnimations().forEach((a) => a.cancel());
      from.hidden = true;
      to.hidden = false;
      fit(true);
      to.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: SMOOTH_EASE });
      to.querySelectorAll('.card, .keycap, .brand .mark').forEach((el, i) =>
        el.animate([{ transform: 'translateY(10px) scale(0.92)' }, { transform: 'none' }], { duration: 560, delay: 40 + i * 30, easing: BOUNCY, fill: 'backwards' }));
    });
}
const SMOOTH_EASE = getComputedStyle(document.documentElement).getPropertyValue('--smooth').trim();

// ---------- the window hugs whichever page is showing ----------
let fitFrame = 0;
function fit(animate) {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const p = PAGES[currentPage];
    if (p && !p.hidden) scrawl.send('window:fit', p.offsetHeight, animate);
  });
}
const ro = new ResizeObserver(() => fit(false));
Object.values(PAGES).forEach((p) => ro.observe(p));

// Fill each brand mark with its tool's glyph.
document.querySelectorAll('.mark[data-glyph]').forEach((m) => { m.innerHTML = Tools.glyph(m.dataset.glyph, 22); });

// Called by settings.js once settings have loaded.
function startSwitcher() {
  showPage(S.page in PAGES ? S.page : 'scrawl', false);
}
