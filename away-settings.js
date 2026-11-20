// The Away page of the settings window. Shares S, save(), shake(), swapText() and status with settings.js.

// ---------- keys: a shortcut like ⌃⌘A, chosen by pressing it ----------
const awayWell = document.getElementById('awayWell');
const AWAY_CAPTION = 'Click the keys to choose different ones.';
let awayListening = false;

const MOD_ORDER = [ // macOS writes modifiers in this order
  { prop: 'ctrlKey', acc: 'Control', sym: '⌃', name: 'Control' },
  { prop: 'altKey', acc: 'Alt', sym: '⌥', name: 'Option' },
  { prop: 'shiftKey', acc: 'Shift', sym: '⇧', name: 'Shift' },
  { prop: 'metaKey', acc: 'Command', sym: '⌘', name: 'Command' },
];
const NAMED = {
  Space: ['Space', '␣'], Enter: ['Return', '↩'], Tab: ['Tab', '⇥'], Backspace: ['Backspace', '⌫'], Delete: ['Delete', '⌦'],
  Escape: ['Escape', '⎋'], ArrowUp: ['Up', '↑'], ArrowDown: ['Down', '↓'], ArrowLeft: ['Left', '←'], ArrowRight: ['Right', '→'],
  Minus: ['-', '-'], Equal: ['=', '='], BracketLeft: ['[', '['], BracketRight: [']', ']'], Semicolon: [';', ';'], Quote: ["'", "'"],
  Comma: [',', ','], Period: ['.', '.'], Slash: ['/', '/'], Backslash: ['\\', '\\'], Backquote: ['`', '`'],
};
// The key itself, from its position on the keyboard (so ⌥ turning A into å doesn't matter).
function mainKey(code) {
  let m = /^Key([A-Z])$/.exec(code) || /^Digit(\d)$/.exec(code);
  if (m) return [m[1], m[1]];
  if (/^F\d{1,2}$/.test(code)) return [code, code];
  return NAMED[code] || null;
}
const held = (e) => MOD_ORDER.filter((m) => e[m.prop]);

function renderAwayKeys(symbols, { pop = false, partial = false } = {}) {
  awayWell.querySelector('.keys').innerHTML = symbols.map((s, i) =>
    `<span class="keycap${s.length > 1 ? ' word' : ''}${pop ? ' pop' : ''}${partial ? ' held' : ''}" style="--d:${i * 50}ms" aria-hidden="true">${s}</span>`).join('');
  awayWell.setAttribute('aria-label', `Away keys: ${S.away.keys.name}. Click to change.`);
}
function setAwayCaption(text, warn = false) {
  const c = document.getElementById('awayCaption');
  c.textContent = text;
  c.classList.toggle('warn', warn);
}
function cancelAwayListening() {
  if (!awayListening) return;
  awayListening = false;
  awayWell.classList.remove('listening');
  scrawl.send('away:bind', false);
  renderAwayKeys(S.away.keys.symbols);
  setAwayCaption(AWAY_CAPTION);
}
awayWell.addEventListener('click', () => {
  awayWell.blur();
  if (awayListening) { cancelAwayListening(); return; }
  if (listening) { stopListening(); scrawl.send('bind:cancel'); } // Scrawl's key chooser, from settings.js
  awayListening = true;
  awayWell.classList.add('listening');
  scrawl.send('away:bind', true);
  awayWell.querySelector('.keys').innerHTML = '<span class="prompt pop">Press keys</span>';
  setAwayCaption('Hold ⌘, ⌃ or ⌥ and press a key. Esc cancels.');
});

addEventListener('keydown', async (e) => {
  if (!awayListening) return;
  e.preventDefault();
  e.stopPropagation();
  const mods = held(e);
  if (e.code === 'Escape' && !mods.length) { cancelAwayListening(); return; }
  const key = mainKey(e.code);
  if (!key) { // only modifiers so far: show them as they're held
    if (mods.length) renderAwayKeys([...mods.map((m) => m.sym)], { partial: true });
    return;
  }
  if (!mods.some((m) => m.prop !== 'shiftKey')) {
    setAwayCaption('Add ⌘, ⌃ or ⌥, so typing never sets it off.', true);
    shake(awayWell);
    return;
  }
  const keys = {
    accelerator: [...mods.map((m) => m.acc), key[0]].join('+'),
    symbols: [...mods.map((m) => m.sym), key[1]],
    name: [...mods.map((m) => m.name), key[0]].join(' '),
  };
  awayListening = false;
  awayWell.classList.remove('listening');
  const { settings, error } = await scrawl.invoke('away:keys', keys);
  S = settings;
  renderAwayKeys(S.away.keys.symbols, { pop: !error });
  if (error) { setAwayCaption(error, true); shake(awayWell); } else setAwayCaption(AWAY_CAPTION);
  updateAwayStatus();
}, true);
addEventListener('keyup', (e) => {
  if (!awayListening) return;
  const mods = held(e);
  awayWell.querySelector('.keys').innerHTML = mods.length
    ? mods.map((m) => `<span class="keycap held" aria-hidden="true">${m.sym}</span>`).join('')
    : '<span class="prompt">Press keys</span>';
});
addEventListener('blur', cancelAwayListening);

// ---------- on / off ----------
document.getElementById('awayPower').addEventListener('click', (e) => {
  e.currentTarget.blur();
  cancelAwayListening();
  saveAway({ enabled: !S.away.enabled }).then(pollStatus);
});
function updateAwayStatus() {
  if (!S) return;
  const on = S.away.enabled !== false;
  const keys = S.away.keys.symbols.join('');
  const power = document.getElementById('awayPower');
  power.classList.toggle('off', !on);
  power.setAttribute('aria-pressed', on);
  swapText(document.getElementById('awayPowerText'), on ? 'Turn off' : 'Turn on');
  document.getElementById('awayPage').classList.toggle('off', !on);
  const ready = on && status.awayKey;
  document.getElementById('awayStatus').classList.toggle('ready', ready);
  swapText(document.getElementById('awayStatusText'), !on
    ? `Off. ${keys} goes to your apps as usual.`
    : ready ? `On. Press ${keys} anywhere to step away.` : `Another app is using ${keys}. Click the keys to pick others.`);
}

// ---------- the little screen ----------
function renderScreen() {
  const a = S.away;
  const msg = a.message.trim() || Tools.DEFAULT_MESSAGE;
  document.getElementById('miniMsg').textContent = msg;
  const colors = Tools.mood(a.mood).colors;
  document.querySelectorAll('#screen .mblob').forEach((b, i) => b.style.setProperty('--c', colors[i]));
  document.getElementById('miniSince').classList.toggle('gone', !a.showTime);
}
document.getElementById('miniCup').innerHTML = Tools.glyph('away', 26);
document.getElementById('miniSince').textContent = `Away since ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
document.getElementById('tryAway').addEventListener('click', (e) => { e.currentTarget.blur(); cancelAwayListening(); scrawl.send('away:show'); });

// ---------- message ----------
const msgEl = document.getElementById('message');
msgEl.placeholder = Tools.DEFAULT_MESSAGE;
let msgTimer;
function syncCount() {
  document.getElementById('msgCount').textContent = `${msgEl.value.length}/${msgEl.maxLength}`;
  document.getElementById('resetMsg').classList.toggle('show', msgEl.value !== Tools.DEFAULT_MESSAGE);
}
msgEl.addEventListener('input', () => {
  S.away = { ...S.away, message: msgEl.value };
  renderScreen();
  syncCount();
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => saveAway({ message: msgEl.value }), 300);
});
msgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); msgEl.blur(); } });
document.getElementById('resetMsg').addEventListener('click', () => {
  msgEl.value = Tools.DEFAULT_MESSAGE;
  msgEl.animate([{ transform: 'scale(0.98)' }, { transform: 'none' }], { duration: 320, easing: BOUNCY });
  saveAway({ message: Tools.DEFAULT_MESSAGE });
});

// ---------- moods ----------
function renderMoods() {
  const box = document.getElementById('moods');
  if (!box.children.length) {
    Tools.MOODS.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'swatch pop';
      const [c1, c2, c3] = m.colors;
      b.style.setProperty('--c', `conic-gradient(from 200deg, ${c1}, ${c2}, ${c3}, ${c1})`);
      b.style.setProperty('--lipc', `color-mix(in srgb, ${c1} 60%, #2B2733)`);
      b.style.setProperty('--d', `${320 + i * 35}ms`);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', m.name);
      b.title = m.name;
      b.dataset.mood = m.id;
      b.addEventListener('animationend', () => b.classList.remove('pop'), { once: true });
      b.addEventListener('click', () => saveAway({ mood: m.id }));
      box.appendChild(b);
    });
  }
  for (const b of box.children) b.setAttribute('aria-checked', b.dataset.mood === S.away.mood);
}

// ---------- switches ----------
for (const id of ['showTime', 'hidePointer']) {
  document.getElementById(id).addEventListener('click', () => saveAway({ [id]: !S.away[id] }));
}

function saveAway(patch) {
  return save({ away: { ...S.away, ...patch } });
}

let awayStarted = false;
function updateAway() {
  if (!S?.away) return;
  if (!awayStarted) {
    awayStarted = true;
    renderAwayKeys(S.away.keys.symbols, { pop: true });
    awayWell.querySelectorAll('.keycap').forEach((k, i) => k.style.setProperty('--d', `${260 + i * 60}ms`));
  }
  if (document.activeElement !== msgEl && msgEl.value !== S.away.message) msgEl.value = S.away.message;
  syncCount();
  renderMoods();
  document.getElementById('showTime').setAttribute('aria-checked', S.away.showTime);
  document.getElementById('hidePointer').setAttribute('aria-checked', S.away.hidePointer);
  renderScreen();
  updateAwayStatus();
}
