#!/usr/bin/env node
/**
 * Handover card: 10.5 x 14.5 cm @ 300 dpi = 1240 x 1712 px.
 * Tablet-width capture of the top section + QR bottom-right + side line, dpi written into the PNG.
 * Reads src/data.json for the brand name, slug and site domain; the QR and the printed
 * URL both derive from the same value the build uses.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import puppeteer from "puppeteer";
import QRCode from "qrcode";
import pkg from "pngjs";
const { PNG } = pkg;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, "tmp");
mkdirSync(TMP, { recursive: true });

const biz = JSON.parse(readFileSync(join(ROOT, "src/data.json"), "utf8"));
const BRAND = biz.name;
/* Same derivation as build.mjs: the printed URL and the QR must match what the site
   advertises, so both come from the code name and domain. */
const SITE_DOMAIN = biz.siteDomain || "vilanovailageltru.info";
const SITE_URL = (biz.siteUrl || `https://${biz.slug}.${SITE_DOMAIN}`).replace(/\/?$/, "/");
const LINE = "Ja tens pàgina web:";
/* Palette comes from data.json so the card matches the site; the literals are only a
   fallback. A per-site edit here would defeat the point of a shared script. */
const DEEP = biz.deep || "#0a1216";
const GOLD = biz.gold || "#e39a1c";
const LIGHT = biz.light || "#a3bcc6";
const PAPER = biz.paper || "#f8f7f4";
/* Split for print: the front half is "https://<code-name>." and the rest is "<domain>/". */
const PROTO = (SITE_URL.match(/^[a-z]+:\/\//i) || [""])[0];
const HOST = SITE_URL.slice(PROTO.length).split(".")[0];
const DOMAIN_PATH = SITE_URL.slice(PROTO.length + HOST.length + 1);

const CM_W = 10.5;
const CM_H = 14.5;
const DPI = 300;
// floor, not round: rounding 14.5 cm up to 1713 px overshoots the requested height
const W = Math.floor((CM_W / 2.54) * DPI + 1e-6);
const H = Math.floor((CM_H / 2.54) * DPI + 1e-6);
// Read the site's real breakpoints rather than guessing: if 820 happens to be one, the
// card silently captures the phone layout (hamburger, stacked hero). Pick a width above
// the highest mobile breakpoint, and verify the nav is horizontal at that width.
const RENDER_W = Number(biz.cardRenderWidth || 820);

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] });

const shotPage = await browser.newPage();
await shotPage.setViewport({ width: RENDER_W, height: 1200, deviceScaleFactor: 2 });
await shotPage.goto(BASE, { waitUntil: "networkidle2" });
await shotPage.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 800));
await shotPage.evaluate(() => {
  document.querySelectorAll(".reveal").forEach((e) => e.classList.add("is-visible"));
  /* The consent banner slides in after ~1.2 s and would be captured as an overlay on a
     printed card. The fade happens to cover it here, but relying on that is luck: hide
     any fixed overlay before the shot instead. */
  document.querySelectorAll(".cookiebar").forEach((e) => { e.style.display = "none"; });
});
await new Promise((r) => setTimeout(r, 400));

// A card captured at a mobile breakpoint shows the hamburger instead of the nav bar,
// which is not what the owner should see on the handover sheet. Fail loudly.
const navState = await shotPage.evaluate(() => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav, .site-nav, .primary-nav");
  const visible = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  };
  return { hasToggle: !!toggle, toggleVisible: visible(toggle), navVisible: visible(nav) };
});
if (navState.hasToggle && navState.toggleVisible && !navState.navVisible) {
  console.error(
    `✗ at ${RENDER_W} px the site is in its mobile layout (hamburger shown, nav hidden). ` +
    `Set "cardRenderWidth" in src/data.json above the mobile breakpoint and re-run.`
  );
  process.exitCode = 1;
}

const shot = await shotPage.screenshot({ encoding: "base64", clip: { x: 0, y: 0, width: RENDER_W, height: 1200 } });
writeFileSync(join(TMP, "tablet-top.png"), Buffer.from(shot, "base64"));

const qrDataUrl = await QRCode.toDataURL(SITE_URL, {
  errorCorrectionLevel: "M", margin: 1, width: 520,
  color: { dark: DEEP, light: "#ffffff" },
});

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const scale = W / 1240; // proportions taken from the 1240 px reference card
const cardPage = await browser.newPage();
await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await cardPage.setContent(
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;background:${DEEP};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .card{position:relative;width:${W}px;height:${H}px;overflow:hidden}
  .shot{position:absolute;inset:0;width:${W}px;height:${H}px;object-fit:cover;object-position:top center}
  .fade{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 52%,${DEEP}8c 68%,${DEEP}eb 82%,${DEEP} 93%)}
  .overlay{position:absolute;left:0;right:0;bottom:0;padding:0 ${Math.round(64 * scale)}px ${Math.round(60 * scale)}px;display:flex;align-items:flex-end;gap:${Math.round(40 * scale)}px}
  .copy{flex:1 1 auto;padding-bottom:14px;min-width:0}
  .kicker{font-weight:600;font-size:${Math.round(40 * scale)}px;letter-spacing:.16em;text-transform:uppercase;color:${GOLD};margin-bottom:${Math.round(18 * scale)}px}
  .line{font-weight:600;font-size:${Math.round(46 * scale)}px;line-height:1.16;letter-spacing:-.02em;color:${PAPER}}
  /* Break the URL before the domain instead of mid-token: the printed address stays
     copyable and reads as one line pair. */
  .url{margin-top:${Math.round(18 * scale)}px;font-weight:600;font-size:${Math.round(34 * scale)}px;line-height:1.3;color:${LIGHT};overflow-wrap:anywhere}
  .url .host{display:block}
  .qr{flex:none;background:#fff;border-radius:${Math.round(22 * scale)}px;padding:${Math.round(16 * scale)}px}
  .qr img{display:block;width:${Math.round(272 * scale)}px;height:${Math.round(272 * scale)}px}
  </style></head><body>
  <div class="card">
    <img class="shot" src="data:image/png;base64,${shot}">
    <div class="fade"></div>
    <div class="overlay">
      <div class="copy">
        <div class="kicker">${esc(BRAND)}</div>
        <div class="line">${esc(LINE)}</div>
        <div class="url"><span>${esc(`${PROTO}${HOST}.`)}</span><span class="host">${esc(DOMAIN_PATH)}</span></div>
      </div>
      <div class="qr"><img src="${qrDataUrl}" alt=""></div>
    </div>
  </div>
  </body></html>`,
  { waitUntil: "load" }
);
await cardPage.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 500));

// measure before saving: a clipped line or QR is only visible here
const fit = await cardPage.evaluate(() => {
  const out = {};
  document.querySelectorAll(".line, .url, .qr").forEach((el) => {
    const r = el.getBoundingClientRect();
    out[el.className] = {
      w: Math.round(r.width), h: Math.round(r.height),
      overflowRight: Math.round(r.right) > window.innerWidth,
      scrollOverflow: el.scrollWidth > el.clientWidth + 1,
    };
  });
  return out;
});
console.log("card layout:", JSON.stringify(fit));

const png = await cardPage.screenshot({ type: "png" });
await browser.close();
server.close();

function stripPhys(buf, chunks) {
  const phys = chunks.find((c) => c.type === "pHYs");
  return phys ? Buffer.concat([buf.slice(0, phys.start), buf.slice(phys.start + phys.total)]) : buf;
}
function setDpiPng(buf, dpi) {
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    chunks.push({ type, start: off, total: 12 + len });
    off += 12 + len;
    if (type === "IEND") break;
  }
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data.writeUInt8(1, 8);
  const crc = zlib.crc32(Buffer.concat([Buffer.from("pHYs", "ascii"), data]));
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("pHYs", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc >>> 0, 8 + data.length);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  const insertAt = ihdr.start + ihdr.total;
  const base = stripPhys(buf, chunks);
  return Buffer.concat([base.slice(0, insertAt), chunk, base.slice(insertAt)]);
}

/* A full-bleed photo capture at 300 dpi lands near 1 MB, which is too heavy for a
   card that gets emailed or printed. Quantising to 5 bits per channel — 32,768
   colours, far more than a photographic scrim needs — drops it well under budget
   without touching geometry, text or the QR. */
function quantise(pngBuf, bits) {
  const img = PNG.sync.read(pngBuf);
  const step = 255 / ((1 << bits) - 1);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const q = Math.round(img.data[i + c] / step) * step;
      img.data[i + c] = q < 0 ? 0 : q > 255 ? 255 : q;
    }
    img.data[i + 3] = 255;
  }
  return PNG.sync.write(img, { colorType: 6, deflateLevel: 9, deflateStrategy: 0, filterType: 4 });
}

const outPath = join(ROOT, "assets/photos/handover.png");
mkdirSync(dirname(outPath), { recursive: true });

let finalPng = setDpiPng(png, DPI);

/* A photographic 1240x1712 PNG is genuinely ~1 MB; the brief mandates the physical
   size and dpi, not a byte count. Still, step the palette down until the file is
   small enough to email, because most of the card is a dark scrim and text, which
   survives heavy quantisation. Stop at 4 bits rather than destroying the photo. */
for (const bits of [5, 4]) {
  if (finalPng.length <= 900 * 1024) break;
  // Quantising drops ancillary chunks, so the dpi has to be written again.
  finalPng = setDpiPng(quantise(finalPng, bits), DPI);
}
writeFileSync(outPath, finalPng);

const kB = Math.round(finalPng.length / 1024);
console.log(`✓ assets/photos/handover.png ${W}x${H} ${DPI} dpi (${CM_W} x ${CM_H} cm) — ${kB} kB`);
if (kB > 900) {
  console.warn(
    `! card is ${kB} kB. Correct size and dpi, but heavy to email: ` +
    `reduce the hero photo's resolution in the site, which is what makes the capture large`
  );
}
