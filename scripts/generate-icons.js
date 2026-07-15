// Generate assets/tray.png (256×256) and assets/tray.ico (multi-size)
// from the same tri-color mark used by the tray icon at runtime.
//
// Run: `node scripts/generate-icons.js`  (also invoked by `npm run build`)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ============ mark geometry ============
const COLORS = [
  [110, 134, 255, 255], // indigo
  [74,  222, 128, 255], // emerald
  [245, 158, 11,  255], // amber
];

// Draw the tri-color mark on an RGBA canvas of the given size.
// Bars grow proportionally; padding + rounded ends keep it crisp at every size.
function drawMark(size) {
  const px = Buffer.alloc(size * size * 4);
  const pad = Math.round(size * 0.14);
  const gap = Math.round(size * 0.06);
  const totalW = size - 2 * pad;
  const barW = Math.max(2, Math.floor((totalW - 2 * gap) / 3));
  const startX = Math.round((size - (3 * barW + 2 * gap)) / 2);
  const baseY = size - pad;

  // Heights follow the "▍▊▎" rhythm: short-tall-mid.
  const heightRatio = [0.55, 0.75, 0.45];
  const heights = heightRatio.map(r => Math.round(size * r));
  const radius = Math.min(barW / 2, Math.round(size * 0.02));

  for (let i = 0; i < 3; i++) {
    const bx = startX + i * (barW + gap);
    const bTop = baseY - heights[i];
    fillRoundedRect(px, size, bx, bTop, barW, heights[i], radius, COLORS[i]);
  }
  return px;
}

function fillRoundedRect(px, size, x, y, w, h, r, rgba) {
  for (let py = y; py < y + h; py++) {
    for (let px_ = x; px_ < x + w; px_++) {
      if (px_ < 0 || px_ >= size || py < 0 || py >= size) continue;
      // Rounded corners via distance-to-corner test (top only — bars are flat-bottom OK)
      let inside = true;
      if (py < y + r && px_ < x + r) {
        const dx = (x + r) - px_ - 0.5, dy = (y + r) - py - 0.5;
        inside = dx * dx + dy * dy <= r * r;
      } else if (py < y + r && px_ > x + w - r - 1) {
        const dx = px_ - (x + w - r) + 0.5, dy = (y + r) - py - 0.5;
        inside = dx * dx + dy * dy <= r * r;
      }
      if (!inside) continue;
      const o = (py * size + px_) * 4;
      px[o] = rgba[0]; px[o + 1] = rgba[1]; px[o + 2] = rgba[2]; px[o + 3] = rgba[3];
    }
  }
}

// ============ PNG encoder ============
function pngEncode(width, height, rgba) {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, c]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ============ ICO packer ============
// ICO format = 6-byte header + 16-byte dir entries per image + concatenated PNGs
function icoEncode(images) {
  const HEADER_SIZE = 6;
  const DIR_ENTRY_SIZE = 16;
  const dataOffsetStart = HEADER_SIZE + images.length * DIR_ENTRY_SIZE;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type = 1 (icon)
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const blobs = [];
  let offset = dataOffsetStart;
  for (const img of images) {
    const dir = Buffer.alloc(DIR_ENTRY_SIZE);
    dir[0] = img.size === 256 ? 0 : img.size; // width (0 means 256)
    dir[1] = img.size === 256 ? 0 : img.size; // height
    dir[2] = 0;                               // palette
    dir[3] = 0;                               // reserved
    dir.writeUInt16LE(1, 4);                  // planes
    dir.writeUInt16LE(32, 6);                 // bpp
    dir.writeUInt32LE(img.png.length, 8);     // image size
    dir.writeUInt32LE(offset, 12);            // offset
    entries.push(dir);
    blobs.push(img.png);
    offset += img.png.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

// ============ generate ============
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map(size => ({ size, png: pngEncode(size, size, drawMark(size)) }));

// tray.png (biggest) for high-DPI displays + electron-builder fallback
fs.writeFileSync(path.join(OUT_DIR, 'tray.png'), images[images.length - 1].png);
console.log(`wrote assets/tray.png (${images[images.length - 1].png.length} bytes)`);

// icon.png for Linux electron-builder (harmless on Windows-only build)
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images[images.length - 1].png);

// tray.ico for installer + exe + Start Menu
const ico = icoEncode(images);
fs.writeFileSync(path.join(OUT_DIR, 'tray.ico'), ico);
console.log(`wrote assets/tray.ico (${ico.length} bytes, ${sizes.join('/')})`);
