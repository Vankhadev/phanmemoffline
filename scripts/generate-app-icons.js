const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const rootDir = path.resolve(__dirname, '..');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFile(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, data);
}

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const value = String(hex || '').replace(/^#/, '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function blendPixel(buffer, size, x, y, color, alpha = 1) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
  const offset = (iy * size + ix) * 4;
  const srcA = clamp((color[3] ?? 255) * alpha, 0, 255) / 255;
  const dstA = buffer[offset + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const src = color[channel] / 255;
    const dst = buffer[offset + channel] / 255;
    buffer[offset + channel] = clamp(Math.round(((src * srcA) + (dst * dstA * (1 - srcA))) / outA * 255));
  }
  buffer[offset + 3] = clamp(Math.round(outA * 255));
}

function fillRoundedRect(buffer, size, x, y, w, h, r, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(size, Math.ceil(x + w));
  const y1 = Math.min(size, Math.ceil(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const dx = Math.max(x + r - px - 0.5, 0, px + 0.5 - (x + w - r));
      const dy = Math.max(y + r - py - 0.5, 0, py + 0.5 - (y + h - r));
      const dist = Math.sqrt(dx * dx + dy * dy);
      const coverage = clamp(r + 0.5 - dist, 0, 1);
      if (coverage > 0) blendPixel(buffer, size, px, py, color, coverage);
    }
  }
}

function fillCircle(buffer, size, cx, cy, radius, color) {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const x1 = Math.min(size, Math.ceil(cx + radius + 1));
  const y1 = Math.min(size, Math.ceil(cy + radius + 1));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const coverage = clamp(radius + 0.5 - dist, 0, 1);
      if (coverage > 0) blendPixel(buffer, size, x, y, color, coverage);
    }
  }
}

function drawLine(buffer, size, x1, y1, x2, y2, width, color) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width));
  const maxX = Math.min(size, Math.ceil(Math.max(x1, x2) + width));
  const maxY = Math.min(size, Math.ceil(Math.max(y1, y2) + width));
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lengthSq = vx * vx + vy * vy || 1;
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const t = clamp(((x + 0.5 - x1) * vx + (y + 0.5 - y1) * vy) / lengthSq, 0, 1);
      const px = x1 + vx * t;
      const py = y1 + vy * t;
      const dist = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      const coverage = clamp(width / 2 + 0.5 - dist, 0, 1);
      if (coverage > 0) blendPixel(buffer, size, x, y, color, coverage);
    }
  }
}

function fillPolygon(buffer, size, points, color) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
  const maxY = Math.min(size, Math.ceil(Math.max(...points.map(point => point[1]))));
  const minX = Math.max(0, Math.floor(Math.min(...points.map(point => point[0]))));
  const maxX = Math.min(size, Math.ceil(Math.max(...points.map(point => point[0]))));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const xi = points[i][0];
        const yi = points[i][1];
        const xj = points[j][0];
        const yj = points[j][1];
        if (((yi > y + 0.5) !== (yj > y + 0.5)) && (x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      if (inside) blendPixel(buffer, size, x, y, color, 1);
    }
  }
}

function makePng(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const bg1 = hexToRgb('#7c3aed');
  const bg2 = hexToRgb('#60a5fa');
  const bg3 = hexToRgb('#f0abfc');

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (size * 2);
      const wave = Math.sin((x / size) * Math.PI) * 0.15;
      const c1 = bg1.map((value, index) => mix(value, bg2[index], clamp(t + wave, 0, 1)));
      const c2 = c1.map((value, index) => mix(value, bg3[index], clamp((y / size - 0.55) * 1.6, 0, 0.55)));
      const offset = (y * size + x) * 4;
      buffer[offset] = Math.round(c2[0]);
      buffer[offset + 1] = Math.round(c2[1]);
      buffer[offset + 2] = Math.round(c2[2]);
      buffer[offset + 3] = 255;
    }
  }

  const s = size / 512;
  const white = [255, 255, 255, 255];
  const purple = [126, 58, 242, 255];
  const violet = [168, 85, 247, 255];
  const blue = [96, 165, 250, 255];
  const navy = [49, 46, 129, 255];
  const rose = [244, 114, 182, 255];
  const yellow = [253, 224, 71, 255];

  fillCircle(buffer, size, 116 * s, 126 * s, 72 * s, [219, 234, 254, 52]);
  fillCircle(buffer, size, 424 * s, 110 * s, 64 * s, [255, 255, 255, 46]);
  fillCircle(buffer, size, 94 * s, 410 * s, 82 * s, [255, 255, 255, 40]);

  fillRoundedRect(buffer, size, 94 * s, 116 * s, 228 * s, 156 * s, 34 * s, [255, 255, 255, 235]);
  fillRoundedRect(buffer, size, 112 * s, 137 * s, 188 * s, 42 * s, 14 * s, [147, 197, 253, 255]);
  fillRoundedRect(buffer, size, 125 * s, 149 * s, 72 * s, 18 * s, 6 * s, white);
  fillRoundedRect(buffer, size, 126 * s, 198 * s, 174 * s, 18 * s, 8 * s, [196, 181, 253, 255]);
  fillRoundedRect(buffer, size, 126 * s, 226 * s, 132 * s, 18 * s, 8 * s, rose);
  drawLine(buffer, size, 282 * s, 148 * s, 292 * s, 160 * s, 6 * s, white);
  drawLine(buffer, size, 296 * s, 140 * s, 310 * s, 158 * s, 6 * s, white);
  fillRoundedRect(buffer, size, 116 * s, 126 * s, 206 * s, 150 * s, 28 * s, [49, 46, 129, 64]);

  fillRoundedRect(buffer, size, 246 * s, 76 * s, 196 * s, 330 * s, 38 * s, navy);
  fillRoundedRect(buffer, size, 262 * s, 96 * s, 164 * s, 290 * s, 24 * s, white);
  fillRoundedRect(buffer, size, 248 * s, 78 * s, 192 * s, 76 * s, 28 * s, [109, 40, 217, 255]);
  const stripeW = 32 * s;
  for (let i = 0; i < 6; i += 1) {
    const x = (252 + i * 31) * s;
    const color = i % 2 === 0 ? violet : white;
    fillPolygon(buffer, size, [[x, 96 * s], [x + stripeW, 96 * s], [x + stripeW - 8 * s, 171 * s], [x - 10 * s, 171 * s]], color);
    fillCircle(buffer, size, x + stripeW / 2 - 5 * s, 170 * s, 18 * s, color);
  }

  drawLine(buffer, size, 306 * s, 217 * s, 326 * s, 217 * s, 16 * s, violet);
  drawLine(buffer, size, 326 * s, 217 * s, 344 * s, 291 * s, 16 * s, violet);
  fillPolygon(buffer, size, [[342 * s, 238 * s], [414 * s, 238 * s], [400 * s, 286 * s], [356 * s, 286 * s]], violet);
  drawLine(buffer, size, 354 * s, 306 * s, 402 * s, 306 * s, 12 * s, violet);
  fillCircle(buffer, size, 364 * s, 328 * s, 11 * s, violet);
  fillCircle(buffer, size, 398 * s, 328 * s, 11 * s, violet);
  fillRoundedRect(buffer, size, 334 * s, 348 * s, 74 * s, 32 * s, 16 * s, rose);

  fillRoundedRect(buffer, size, 90 * s, 330 * s, 180 * s, 102 * s, 28 * s, navy);
  fillRoundedRect(buffer, size, 112 * s, 344 * s, 72 * s, 52 * s, 14 * s, [255, 255, 255, 242]);
  drawLine(buffer, size, 133 * s, 359 * s, 150 * s, 383 * s, 9 * s, rose);
  drawLine(buffer, size, 150 * s, 383 * s, 169 * s, 352 * s, 9 * s, rose);
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const color = row === 1 && col > 1 ? yellow : [139, 92, 246, 255];
      fillRoundedRect(buffer, size, (198 + col * 24) * s, (348 + row * 30) * s, 16 * s, 18 * s, 5 * s, color);
    }
  }

  return encodePng(size, size, buffer);
}

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const item of pngs) {
    const entry = Buffer.alloc(16);
    entry[0] = item.size >= 256 ? 0 : item.size;
    entry[1] = item.size >= 256 ? 0 : item.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(item.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += item.png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(item => item.png)]);
}

function makeIcns(chunks) {
  const body = [];
  let totalLength = 8;
  for (const item of chunks) {
    const type = Buffer.from(item.type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(item.png.length + 8, 0);
    body.push(type, length, item.png);
    totalLength += item.png.length + 8;
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0);
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...body]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Ban Hang Offline">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="0.62" stop-color="#60a5fa"/>
      <stop offset="1" stop-color="#f0abfc"/>
    </linearGradient>
    <filter id="shadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#312e81" flood-opacity=".28"/>
    </filter>
  </defs>
  <rect x="28" y="28" width="456" height="456" rx="104" fill="url(#bg)"/>
  <circle cx="116" cy="126" r="72" fill="#dbeafe" opacity=".22"/>
  <circle cx="424" cy="110" r="64" fill="#fff" opacity=".18"/>
  <g filter="url(#shadow)">
    <rect x="94" y="116" width="228" height="156" rx="34" fill="#fff" opacity=".94"/>
    <rect x="112" y="137" width="188" height="42" rx="14" fill="#93c5fd"/>
    <rect x="125" y="149" width="72" height="18" rx="6" fill="#fff"/>
    <rect x="126" y="198" width="174" height="18" rx="8" fill="#c4b5fd"/>
    <rect x="126" y="226" width="132" height="18" rx="8" fill="#f472b6"/>
    <path d="M282 148l10 12m4-20l14 18" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
    <rect x="246" y="76" width="196" height="330" rx="38" fill="#312e81"/>
    <rect x="262" y="96" width="164" height="290" rx="24" fill="#fff"/>
    <rect x="248" y="78" width="192" height="76" rx="28" fill="#6d28d9"/>
    <path d="M252 96h32l-8 76h-42zM315 96h32l-7 76h-47zM378 96h32l-7 76h-47z" fill="#a855f7"/>
    <path d="M284 96h31l-7 76h-32zM347 96h31l-7 76h-31zM410 96h26v76h-33z" fill="#fff"/>
    <circle cx="268" cy="170" r="18" fill="#a855f7"/><circle cx="315" cy="170" r="18" fill="#fff"/>
    <circle cx="362" cy="170" r="18" fill="#a855f7"/><circle cx="409" cy="170" r="18" fill="#fff"/>
    <path d="M306 217h20l18 74h58l14-53h-74" fill="none" stroke="#a855f7" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M354 306h48" stroke="#a855f7" stroke-width="12" stroke-linecap="round"/>
    <circle cx="364" cy="328" r="11" fill="#a855f7"/><circle cx="398" cy="328" r="11" fill="#a855f7"/>
    <rect x="334" y="348" width="74" height="32" rx="16" fill="#f472b6"/>
    <rect x="90" y="330" width="180" height="102" rx="28" fill="#312e81"/>
    <rect x="112" y="344" width="72" height="52" rx="14" fill="#fff"/>
    <path d="M133 359l17 24 19-31" fill="none" stroke="#f472b6" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <g fill="#8b5cf6"><rect x="198" y="348" width="16" height="18" rx="5"/><rect x="222" y="348" width="16" height="18" rx="5"/><rect x="246" y="348" width="16" height="18" rx="5"/><rect x="198" y="378" width="16" height="18" rx="5"/><rect x="222" y="378" width="16" height="18" rx="5"/></g>
    <g fill="#fde047"><rect x="246" y="378" width="16" height="18" rx="5"/><rect x="270" y="378" width="16" height="18" rx="5"/></g>
  </g>
</svg>
`;

const pngBySize = new Map();
function png(size) {
  if (!pngBySize.has(size)) pngBySize.set(size, makePng(size));
  return pngBySize.get(size);
}

writeFile(path.join(rootDir, 'frontend/public/icons/app-icon.svg'), svg);
writeFile(path.join(rootDir, 'frontend/public/icons/app-icon-192.png'), png(192));
writeFile(path.join(rootDir, 'frontend/public/icons/app-icon-512.png'), png(512));
writeFile(path.join(rootDir, 'build/icon.svg'), svg);
writeFile(path.join(rootDir, 'build/icons/app-icon.svg'), svg);
writeFile(path.join(rootDir, 'build/icon.png'), png(512));
writeFile(path.join(rootDir, 'build/icons/app-icon.png'), png(512));
writeFile(path.join(rootDir, 'build/icon@2x.png'), png(256));
writeFile(path.join(rootDir, 'build/icons/app-icon@2x.png'), png(256));
writeFile(path.join(rootDir, 'build/icon.ico'), makeIco([16, 32, 48, 64, 128, 256].map(size => ({ size, png: png(size) }))));
writeFile(path.join(rootDir, 'build/icons/app-icon.ico'), makeIco([16, 32, 48, 64, 128, 256].map(size => ({ size, png: png(size) }))));
writeFile(path.join(rootDir, 'build/icon.icns'), makeIcns([
  { type: 'ic10', png: png(1024) },
  { type: 'ic09', png: png(512) },
  { type: 'ic08', png: png(256) },
  { type: 'ic07', png: png(128) },
]));
writeFile(path.join(rootDir, 'build/icons/app-icon.icns'), makeIcns([
  { type: 'ic10', png: png(1024) },
  { type: 'ic09', png: png(512) },
  { type: 'ic08', png: png(256) },
  { type: 'ic07', png: png(128) },
]));

const androidSizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

for (const [density, size] of Object.entries(androidSizes)) {
  const dir = path.join(rootDir, `android/app/src/main/res/mipmap-${density}`);
  writeFile(path.join(dir, 'ic_launcher.png'), png(size));
  writeFile(path.join(dir, 'ic_launcher_round.png'), png(size));
  writeFile(path.join(dir, 'ic_launcher_foreground.png'), png(size));
}

writeFile(
  path.join(rootDir, 'android/app/src/main/res/values/ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#7C3AED</color>\n</resources>\n'
);
writeFile(path.join(rootDir, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), png(1024));

console.log('[app-icons] Generated desktop, Android, iOS, and web icons.');
