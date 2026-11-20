// Renders the app icon from assets/logo.svg: assets/icon-1024.png, assets/icon.icns, and the website's
// docs/icon.png (256) and docs/favicon.png (64).
// Run with: npx electron scripts/icons.js
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'logo.svg'), 'utf8');

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 400));
  const big = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = (size) => (size === 1024 ? big : big.resize({ width: size, height: size, quality: 'best' })).toPNG();

  fs.writeFileSync(path.join(root, 'assets', 'icon-1024.png'), png(1024));
  fs.writeFileSync(path.join(root, 'docs', 'icon.png'), png(256));
  fs.writeFileSync(path.join(root, 'docs', 'favicon.png'), png(64));

  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-icon-')) + '/icon.iconset';
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${s}x${s}.png`), png(s));
    fs.writeFileSync(path.join(set, `icon_${s}x${s}@2x.png`), png(s * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'assets', 'icon.icns')]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
  console.log('Rendered assets/icon-1024.png, assets/icon.icns, docs/icon.png, docs/favicon.png');
  app.exit(0);
});
