// Renders assets/dmg/background.png (640×420) and background@2x.png for the disk window.
// Run with: npx electron scripts/dmg-background.js
// Finder draws the two icons on top at (170, 200) and (470, 200) — see scripts/dmg-settings.py.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 640, H = 420;
const html = `<!doctype html><html><head><style>
  html, body { margin: 0; overflow: hidden; } body { width: ${W}px; height: ${H}px; position: relative; }
  body { background: #F8FAFC; font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif; color: #262B36; -webkit-font-smoothing: antialiased; }
  /* A soft paper floor under the icons, like the card on the website. */
  .floor { position: absolute; left: 40px; right: 40px; top: 96px; height: 224px; border-radius: 28px; background: #EEF2F6; }
  svg { position: absolute; left: 236px; top: 150px; width: 168px; overflow: visible; }
  path { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-width: 13; }
  .lip { stroke: #D96F8A; } .ink { stroke: #F49CB0; }
  .head { fill: #F49CB0; stroke: #F49CB0; stroke-width: 4; stroke-linejoin: round; }
  .head-lip { fill: #D96F8A; stroke: #D96F8A; stroke-width: 4; stroke-linejoin: round; }
  h1 { position: absolute; top: 34px; width: 100%; margin: 0; text-align: center; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
  p { position: absolute; top: 346px; width: 100%; margin: 0; text-align: center; font-size: 14px; font-weight: 600; color: #5E6779; }
</style></head><body>
  <h1>Drag Scrawl into Applications</h1>
  <div class="floor"></div>
  <svg viewBox="0 0 320 150">
    <path class="lip" d="M14 98 C62 98 120 90 142 62 C160 38 150 14 130 18 C106 23 108 64 142 86 C184 112 252 104 294 70" transform="translate(0 6)"/>
    <path class="ink" id="ink" d="M14 98 C62 98 120 90 142 62 C160 38 150 14 130 18 C106 23 108 64 142 86 C184 112 252 104 294 70"/>
    <path class="head-lip" id="headLip" transform="translate(0 6)"/><path class="head" id="head"/>
  </svg>
  <p>Then open Scrawl from Applications. The first time, right-click it and choose Open.</p>
  <script>
    const ink = document.getElementById('ink'), len = ink.getTotalLength();
    const end = ink.getPointAtLength(len), back = ink.getPointAtLength(len - 8);
    const a = Math.atan2(end.y - back.y, end.x - back.x);
    const pt = (dx, dy) => (end.x + dx * Math.cos(a) - dy * Math.sin(a)).toFixed(1) + ',' + (end.y + dx * Math.sin(a) + dy * Math.cos(a)).toFixed(1);
    const d = 'M' + pt(14, 0) + ' L' + pt(-8, -15) + ' L' + pt(-8, 15) + ' Z';
    document.getElementById('head').setAttribute('d', d);
    document.getElementById('headLip').setAttribute('d', d);
  </script>
</body></html>`;

app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'assets', 'dmg');
  // Render once at 2× (page zoomed in), then scale down for the 1× file.
  const w = new BrowserWindow({ width: W * 2, height: H * 2, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html;base64,' + Buffer.from(html.replace('<body>', '<body style="zoom:2">')).toString('base64'));
  await new Promise((r) => setTimeout(r, 500));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: W * 2, height: H * 2 });
  const big = img.resize({ width: W * 2, height: H * 2, quality: 'best' });
  fs.writeFileSync(path.join(out, 'background@2x.png'), big.toPNG());
  fs.writeFileSync(path.join(out, 'background.png'), big.resize({ width: W, height: H, quality: 'best' }).toPNG());
  console.log('Rendered assets/dmg/background.png and background@2x.png');
  app.exit(0);
});
