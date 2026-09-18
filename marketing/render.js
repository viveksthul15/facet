// Render every template at every size to PNG, using the Electron already in devDependencies.
//   npx electron marketing/render.js
// Output: marketing/out/<template>-<WxH>.png
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// pixel-exact output regardless of the monitor's DPI scaling
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');

const TEMPLATES = ['race', 'receipt', 'tiles'];
const SIZES = ['1200x630', '1080x1350', '1080x1080'];
const OUT = path.join(__dirname, 'out');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // one offscreen window, resized per output — a fresh window per load failed with ERR_FAILED
  const win = new BrowserWindow({ width: 1200, height: 630, show: false, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  for (const t of TEMPLATES) {
    for (const size of SIZES) {
      const [w, h] = size.split('x').map(Number);
      win.setContentSize(w, h);
      await win.loadURL(`${pathToFileURL(path.join(__dirname, 'templates', `${t}.html`)).href}?size=${size}&t=${Date.now()}`);
      await new Promise((r) => setTimeout(r, 500)); // fonts
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
      const file = path.join(OUT, `${t}-${size}.png`);
      fs.writeFileSync(file, img.toPNG());
      console.log(`${path.relative(process.cwd(), file)}  ${img.getSize().width}x${img.getSize().height}`);
    }
  }
  app.quit();
});
