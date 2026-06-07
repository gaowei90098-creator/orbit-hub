import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 1024;

const BLUE = [88, 136, 255];
const TEAL = [68, 229, 205];
const AMBER = [255, 187, 90];
const INK = [7, 10, 18];

// --- minimal PNG (RGBA) encoder ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const add = (rgb, color, amount) => {
  rgb[0] += color[0] * amount;
  rgb[1] += color[1] * amount;
  rgb[2] += color[2] * amount;
};
const rotate = (x, y, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
};

const px = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2;
const cy = SIZE / 2;

const margin = 58;
const lo = margin;
const hi = SIZE - margin;
const radius = 228;
const tileAlpha = (x, y) => {
  if (x < lo || x > hi || y < lo || y > hi) return 0;
  const cxd = Math.max(lo + radius - x, 0, x - (hi - radius));
  const cyd = Math.max(lo + radius - y, 0, y - (hi - radius));
  const cd = Math.hypot(cxd, cyd);
  if (cd <= radius) return 1;
  return Math.max(0, 1 - (cd - radius) / 2);
};

const ellipseLine = (x, y, a, b, angle, width) => {
  const [xr, yr] = rotate(x, y, -angle);
  const unit = Math.sqrt((xr / a) ** 2 + (yr / b) ** 2);
  const dist = Math.abs(unit - 1) * Math.min(a, b);
  return Math.exp(-(dist * dist) / (2 * width * width));
};

const circle = (x, y, ox, oy, r, soft = 3) => 1 - smoothstep(r - soft, r + soft, Math.hypot(x - ox, y - oy));
const glow = (x, y, ox, oy, r) => Math.exp(-Math.hypot(x - ox, y - oy) / r);

const nodeOnOrbit = (a, b, angle, t) => {
  const x = a * Math.cos(t);
  const y = b * Math.sin(t);
  return rotate(x, y, angle);
};

const nodes = [
  [...nodeOnOrbit(318, 126, 0, 0.08), BLUE],
  [...nodeOnOrbit(318, 126, Math.PI / 3, 2.22), TEAL],
  [...nodeOnOrbit(318, 126, -Math.PI / 3, 4.22), AMBER],
  [...nodeOnOrbit(318, 126, Math.PI / 3, 5.46), BLUE],
];

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const rgb = [...INK];
    const a = tileAlpha(x, y);

    const radial = Math.max(0, 1 - dist / 620);
    add(rgb, BLUE, radial * 0.12);
    add(rgb, TEAL, radial * 0.06);

    const topSheen = Math.max(0, 1 - Math.hypot(x - 250, y - 160) / 520);
    add(rgb, [255, 255, 255], topSheen * 0.035);

    const orbits = [
      [0, BLUE, 1.0],
      [Math.PI / 3, TEAL, 0.9],
      [-Math.PI / 3, AMBER, 0.85],
    ];
    for (const [angle, color, strength] of orbits) {
      const line = ellipseLine(dx, dy, 318, 126, angle, 3.8);
      const halo = ellipseLine(dx, dy, 318, 126, angle, 15);
      add(rgb, color, halo * 0.16 * strength);
      add(rgb, color, line * 0.82 * strength);
      add(rgb, [255, 255, 255], line * 0.1);
    }

    const hubHalo = glow(x, y, cx, cy, 76);
    add(rgb, BLUE, hubHalo * 0.25);
    add(rgb, TEAL, hubHalo * 0.18);
    const hubOuter = circle(x, y, cx, cy, 70, 5);
    const hubInner = circle(x, y, cx, cy, 45, 5);
    add(rgb, [255, 255, 255], hubOuter * 0.14);
    add(rgb, BLUE, hubOuter * 0.42);
    add(rgb, INK, hubInner * -0.2);
    add(rgb, TEAL, circle(x, y, cx, cy, 22, 4) * 1.0);
    add(rgb, [255, 255, 255], circle(x, y, cx - 5, cy - 7, 8, 3) * 0.55);

    for (const [nx, ny, color] of nodes) {
      const ox = cx + nx;
      const oy = cy + ny;
      const nHalo = glow(x, y, ox, oy, 38);
      const nOuter = circle(x, y, ox, oy, 30, 4);
      const nInner = circle(x, y, ox, oy, 18, 3);
      add(rgb, color, nHalo * 0.46);
      add(rgb, color, nOuter * 0.8);
      add(rgb, [255, 255, 255], nInner * 0.38);
    }

    const edge = Math.max(
      smoothstep(lo, lo + 22, x) * smoothstep(hi, hi - 22, x),
      smoothstep(lo, lo + 22, y) * smoothstep(hi, hi - 22, y),
    );
    const vignette = Math.max(0, 1 - edge);
    add(rgb, BLUE, vignette * 0.04);

    const i = (y * SIZE + x) * 4;
    px[i] = clamp(rgb[0]);
    px[i + 1] = clamp(rgb[1]);
    px[i + 2] = clamp(rgb[2]);
    px[i + 3] = clamp(a * 255);
  }
}

const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(SIZE * stride);
for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0;
  px.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "icon.png");
fs.writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
