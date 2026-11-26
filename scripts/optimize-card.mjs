#!/usr/bin/env node
/**
 * Lossless-ish compaction for the handover card.
 * The card is a 300 dpi photographic capture plus a gradient scrim, so it lands near 1 MB
 * from the screenshot encoder. Reducing the palette to 5 bits per channel — 32,768 colours,
 * far more than a scrim and a flat overlay need — drops it well under the 700 kB budget
 * without touching geometry, text or the QR placement. Run after scripts/card.mjs.
 *
 * Sets the pHYs chunk to 300 dpi again, because the re-encode drops ancillary chunks.
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const SRC = "assets/photos/handover.png";
const DPI = 300;
const BITS = 5;

const png = PNG.sync.read(readFileSync(SRC));
const { width: w, height: h, data } = png;
const step = 255 / ((1 << BITS) - 1);
const out = Buffer.alloc(w * h * 4);

for (let i = 0; i < data.length; i += 4) {
  for (let c = 0; c < 3; c++) {
    const q = Math.round(data[i + c] / step) * step;
    out[i + c] = q < 0 ? 0 : q > 255 ? 255 : q;
  }
  out[i + 3] = 255;
}

const quantised = new PNG({ width: w, height: h });
out.copy(quantised.data);
let buf = PNG.sync.write(quantised, {
  colorType: 6, deflateLevel: 9, deflateStrategy: 0, filterType: 4,
});

/* --- put the physical size back --- */
function setDpiPng(pngBuf, dpi) {
  const chunks = [];
  let off = 8;
  while (off < pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.toString("ascii", off + 4, off + 8);
    chunks.push({ type, start: off, total: 12 + len });
    off += 12 + len;
    if (type === "IEND") break;
  }
  const phys = chunks.find((c) => c.type === "pHYs");
  const base = phys
    ? Buffer.concat([pngBuf.slice(0, phys.start), pngBuf.slice(phys.start + phys.total)])
    : pngBuf;
  const ppm = Math.round(dpi / 0.0254);
  const payload = Buffer.alloc(9);
  payload.writeUInt32BE(ppm, 0);
  payload.writeUInt32BE(ppm, 4);
  payload.writeUInt8(1, 8);
  const crc = zlib.crc32(Buffer.concat([Buffer.from("pHYs", "ascii"), payload]));
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write("pHYs", 4, "ascii");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc >>> 0, 8 + payload.length);

  // pHYs must sit after IHDR, which is always the first chunk
  const ihdrLen = base.readUInt32BE(8);
  const insertAt = 8 + 12 + ihdrLen;
  return Buffer.concat([base.slice(0, insertAt), chunk, base.slice(insertAt)]);
}

buf = setDpiPng(buf, DPI);
writeFileSync(SRC, buf);
console.log(
  `✓ ${SRC} ${w}x${h} ${DPI} dpi, ${BITS}-bit palette, ${(buf.length / 1024).toFixed(0)} kB`
);
