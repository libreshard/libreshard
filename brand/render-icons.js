// Generates the brand PNGs and the full logo from viewer/brand/logo-mark.svg.
// Usage: npm run icons   (uses Electron to rasterize the SVG; no other dependencies needed)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mark = fs.readFileSync(path.join(root, 'viewer', 'brand', 'logo-mark.svg'), 'utf8');
const NAVY = '#0d1b2a';

// radius: background corners in % (0 = full square, for iOS, which rounds it itself)
const outputs = [
  { file: 'build/icon.png', size: 1024, radius: 22 },
  { file: 'viewer/brand/icon-512.png', size: 512, radius: 22 },
  { file: 'viewer/brand/icon-192.png', size: 192, radius: 22 },
  { file: 'viewer/brand/apple-touch-icon.png', size: 180, radius: 0 },
];

function page(size, radius) {
  const pad = Math.round(size * 0.12);
  return `<!doctype html><style>
    html,body{margin:0;background:transparent;overflow:hidden}
    div{width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px;
        border-radius:${radius}%;background:radial-gradient(circle at 50% 45%,#16304a,${NAVY} 70%)}
    svg{width:100%;height:100%;display:block}
  </style><div>${mark}</div>`;
}

// Full logo (mark + name) for the README
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 420">
  <defs><radialGradient id="bg" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#16304a"/><stop offset="1" stop-color="${NAVY}"/></radialGradient></defs>
  <rect width="960" height="420" rx="24" fill="url(#bg)"/>
  ${mark.replace('<svg ', '<svg x="370" y="24" width="220" height="220" ')}
  <text x="480" y="320" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',Arial,sans-serif" font-size="78" font-weight="800" letter-spacing="8"><tspan fill="#22d3ee">LIBRE</tspan><tspan fill="#fbbf24">SHARD</tspan></text>
  <text x="480" y="372" text-anchor="middle" font-family="'Segoe UI','Helvetica Neue',Arial,sans-serif" font-size="22" font-weight="600" letter-spacing="6" fill="#9cc3e0">OPEN-SOURCE CONTROL DECK</text>
</svg>
`;
fs.writeFileSync(path.join(__dirname, 'logo-full.svg'), full);
console.log('brand/logo-full.svg');

app.on('window-all-closed', () => {}); // windows are closed between captures

app.whenReady().then(async () => {
  for (const o of outputs) {
    const win = new BrowserWindow({
      width: o.size, height: o.size, show: false, frame: false, transparent: true,
      useContentSize: true, backgroundColor: '#00000000', webPreferences: { offscreen: true },
    });
    win.webContents.setFrameRate(1);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(o.size, o.radius)));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: o.size, height: o.size });
    const out = path.join(root, o.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.resize({ width: o.size, height: o.size, quality: 'best' }).toPNG());
    console.log(o.file, o.size + 'px');
    win.destroy();
  }
  app.quit();
});
