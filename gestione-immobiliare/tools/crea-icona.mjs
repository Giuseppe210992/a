// Disegna l'icona del programma (build/icon.png, 512×512) senza immagini esterne:
// un riquadro azzurro arrotondato con un edificio bianco. Si rigenera con: node tools/crea-icona.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const D = 512;
const SS = 4; // campioni per lato in ogni pixel (bordi morbidi)

const tabellaCrc = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = tabellaCrc[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pezzo = (tipo, dati) => {
  const t = Buffer.from(tipo, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(dati.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dati])));
  return Buffer.concat([len, t, dati, crc]);
};

const dentroRettArrotondato = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const dentroRett = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Colore (RGBA) del punto: sfondo sfumato, edificio bianco con le finestre che lasciano vedere lo sfondo. */
function colore(x, y) {
  if (!dentroRettArrotondato(x, y, 16, 16, D - 16, D - 16, 112)) return [0, 0, 0, 0];
  const t = Math.min(1, Math.max(0, (x + y) / (2 * D)));
  const sfondo = [0x2a + (0x12 - 0x2a) * t * 0.9, 0x78 + (0x23 - 0x78) * t * 0.9, 0xd6 + (0x3b - 0xd6) * t * 0.9, 255];
  const edificio = dentroRettArrotondato(x, y, 130, 100, 300, 410, 14) || dentroRettArrotondato(x, y, 290, 215, 392, 410, 12);
  if (!edificio) return sfondo;
  const finestra = (x0, y0) => dentroRett(x, y, x0, y0, x0 + 34, y0 + 34);
  const finestre = [150, 212, 274].some((fy) => finestra(158, fy) || finestra(232, fy)) || finestra(324, 240) || finestra(324, 292);
  const porta = dentroRett(x, y, 195, 346, 235, 410) || dentroRett(x, y, 321, 350, 361, 410);
  return finestre || porta ? sfondo : [255, 255, 255, 255];
}

const raw = Buffer.alloc((D * 4 + 1) * D);
for (let py = 0; py < D; py++) {
  raw[py * (D * 4 + 1)] = 0; // filtro "nessuno"
  for (let px = 0; px < D; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = colore(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const o = py * (D * 4 + 1) + 1 + px * 4;
    if (a > 0) { raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a); }
    raw[o + 3] = Math.round(a / (SS * SS));
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(D, 0); ihdr.writeUInt32BE(D, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(raw, { level: 9 })), pezzo('IEND', Buffer.alloc(0))]);
const uscita = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(uscita), { recursive: true });
fs.writeFileSync(uscita, png);
console.log(`Icona scritta in ${uscita} (${png.length} byte)`);
