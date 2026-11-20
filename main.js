const { app, BrowserWindow, Menu, ipcMain, screen, systemPreferences, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const Wheel = require('./wheel.js'); // same geometry the wheel is drawn with, for hit-testing
const Tools = require('./tools.js'); // Pane's tools and Away's moods
const { execFile } = require('child_process');

// ---------- persistence ----------
// Ring tools. Undo and redo are half-size and start out side by side, so together they fill one slot.
// Letting go in the middle of the wheel cancels.
const TOOL_IDS = ['pencil', 'eraser', 'clear', 'undo', 'redo', 'toggle'];
const DEFAULTS = {
  hotkey: { codes: [UiohookKey.Alt, UiohookKey.AltRight], symbol: '⌥', name: 'Option' },
  // Held while a tool is in hand, it puts the pen down without clicking.
  drawKey: { codes: [UiohookKey.Ctrl, UiohookKey.CtrlRight], symbol: '⌃', name: 'Control' },
  tools: TOOL_IDS.map((id) => ({ id, on: true })),
  pencilColor: '#E5484D',
  pencilSize: 4,
  eraserSize: 28,
  wheelSize: 76,
  openAtLogin: false,
  enabled: true, // the on/off button: off means Scrawl ignores its keys and hides drawings (kept, not deleted)
  page: 'scrawl', // which tool the settings window shows
  away: {
    // A shortcut, not a held key: it toggles the Away screen. ⌃⌘A stays clear of Scrawl's ⌥ and of most apps.
    keys: { accelerator: 'Control+Command+A', symbols: ['⌃', '⌘', 'A'], name: 'Control Command A' },
    message: Tools.DEFAULT_MESSAGE,
    mood: 'dusk',
    showTime: true,
    hidePointer: true,
    enabled: true,
  },
};
const WHEEL_SIZES = [60, 76, 96]; // small, medium, large (outer radius, px)

const file = (name) => path.join(app.getPath('userData'), name);

// Scrawl used to be the whole app. Its settings and drawings move into Pane the first time Pane opens.
function migrateFromScrawl() {
  const old = path.join(app.getPath('appData'), 'Scrawl');
  if (fs.existsSync(file('settings.json')) || !fs.existsSync(path.join(old, 'settings.json'))) return;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  for (const name of ['settings.json', 'drawings.json']) {
    try { fs.copyFileSync(path.join(old, name), file(name)); } catch {}
  }
}
function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJSON(name, data) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(data));
}

let settings;
let drawings; // { [displayId]: stroke[] }
let saveTimer = null;
function saveDrawingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON('drawings.json', drawings), 400);
}

// ---------- runtime state ----------
let activeTool = null; // 'pencil' | 'eraser' | null
let visible = true;
let holding = false;
let binding = false; // false, or which key is being chosen: 'hotkey' | 'drawKey'
let pen = null; // { displayId } while the draw key is held
let quitting = false;
const menu = { open: false, x: 0, y: 0, displayId: null, hover: -1, items: [] };
const overlays = new Map(); // displayId -> BrowserWindow
let settingsWin = null;

const publicState = () => ({ activeTool, visible, settings });
function sendOverlays(channel, payload) {
  for (const w of overlays.values()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
function broadcast() {
  // Show any layer first, then send the new state, so fade-ins play on a window that's on screen.
  syncOverlays();
  sendOverlays('state', publicState());
  ensurePoll();
}

// ---------- overlay windows (one per display) ----------
// Above full-screen apps (and the menu bar) while in use; the layer is hidden the rest of the time.
const OVERLAY_LEVEL = 'screen-saver';

// Rebuild the layers only when screens really change (added, removed, moved, resized, rescaled).
// Switching Spaces or into a full-screen app changes each screen's *work area* (the menu bar and Dock
// hide), and rebuilding then used to tear the layers down mid-use.
const displaysKey = () => screen.getAllDisplays()
  .map((d) => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`)
  .sort().join('|');
let builtFor = '';
function refreshOverlays() {
  if (displaysKey() !== builtFor) createOverlays();
}

// Make sure a layer covers its whole screen, sits above full-screen apps, and joins every Space.
// Done each time it appears, because macOS can move or re-level a hidden panel.
function pinOverlay(w) {
  const d = screen.getAllDisplays().find((x) => String(x.id) === w.displayId);
  if (d) {
    const b = w.getBounds();
    if (b.x !== d.bounds.x || b.y !== d.bounds.y || b.width !== d.bounds.width || b.height !== d.bounds.height) w.setBounds(d.bounds);
  }
  w.setAlwaysOnTop(true, OVERLAY_LEVEL);
  // skipTransformProcessType: Electron's full-screen trick briefly turns Scrawl into a background app,
  // which can pull macOS back to Scrawl's Space. It's needed once, at creation; never again after.
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}

// A screen point in a layer's own coordinates, from the window's real frame (not the display's),
// so the wheel and pen land under the cursor even if macOS nudged the window.
function toLocal(id, p) {
  const w = overlays.get(id);
  const b = w && !w.isDestroyed()
    ? w.getBounds()
    : (screen.getAllDisplays().find((d) => String(d.id) === id)?.bounds ?? { x: 0, y: 0 });
  return { x: p.x - b.x, y: p.y - b.y };
}

function createOverlays() {
  builtFor = displaysKey();
  for (const w of overlays.values()) if (!w.isDestroyed()) w.destroy();
  overlays.clear();
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      ...d.bounds,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      acceptFirstMouse: true,
      type: 'panel',
      show: false,
      // The layer stays hidden most of the time; keep its page awake so the wheel appears instantly.
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    w.displayId = String(d.id);
    w.setIgnoreMouseEvents(true); // from the very start: an idle layer must never catch a click
    w.setAlwaysOnTop(true, OVERLAY_LEVEL);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // the one time the full-screen trick runs
    w.loadFile(path.join(__dirname, 'overlay.html'), { query: { id: String(d.id) } });
    w.once('ready-to-show', () => { pinOverlay(w); w.ready = true; syncOverlays(); });
    overlays.set(String(d.id), w);
  }
}

// While Scrawl is on, each display's drawing layer stays on screen all the time: fully transparent and
// letting every click through when idle, so you can't see or touch it. It must never be hidden, because
// macOS drops a hidden window's "join every Space" setting and brings it back on Scrawl's own Space,
// not the one you're on. Turning Scrawl off is the only time the layers leave the screen.
function overlayNeeded() {
  return settings.enabled;
}
function syncOverlays() {
  for (const [, w] of overlays) {
    if (w.isDestroyed() || !w.ready) continue;
    // Clicks pass straight through unless a pencil or eraser is in hand.
    w.setIgnoreMouseEvents(!activeTool);
    if (overlayNeeded()) {
      clearTimeout(w.hideTimer);
      w.hideTimer = null;
      if (!w.isVisible()) {
        pinOverlay(w);
        w.showInactive();
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      }
    } else if (w.isVisible() && !w.hideTimer) {
      // Turned off: let the drawings fade out first, then take the layer away.
      w.hideTimer = setTimeout(() => {
        w.hideTimer = null;
        if (!w.isDestroyed() && !overlayNeeded()) w.hide();
      }, 720);
    }
  }
}

// ---------- cursor polling (only while the wheel is open or a tool is held) ----------
let poll = null;
let lastCursorKey = '';
function ensurePoll() {
  const need = menu.open || !!activeTool;
  if (need && !poll) poll = setInterval(tick, 8);
  if (!need && poll) {
    clearInterval(poll); poll = null; lastCursorKey = '';
    sendOverlays('cursor', null);
  }
}
// -1 is the middle (cancel), n a slice, Wheel.COLOR_HOVER + i the pencil in Wheel.COLORS[i].
function hoverIndex(dx, dy) {
  return Wheel.hitTest(settings.wheelSize, menu.items, dx, dy, settings.pencilColor);
}
function tick() {
  const p = screen.getCursorScreenPoint();
  if (menu.open) {
    const h = hoverIndex(p.x - menu.x, p.y - menu.y);
    if (h !== menu.hover) {
      menu.hover = h;
      overlays.get(menu.displayId)?.webContents.send('menu:hover', h);
    }
  }
  const d = screen.getDisplayNearestPoint(p);
  if (pen && pen.displayId !== String(d.id)) penUp(); // a stroke can't cross between screens
  const key = `${d.id}:${p.x}:${p.y}`;
  if (key === lastCursorKey) return;
  lastCursorKey = key;
  for (const [id, w] of overlays) {
    if (w.isDestroyed()) continue;
    w.webContents.send('cursor', id === String(d.id) ? toLocal(id, p) : null);
  }
}

// ---------- wheel ----------
function openMenu() {
  penUp();
  const items = settings.tools.filter((t) => t.on).map((t) => t.id);
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  Object.assign(menu, { open: true, x: p.x, y: p.y, displayId: String(d.id), hover: -1, items });
  syncOverlays(); // make sure the layer is up,
  const layer = overlays.get(menu.displayId);
  if (layer && !layer.isDestroyed()) pinOverlay(layer); // covering this screen, then measure the cursor on it
  overlays.get(menu.displayId)?.webContents.send('menu:open', { ...toLocal(menu.displayId, p), items, ...publicState() });
  ensurePoll();
}
function closeMenu(pick) {
  if (!menu.open) return;
  // Read the cursor at the moment of release so a quick flick still lands on the right slice.
  const p = screen.getCursorScreenPoint();
  const hover = hoverIndex(p.x - menu.x, p.y - menu.y);
  let choice = null; // letting go in the middle cancels
  if (pick && hover >= Wheel.COLOR_HOVER) choice = { tool: 'pencil', color: Wheel.COLORS[hover - Wheel.COLOR_HOVER].hex };
  else if (pick && hover >= 0) choice = menu.items[hover];
  overlays.get(menu.displayId)?.webContents.send('menu:close', choice);
  menu.open = false;
  if (choice) applyTool(choice);
  else syncOverlays();
  ensurePoll();
}
function applyTool(id) {
  penUp();
  // A color from the ring beside the pencil: switch to it and pick up the pencil (never puts it down).
  if (id && typeof id === 'object') {
    settings = { ...settings, pencilColor: id.color };
    writeJSON('settings.json', settings);
    activeTool = 'pencil';
    visible = true;
    broadcast();
    settingsWin?.webContents.send('settings:changed', settings);
    return;
  }
  if (id === 'pencil' || id === 'eraser') {
    // Picking the tool you're already holding puts it down.
    activeTool = activeTool === id ? null : id;
    if (activeTool) visible = true;
  } else if (id === 'toggle') {
    activeTool = null;
    visible = !visible;
  } else if (id === 'clear') {
    activeTool = null;
    visible = true;
    if (Object.values(drawings).some((list) => list.length)) record({ type: 'clear', snapshot: drawings });
    drawings = {};
    writeJSON('drawings.json', drawings);
    sendOverlays('strokes:clear');
  } else if (id === 'undo' || id === 'redo') {
    // Keeps whatever tool you're holding, so you can undo and carry on drawing.
    step(id);
    return;
  }
  broadcast();
}

// ---------- undo / redo ----------
// Every pencil or eraser stroke, and Clear all, is one step. Kept in memory for this session.
const history = { undo: [], redo: [] };
function record(action) {
  history.undo.push(action);
  if (history.undo.length > 300) history.undo.shift();
  history.redo = [];
}
function step(dir) {
  const from = dir === 'undo' ? history.undo : history.redo;
  const to = dir === 'undo' ? history.redo : history.undo;
  const action = from.pop();
  if (!action) return;
  to.push(action);
  if (!visible) visible = true; // you should see what you're undoing
  if (action.type === 'stroke') {
    const list = (drawings[action.id] ||= []);
    if (dir === 'undo') {
      const i = list.lastIndexOf(action.stroke);
      if (i >= 0) list.splice(i, 1);
    } else {
      list.push(action.stroke);
    }
    syncOverlays();
    overlays.get(action.id)?.webContents.send(dir === 'undo' ? 'stroke:undo' : 'stroke:redo', action.stroke);
  } else if (action.type === 'clear') {
    if (dir === 'undo') {
      drawings = action.snapshot;
      syncOverlays();
      for (const [id, w] of overlays) w.webContents.send('strokes:restore', drawings[id] || []);
    } else {
      drawings = {};
      sendOverlays('strokes:clear');
    }
  }
  saveDrawingsSoon();
  broadcast();
}
function dropTool() {
  penUp();
  if (!activeTool) return;
  activeTool = null;
  broadcast();
}

// ---------- draw key: pen down without clicking ----------
function penDown() {
  if (!activeTool || menu.open || pen) return;
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  pen = { displayId: String(d.id) };
  overlays.get(pen.displayId)?.webContents.send('pen:down', toLocal(pen.displayId, p));
}
function penUp() {
  if (!pen) return;
  overlays.get(pen.displayId)?.webContents.send('pen:up');
  pen = null;
}

// ---------- key binding ----------
const keyName = {};
for (const [k, v] of Object.entries(UiohookKey)) if (!(v in keyName)) keyName[v] = k;
const MODIFIERS = { Alt: ['⌥', 'Option'], Ctrl: ['⌃', 'Control'], Meta: ['⌘', 'Command'], Shift: ['⇧', 'Shift'] };
const SYMBOLS = { CapsLock: '⇪', Space: '␣', Tab: '⇥', Backquote: '`', Backspace: '⌫', Enter: '↩' };
function keyInfo(code) {
  const n = keyName[code] || `Key ${code}`;
  const base = n.replace(/Right$/, '');
  if (MODIFIERS[base]) {
    return { codes: [UiohookKey[base], UiohookKey[`${base}Right`]], symbol: MODIFIERS[base][0], name: MODIFIERS[base][1] };
  }
  const nice = n === 'CapsLock' ? 'Caps Lock' : n;
  return { codes: [code], symbol: SYMBOLS[n] || (n.length <= 3 ? n : n[0]), name: nice };
}

// ---------- global input ----------
function isHotkey(code) { return settings.hotkey.codes.includes(code); }
function isDrawKey(code) { return settings.drawKey.codes.includes(code); }
const KEY_LABEL = { hotkey: 'wheel key', drawKey: 'draw key' };
uIOhook.on('keydown', (e) => {
  if (binding) {
    const which = binding;
    binding = false;
    let error = null;
    if (e.keycode !== UiohookKey.Escape) {
      const info = keyInfo(e.keycode);
      const other = which === 'hotkey' ? 'drawKey' : 'hotkey';
      if (info.codes.some((c) => settings[other].codes.includes(c))) {
        error = `${info.name} is already your ${KEY_LABEL[other]}. Pick a different one.`;
      } else {
        settings[which] = info;
        writeJSON('settings.json', settings);
      }
    }
    settingsWin?.webContents.send('bind:done', { settings, which, error });
    return;
  }
  if (away || awayBinding) return; // the Away screen is up (or its keys are being chosen): Scrawl sits still
  if (!settings.enabled) return; // turned off: every key goes untouched to your apps
  // ⌘Z / ⌘⇧Z undo and redo, but only with a pencil or eraser in hand (Scrawl can't stop the app
  // underneath from getting the keys too, and with a tool in hand you're drawing, not editing it).
  if (e.keycode === UiohookKey.Z && e.metaKey && activeTool && !menu.open) {
    step(e.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (isDrawKey(e.keycode)) {
    if (menu.open) closeMenu(false);
    else penDown();
    return;
  }
  if (isHotkey(e.keycode)) {
    // Open whenever the wheel isn't already up. Don't trust `holding` here: tapping fast can make macOS
    // drop a key-up, which used to leave `holding` stuck on and the wheel never opening again.
    holding = true;
    if (!menu.open) openMenu();
    return;
  }
  // Any other key while the wheel is up means the user is typing a combo (⌥+letter) — get out of the way.
  if (menu.open) { closeMenu(false); return; }
  if (e.keycode === UiohookKey.Escape) dropTool();
});
uIOhook.on('keyup', (e) => {
  if (away || awayBinding || !settings.enabled) return;
  if (isDrawKey(e.keycode)) { penUp(); return; }
  if (!isHotkey(e.keycode)) return;
  holding = false;
  closeMenu(true);
});


// ---------- Away: blur every screen, hide the pointer, leave a note ----------
// One window per screen, above everything (Scrawl's layers included). macOS blurs what's behind it
// (vibrancy), so Away needs no screen-recording access. The page adds the drifting color and the note.
let away = null; // { since, preview, wins, closing, front }
let awayBinding = false; // the settings window is listening for new Away keys
let awayKeyOn = false; // the Away shortcut is registered

function registerAwayKey() {
  globalShortcut.unregisterAll();
  awayKeyOn = false;
  if (!settings.away.enabled || awayBinding) return;
  try { awayKeyOn = globalShortcut.register(settings.away.keys.accelerator, toggleAway); } catch { awayKeyOn = false; }
}
function toggleAway() {
  if (away) hideAway();
  else showAway(false);
}

// Step a window's opacity (vibrancy can't be faded with CSS, so the whole window fades).
function fadeWindow(w, from, to, ms, done) {
  const t0 = Date.now();
  w.setOpacity(from);
  const id = setInterval(() => {
    if (w.isDestroyed()) { clearInterval(id); done?.(); return; }
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = to > from ? 1 - (1 - k) ** 3 : k * k; // ease out on the way in, ease in on the way out
    w.setOpacity(from + (to - from) * e);
    if (k >= 1) { clearInterval(id); done?.(); }
  }, 16);
}

// The pointer can only be hidden by the app in front, so Away comes to the front while it's up.
// Note which app that was (lsappinfo needs no permission), so it can be put back afterwards.
function frontApp() {
  return new Promise((resolve) => {
    execFile('lsappinfo', ['front'], (err, asn) => {
      if (err || !asn.trim()) return resolve(null);
      execFile('lsappinfo', ['info', '-only', 'bundleid', asn.trim()], (err2, out) => {
        const id = !err2 && /"CFBundleIdentifier"="([^"]+)"/.exec(out)?.[1];
        resolve(id || null);
      });
    });
  });
}

function showAway(preview = false) {
  if (away) return;
  if (menu.open) closeMenu(false);
  penUp();
  if (activeTool) { activeTool = null; broadcast(); }
  binding = false;
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const a = { since: Date.now(), preview, wins: [], closing: false, front: null };
  away = a;
  if (!preview) frontApp().then((id) => { if (id && id !== 'com.pane.app' && !id.startsWith('com.github.Electron')) a.front = id; });

  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      ...d.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'fullscreen-ui',
      visualEffectState: 'active', // stay blurred even though nothing here is clicked
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      type: 'panel',
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    const primary = d.id === cursor.id;
    w.setAlwaysOnTop(true, OVERLAY_LEVEL, 2); // above Scrawl's layers, so drawings blur too
    // The full-screen trick already ran once for Scrawl's layers; never again (it can jump Spaces).
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.loadFile(path.join(__dirname, 'away.html'), { query: { primary: primary ? '1' : '0' } });
    w.once('ready-to-show', () => {
      if (away !== a || a.closing) return;
      w.setBounds(d.bounds);
      w.setOpacity(0);
      w.show();
      if (primary) { w.focus(); app.focus({ steal: true }); }
      fadeWindow(w, 0, 1, 360);
    });
    a.wins.push(w);
  }
  buildMenu();
}

function hideAway() {
  const a = away;
  if (!a || a.closing) return;
  a.closing = true;
  for (const w of a.wins) {
    if (w.isDestroyed()) continue;
    w.webContents.send('away:leave');
    fadeWindow(w, w.getOpacity(), 0, 260, () => { if (!w.isDestroyed()) w.destroy(); });
  }
  setTimeout(() => {
    if (away === a) away = null;
    buildMenu();
    // Hand the keyboard back: to the settings window after a preview, otherwise to the app you were in.
    if (a.preview) { settingsWin?.show(); settingsWin?.focus(); }
    else if (a.front) execFile('osascript', ['-e', `tell application id "${a.front.replace(/"/g, '')}" to activate`], () => {});
  }, 280);
}

ipcMain.handle('away:init', () => ({
  ...settings.away,
  mood: Tools.mood(settings.away.mood),
  since: away?.since ?? Date.now(),
  preview: !!away?.preview,
}));
ipcMain.on('away:show', () => showAway(true));
// The page asks to close only for a preview: the real thing ends with the shortcut.
ipcMain.on('away:dismiss', () => { if (away?.preview) hideAway(); });
ipcMain.on('away:bind', (_e, on) => {
  awayBinding = !!on;
  if (on) { binding = false; if (menu.open) closeMenu(false); }
  registerAwayKey(); // off while listening, so the current keys reach the settings window too
});
ipcMain.handle('away:keys', (_e, keys) => {
  awayBinding = false;
  const before = settings.away.keys;
  settings = { ...settings, away: { ...settings.away, keys } };
  registerAwayKey();
  let error = null;
  if (settings.away.enabled && !awayKeyOn) {
    error = `Another app is already using ${keys.symbols.join('')}. Pick different keys.`;
    settings = { ...settings, away: { ...settings.away, keys: before } };
    registerAwayKey();
  }
  writeJSON('settings.json', settings);
  buildMenu();
  return { settings, error };
});

// ---------- settings window ----------
function createSettings() {
  settingsWin = new BrowserWindow({
    width: 900,
    height: 640,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ECE6DD',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    binding = false;
    settingsWin.hide();
  });
}

const trusted = () => systemPreferences.isTrustedAccessibilityClient(false);

// ---------- IPC ----------
ipcMain.handle('settings:get', () => ({ settings, trusted: trusted(), version: app.getVersion() }));
ipcMain.handle('settings:set', (_e, patch) => {
  if ('enabled' in patch) { setEnabled(patch.enabled); delete patch.enabled; }
  settings = { ...settings, ...patch };
  writeJSON('settings.json', settings);
  if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
  if ('away' in patch) { registerAwayKey(); buildMenu(); }
  broadcast();
  return settings;
});

// Turning Scrawl off puts everything down: closes the wheel, lifts the pen, drops the tool,
// and fades the drawings away. They're kept and come back when it's turned on again.
function setEnabled(on) {
  on = !!on;
  if (settings.enabled === on) return;
  if (!on) {
    closeMenu(false);
    penUp();
    activeTool = null;
    holding = false;
  }
  settings = { ...settings, enabled: on };
  writeJSON('settings.json', settings);
  broadcast();
  buildMenu();
  settingsWin?.webContents.send('settings:changed', settings);
}
ipcMain.handle('bind:start', (_e, which) => {
  if (!hookOn) return false; // can't hear keys yet: the settings screen explains why
  binding = which === 'drawKey' ? 'drawKey' : 'hotkey';
  penUp();
  if (menu.open) closeMenu(false);
  return true;
});
// The settings page measures itself, and the fixed-width window hugs that height.
ipcMain.on('window:fit', (_e, h, animate) => {
  if (settingsWin && h > 300 && h < 1400) settingsWin.setContentSize(900, Math.ceil(h), !!animate && settingsWin.isVisible());
});
ipcMain.on('bind:cancel', () => { binding = false; });
ipcMain.handle('perm:check', () => ({ trusted: trusted(), listening: hookOn, awayKey: awayKeyOn }));
ipcMain.on('perm:open', () => {
  systemPreferences.isTrustedAccessibilityClient(true);
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
});
ipcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0); });

ipcMain.handle('overlay:init', (_e, id) => ({ strokes: drawings[id] || [], state: publicState() }));
ipcMain.on('stroke:add', (_e, id, stroke) => {
  (drawings[id] ||= []).push(stroke);
  record({ type: 'stroke', id, stroke });
  saveDrawingsSoon();
  syncOverlays();
});
ipcMain.on('tool:drop', dropTool);

// ---------- lifecycle ----------
app.whenReady().then(() => {
  migrateFromScrawl();
  settings = { ...DEFAULTS, ...readJSON('settings.json', {}) };
  settings.away = { ...DEFAULTS.away, ...settings.away };
  if (!Tools.TOOLS.some((t) => t.id === settings.page)) settings.page = DEFAULTS.page;
  if (!WHEEL_SIZES.includes(settings.wheelSize)) settings.wheelSize = DEFAULTS.wheelSize;
  // Keep the saved order, but make sure every built-in tool is present exactly once.
  const known = settings.tools.filter((t) => TOOL_IDS.includes(t.id));
  settings.tools = [...known, ...TOOL_IDS.filter((id) => !known.some((t) => t.id === id)).map((id) => ({ id, on: true }))];
  writeJSON('settings.json', settings); // save the migrated list (e.g. show/hide moved to the middle, undo/redo added)
  drawings = readJSON('drawings.json', {});

  createOverlays();
  createSettings();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, refreshOverlays);
  }
  registerAwayKey();
  buildMenu();
  // Without Accessibility access the hook can't start. Keep trying, so granting access
  // in System Settings takes effect without a restart.
  startHook();
  hookTimer = setInterval(startHook, 1500);
});

let hookOn = false;
let hookTimer = null;
function startHook() {
  if (hookOn || !trusted()) return;
  try {
    uIOhook.start();
    hookOn = true;
    clearInterval(hookTimer);
  } catch (err) {
    console.warn('Key hook not started:', err.message);
  }
}

function buildMenu() {
  const show = () => { settingsWin.show(); settingsWin.focus(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: show },
        { label: settings.enabled ? 'Turn Scrawl Off' : 'Turn Scrawl On', click: () => setEnabled(!settings.enabled) },
        away
          ? { label: 'Come Back', click: hideAway }
          : { label: 'Step Away', accelerator: settings.away.keys.accelerator, registerAccelerator: false, click: () => showAway(false) },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { label: 'Pane', accelerator: 'Cmd+0', click: show },
      ],
    },
  ]));
}

app.on('activate', () => settingsWin?.show());
app.on('window-all-closed', () => { /* stay running: the overlay is the app */ });
app.on('before-quit', () => {
  quitting = true;
  clearTimeout(saveTimer);
  if (drawings) writeJSON('drawings.json', drawings);
  globalShortcut.unregisterAll();
  uIOhook.stop();
});

// Test hook: only present when SCRAWL_TEST is set (used by automated checks, never in normal runs).
if (process.env.SCRAWL_TEST) {
  global.__scrawlTest = { applyTool, step, setEnabled, overlays, menu, showAway, hideAway, awayWins: () => away?.wins ?? [], peek: () => ({ away: !!away, awayKey: awayKeyOn, activeTool, visible, menuOpen: menu.open, pencilColor: settings.pencilColor, enabled: settings.enabled, drawings, undo: history.undo.length, redo: history.redo.length }) };
}
