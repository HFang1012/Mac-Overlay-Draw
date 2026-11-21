// Updates from GitHub releases. Pane is signed only locally, so Electron's built-in updater
// (which needs an Apple Developer signature) can't be used. Instead:
//   1. ask GitHub for the newest release, and if it's newer, show what changed since this version
//   2. on yes: download Pane.dmg, copy Pane.app out of it, and check it's the version we expect
//   3. quit, and a tiny shell script swaps the new Pane.app in place of this one and opens it
const { app, dialog, net, shell, BrowserWindow } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'HFang1012/Pane-Mac';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const PAGE = `https://github.com/${REPO}/releases/latest`;
const FIRST_CHECK = 15 * 1000;
const EVERY = 6 * 60 * 60 * 1000;

let store = { get: () => ({}), set: () => {} };
let busy = false;
let timer = null;

// Lets the update flow be tried from a dev build: PANE_PRETEND_VERSION=1.0.0 npm start
const currentVersion = () => process.env.PANE_PRETEND_VERSION || app.getVersion();

function parse(v) {
  return String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))));

// The Pane.app this process is running from (…/Pane.app/Contents/MacOS/Pane).
const bundlePath = () => path.resolve(app.getPath('exe'), '..', '..', '..');

// Where an update can't be swapped in place: a dev build, the disk image itself, or a copy macOS
// is running from a hidden, read-only spot (App Translocation) because it was never moved.
function canInstallInPlace() {
  const b = bundlePath();
  if (!app.isPackaged || !b.endsWith('.app')) return false;
  if (b.startsWith('/Volumes/') || b.includes('/AppTranslocation/')) return false;
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); return true; } catch { return false; }
}

// ---------- asking GitHub ----------
async function fetchReleases() {
  const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Pane-updater' } });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return (await res.json()).filter((r) => !r.draft && !r.prerelease && /^v?\d+(\.\d+)*$/.test(r.tag_name));
}

// Every release newer than this one, newest first, folded into one changelog.
function changelog(releases, from) {
  const lines = [];
  for (const r of releases) {
    if (!newer(r.tag_name, from)) continue;
    const body = String(r.body || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^\*\*Full Changelog\*\*/i.test(l) && !/^#+\s*What's Changed/i.test(l))
      .map((l) => l.replace(/^[-*]\s+/, '• '));
    lines.push(`Pane ${r.tag_name.replace(/^v/, '')}`);
    lines.push(...(body.length ? body : ['• Small fixes and improvements']));
    lines.push('');
  }
  let text = lines.join('\n').trim();
  if (text.length > 1800) text = text.slice(0, 1800).replace(/\n[^\n]*$/, '') + '\n…and more on the releases page.';
  return text;
}

// ---------- the check ----------
async function check({ manual = false } = {}) {
  if (busy) return;
  busy = true;
  try {
    const releases = await fetchReleases();
    const latest = releases.reduce((best, r) => (!best || newer(r.tag_name, best.tag_name) ? r : best), null);
    const have = currentVersion();
    if (!latest || !newer(latest.tag_name, have)) {
      if (manual) await dialog.showMessageBox({ type: 'info', message: 'Pane is up to date', detail: `You have the newest version, ${have}.`, buttons: ['OK'] });
      return;
    }
    const version = latest.tag_name.replace(/^v/, '');
    if (!manual && store.get().skipped === version) return;

    const dmg = (latest.assets || []).find((a) => a.name.endsWith('.dmg'));
    const inPlace = dmg && canInstallInPlace();
    app.focus({ steal: true }); // Pane lives in the background: bring the question to the front
    const buttons = inPlace ? ['Update and Restart', 'Later', 'Skip This Version'] : ['Download', 'Later', 'Skip This Version'];
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `Pane ${version} is available`,
      detail: `You have ${have}. What's new:\n\n${changelog(releases, have)}`,
      buttons,
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 2) store.set({ skipped: version });
    if (response !== 0) return;
    if (!inPlace) { shell.openExternal(latest.html_url || PAGE); return; }
    await install(dmg, version);
  } catch (err) {
    console.warn('Update check failed:', err.message);
    if (manual) await dialog.showMessageBox({ type: 'warning', message: "Couldn't check for updates", detail: err.message, buttons: ['OK'] });
  } finally {
    busy = false;
  }
}

// ---------- download and swap ----------
function setProgress(p) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setProgressBar(p);
}

async function download(url, size, to) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Pane-updater' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const out = fs.createWriteStream(to);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (size) setProgress(Math.min(got / size, 1));
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  if (size && got !== size) throw new Error('The download was incomplete.');
}

// Downloads the release and unpacks Pane.app into a private folder. Returns where it put it.
async function prepare(asset, version) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-update-'));
  const dmgFile = path.join(work, 'Pane.dmg');
  const mount = path.join(work, 'mnt');
  const staged = path.join(work, 'Pane.app');
  try {
    await download(asset.browser_download_url, asset.size, dmgFile);
    setProgress(2); // indeterminate while unpacking
    fs.mkdirSync(mount);
    await run('hdiutil', ['attach', dmgFile, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount]);
    try {
      await run('ditto', [path.join(mount, 'Pane.app'), staged]);
    } finally {
      await run('hdiutil', ['detach', mount, '-force']).catch(() => {});
    }
    fs.rmSync(dmgFile, { force: true });
    const built = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', path.join(staged, 'Contents', 'Info.plist')])).trim();
    if (built !== version) throw new Error(`The download is version ${built}, not ${version}.`);
    await run('xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});
    return { work, staged };
  } catch (err) {
    fs.rmSync(work, { recursive: true, force: true });
    throw err;
  }
}

// Runs on its own once Pane (process PID) has quit: puts the old app aside, moves the new one in,
// opens it and tidies up. If the move fails, the old app goes back so Pane is never left missing.
const SWAP = `
while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
old="$WORK/Pane-old.app"
if mv "$TARGET" "$old" && mv "$STAGED" "$TARGET"; then
  rm -rf "$old"
else
  [ -d "$TARGET" ] || mv "$old" "$TARGET"
fi
[ -n "$NO_OPEN" ] || open "$TARGET"
rm -rf "$WORK"
`;
function swapAfterExit({ work, staged, target, pid, open = true }) {
  const child = spawn('/bin/sh', ['-c', SWAP], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PID: String(pid), WORK: work, TARGET: target, STAGED: staged, NO_OPEN: open ? '' : '1' },
  });
  child.unref();
  return child;
}

async function install(asset, version) {
  let ready;
  try {
    setProgress(0.01);
    ready = await prepare(asset, version);
  } catch (err) {
    setProgress(-1);
    const { response } = await dialog.showMessageBox({
      type: 'warning', message: "Pane couldn't update itself", detail: `${err.message}\n\nYou can download it from GitHub instead.`,
      buttons: ['Open Download Page', 'Cancel'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) shell.openExternal(PAGE);
    return;
  }
  setProgress(-1);
  swapAfterExit({ ...ready, target: bundlePath(), pid: process.pid });
  app.quit();
}

// ---------- wiring ----------
function start(opts = {}) {
  if (opts.store) store = opts.store;
  if (!app.isPackaged && !process.env.PANE_PRETEND_VERSION) return; // dev builds don't nag
  setTimeout(() => check(), FIRST_CHECK);
  clearInterval(timer);
  timer = setInterval(() => check(), EVERY);
}

module.exports = { start, check, newer, changelog, _test: { fetchReleases, prepare, swapAfterExit } };
