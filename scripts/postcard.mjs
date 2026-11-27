#!/usr/bin/env node
/**
 * Postcard proof: A6 at 300 dpi = 1240 x 1748 px (105 x 148 mm).
 *
 * Top: a print of the finished website — the product, shown rather than described.
 * Bottom band: the pitch, the price, the QR and the printed URL.
 *
 * The band is sized to its copy, not to a guessed fraction of the card. A fixed
 * slice left ~240 px of empty dark strip at the bottom, which reads as a layout
 * mistake on 500 printed cards. So: measure the copy, then set the band height and
 * give everything that is left to the screenshot.
 *
 * Usage:
 *   node postcard.mjs                                  # Catalan, Antica Italia
 *   node postcard.mjs --site ../anticaitalia --lang es
 *   node postcard.mjs --headline "..." --price "..."
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

const HERE = dirname(fileURLToPath(import.meta.url));
/* The script lives in <site>/scripts/, so the site root is one level up. --site
   overrides it, which is how a whole batch is regenerated from one copy. */
const SELF_SITE = resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SITE = resolve(arg("site", SELF_SITE));
const LANG = arg("lang", "ca");
/* Default output is the site's own assets/photos/, so a regenerated postcard lands
   where the handover card already lives and rides the same deploy. */
const OUT = arg("out", join(SITE, "assets/photos"));
mkdirSync(OUT, { recursive: true });
mkdirSync(join(HERE, "tmp"), { recursive: true });

/* ---- geometry: A6 at 300 dpi ---- */
const MM_W = 105, MM_H = 148, DPI = 300;
const W = Math.floor((MM_W / 25.4) * DPI); // 1240
const H = Math.floor((MM_H / 25.4) * DPI); // 1748

const PAD_X = Math.round(W * 0.042);   // side padding inside the band
const PAD_TOP = Math.round(W * 0.038);
const PAD_BOTTOM = Math.round(W * 0.034);

const data = JSON.parse(readFileSync(join(SITE, "src/data.json"), "utf8"));
const DOMAIN = data.siteDomain || "vilanovailageltru.info";
const SLUG = data.slug;
const URL = `https://${SLUG}.${DOMAIN}/`;
/* The business name is not printed: it is already legible in the site render above
   the band, and repeating it pushed the URL down for no gain. */

/* Four objections, four answers. Kept as data so a translation is a file edit,
   never a template edit. */
const COPY = {
  ca: {
    kicker: "Et trobaran abans de trucar",
    headline: "Feta a mida per al teu negoci, i ja és en línia.",
    reason: "Preparada per a Google i per als assistents d'IA.",
    price: "120 € l'any + IVA",
    priceMonthly: "10 € al mes",
    priceNote: "L'únic que has de fer és pagar. La resta ja està feta.",
    deadline: "",
    statementLead: "En línia 3 mesos. Després és teva per ",
    statementPrice: "120 € l'any + IVA = 10 € al mes",
    statementTail: ". La resta ja està feta.",
    features: "Mòbil, tauleta i ordinador · Català, castellà i anglès · Opinions reals",
    scan: "Escaneja'm",
  },
  es: {
    kicker: "Te encontrarán antes de llamar",
    headline: "Hecha a medida para tu negocio, y ya está en línea.",
    reason: "Preparada para Google y para los asistentes de IA.",
    price: "120 € al año + IVA",
    priceMonthly: "10 € al mes",
    priceNote: "Lo único que tienes que hacer es pagar. El resto ya está hecho.",
    deadline: "",
    statementLead: "En línea 3 meses. Después es tuya por ",
    statementPrice: "120 € al año + IVA = 10 € al mes",
    statementTail: ". El resto ya está hecho.",
    features: "Móvil, tableta y ordenador · Catalán, castellano e inglés · Opiniones reales",
    scan: "Escanéame",
  },
  en: {
    kicker: "They will find you before they call",
    headline: "Made to measure for your business, and already online.",
    reason: "Set up for Google and for AI assistants.",
    price: "€120 a year + VAT",
    priceMonthly: "€10 a month",
    priceNote: "Paying is the only thing you have to do. The rest is done.",
    deadline: "",
    statementLead: "Live for 3 months. After that it's yours for ",
    statementPrice: "€120 a year + VAT = €10 a month",
    statementTail: ". The rest is done.",
    features: "Mobile, tablet and desktop · Catalan, Spanish and English · Real reviews",
    scan: "Scan me",
  },
};
if (!COPY[LANG]) throw new Error(`unknown --lang ${LANG}; have ${Object.keys(COPY).join(", ")}`);
const t = { ...COPY[LANG] };
for (const k of Object.keys(t)) t[k] = arg(k, t[k]);
t.url = arg("url", URL);
t.deadline = arg("deadline", t.deadline || "");
t.features = arg("features", t.features || "");
t.statementLead = arg("lead", t.statementLead || "");
t.statementPrice = arg("amount", t.statementPrice || "");
t.statementTail = arg("tail", t.statementTail || "");
t.statement = (t.statementLead || t.statementPrice) ? "1" : "";

const DEEP = data.deep || "#2a1109";
const GOLD = data.gold || "#d8a24a";
const PAPER = data.paper || "#fbf6ee";
const LIGHT = data.light || "#f0dcc0";

/* Every site ships the same two woff2 subsets; if one is missing, fall back to the
   workspace copy rather than rendering the band in a fallback face. */
const fontPath = (f) => {
  const own = join(SITE, "assets/fonts", f);
  return existsSync(own) ? own : join("/home/davidoc/.openclaw/workspace", "assets/fonts", f);
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const px = (n) => Math.round(n * (W / 1240));
/* One line, protocol included: a printed URL that starts with https:// reads as a real
   address, and breaking it at the domain made people type the wrong thing. */
const urlLine = URL;

/* ---- serve the built site: the capture must be the real page ---- */
const LANGS = JSON.parse(readFileSync(join(SITE, "src/locales.json"), "utf8"));
const dir = LANG === "ca" || !LANGS.some((l) => l.code === LANG) ? "" : LANG + "/";
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};
/* Serve the site from its own root and navigate to the locale's real path.
   Mounting es/index.html at "/" breaks every "../assets/..." URL in that page:
   they resolve outside the served root, the CSS 404s, and the flag SVGs in the
   language switch render at full width — a red and yellow stripe across the card. */
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = normalize(join(SITE, p));
  if (!file.startsWith(SITE) || !existsSync(file)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/${dir}`;

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] });

const banner = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:Fraunces;src:url("file://${fontPath("fraunces-latin.woff2")}") format("woff2");font-weight:400 700}
  @font-face{font-family:Inter;src:url("file://${fontPath("inter-latin.woff2")}") format("woff2");font-weight:400 600}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}

  .kicker{font-size:${px(26)}px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${GOLD};margin-bottom:${px(14)}px}
  .headline{font-family:Fraunces,Georgia,serif;font-size:${px(47)}px;line-height:1.13;letter-spacing:-.018em;color:${PAPER};font-weight:600;margin-bottom:${px(13)}px}
  .reason{font-size:${px(25)}px;line-height:1.42;color:${LIGHT};margin-bottom:${px(24)}px;max-width:${px(780)}px}

  .row{display:flex;align-items:flex-end;gap:${px(30)}px}
  .left{flex:1 1 auto;min-width:0}

  .deadline{display:none;align-items:center;gap:${px(10)}px;align-self:flex-start;border:${px(2)}px solid ${GOLD};border-radius:${px(999)}px;padding:${px(9)}px ${px(20)}px;margin-bottom:${px(20)}px;font-size:${px(24)}px;font-weight:600;color:${GOLD};letter-spacing:.01em;line-height:1.2}
  .deadline.is-set{display:inline-flex}
  .deadline svg{width:${px(21)}px;height:${px(21)}px;flex:none}
  .features{display:none;font-size:${px(21)}px;line-height:1.4;color:${LIGHT};letter-spacing:.02em;margin-top:${px(14)}px}
  .features.is-set{display:block}
  /* One-sentence form: deadline, price and the hands-off promise as a single
     statement, with the price set inline and emphasised. Used instead of the
     pill + price row when a statement is supplied. */
  .statement{display:none;font-size:${px(30)}px;line-height:1.42;color:${LIGHT};letter-spacing:-.005em;max-width:${px(820)}px}
  .statement.is-set{display:block}
  .statement .amount{color:${PAPER};font-weight:600}
  .statement .eq{color:${GOLD};font-weight:600;padding:0 ${px(4)}px}
  .statement .kickerprice{color:${PAPER};font-weight:600}

  .price-eq.is-set{display:flex}
  .price-eq{display:none;align-items:baseline;gap:${px(14)}px;flex-wrap:wrap;margin-bottom:${px(8)}px}
  .price-eq .yr{font-size:${px(41)}px;font-weight:600;color:${PAPER};letter-spacing:-.012em;line-height:1.08}
  .price-eq .eq{font-size:${px(26)}px;font-weight:600;color:${GOLD};line-height:1}
  .price-eq .mo{font-size:${px(31)}px;font-weight:600;color:${PAPER};letter-spacing:-.01em;line-height:1.1}
  .price{font-size:${px(41)}px;font-weight:600;color:${PAPER};letter-spacing:-.012em;line-height:1.08}
  .price-note.is-off{display:none}
  .price-note{font-size:${px(23)}px;color:${LIGHT};margin-top:${px(7)}px}

  .url{font-size:${px(25)}px;font-weight:600;color:${PAPER};line-height:1.3;white-space:nowrap;letter-spacing:-.01em;margin-top:${px(22)}px}

  .qr-wrap{flex:none;text-align:center}
  .qr{background:#fff;border-radius:${px(10)}px;padding:${px(12)}px;display:inline-block}
  .qr img{display:block;width:${px(228)}px;height:${px(228)}px;image-rendering:pixelated}
  .qr-hint{font-size:${px(17)}px;color:${LIGHT};margin-top:${px(9)}px;letter-spacing:.03em}
</style></head><body>
  <div class="kicker">${esc(t.kicker)}</div>
  <div class="headline">${esc(t.headline)}</div>
  <div class="reason">${esc(t.reason)}</div>
  <div class="row">
    <div class="left">
      <div class="deadline${t.deadline && !t.statement ? " is-set" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg><span>${esc(t.deadline)}</span></div>
      <div class="statement${t.statement ? " is-set" : ""}"><span class="lead">${esc(t.statementLead || "")}</span><span class="amount">${esc(t.statementPrice || "")}</span><span class="tail">${esc(t.statementTail || "")}</span></div>
      <div class="price-eq${t.statement ? "" : " is-set"}"><span class="yr">${esc(t.price)}</span><span class="eq">=</span><span class="mo">${esc(t.priceMonthly || "")}</span></div>
      <div class="price-note${t.statement ? " is-off" : ""}">${esc(t.priceNote)}</div>
      <div class="features${t.features ? " is-set" : ""}">${esc(t.features)}</div>
      <div class="url">${esc(urlLine)}</div>
    </div>
    <div class="qr-wrap">
      <div class="qr"><img src="__QR__" alt=""></div>
      <div class="qr-hint">${esc(t.scan)}</div>
    </div>
  </div>
</body></html>`;

/* ---- pass 1: measure the band's natural height ---- */
const qrDataUrl = await QRCode.toDataURL(URL, {
  errorCorrectionLevel: "M", margin: 1, width: 640,
  color: { dark: "#141414", light: "#ffffff" },
});

const bandPage = await browser.newPage();
await bandPage.setViewport({ width: W - 2 * PAD_X, height: 600, deviceScaleFactor: 1 });
const bandHtml = banner.replace("__QR__", qrDataUrl);
await bandPage.setContent(bandHtml, { waitUntil: "load" });
await bandPage.evaluate(() => document.fonts.ready);

const measured = await bandPage.evaluate(() => {
  const body = document.body;
  const blocks = {};
  document.querySelectorAll(".kicker, .headline, .reason, .deadline.is-set, .features.is-set, .statement.is-set, .price-eq, .price, .price-note, .url, .qr").forEach((el) => {
    const r = el.getBoundingClientRect();
    blocks[el.className.split(" ")[0]] = { w: Math.round(r.width), h: Math.round(r.height) };
    if (el.scrollWidth > el.clientWidth + 1) (blocks.overflow ||= []).push(el.className.split(" ")[0]);
  });
  return { content: Math.ceil(body.getBoundingClientRect().height), blocks };
});
console.log("band content:", JSON.stringify(measured));

const BAND_PX = measured.content + PAD_TOP + PAD_BOTTOM;
const SHOT_H = H - BAND_PX;
if (SHOT_H < H * 0.45) {
  console.error(`✗ the pitch band needs ${BAND_PX}px, leaving only ${SHOT_H}px for the website print. Shorten the copy.`);
  process.exitCode = 1;
}

/* ---- pass 2: capture the page top at the remaining height ---- */
const SHOT_W = 1200;
const scale = Math.min(2, Math.max(1, SHOT_H / 900));
const shotPage = await browser.newPage();
await shotPage.setViewport({ width: SHOT_W, height: Math.round(SHOT_H / (W / SHOT_W)), deviceScaleFactor: (W / SHOT_W) });
await shotPage.goto(BASE, { waitUntil: "networkidle2" });
await shotPage.evaluate(() => {
  document.querySelectorAll(".reveal").forEach((e) => e.classList.add("is-visible"));
  document.querySelectorAll("#cookiebar, .cookiebar").forEach((e) => { e.style.display = "none"; });
});
await new Promise((r) => setTimeout(r, 700));

const layout = await shotPage.evaluate(() => {
  const shown = (el) => el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".primary-nav, .nav, .site-nav");
  /* A missing stylesheet still renders HTML: the language flags, which are inline
     SVGs with only a viewBox, blow up to full width and paint a flag stripe across
     the card. Assert the CSS actually applied before capturing. */
  const wrap = document.querySelector(".wrap");
  const wrapPad = wrap ? parseFloat(getComputedStyle(wrap).paddingLeft) || 0 : 0;
  const flag = document.querySelector(".langs__flag");
  const flagW = flag ? Math.round(flag.getBoundingClientRect().width) : 0;
  return {
    toggleShown: shown(toggle), navShown: shown(nav),
    h1: (document.querySelector("h1") || {}).textContent,
    wrapPad: Math.round(wrapPad), flagW,
  };
});
if (layout.toggleShown && !layout.navShown) {
  console.error(`✗ at ${SHOT_W}px the capture shows the mobile layout (hamburger). Raise SHOT_W.`);
  process.exitCode = 1;
}
if (layout.wrapPad < 8 || layout.flagW > 40) {
  console.error(
    `✗ the captured page is unstyled (wrap padding ${layout.wrapPad}px, flag ${layout.flagW}px). ` +
    `The stylesheet did not load — check the served path for this locale.`
  );
  process.exitCode = 1;
}

const cssShotW = W / (W / SHOT_W); // page CSS width that maps to the card width
const cssShotH = SHOT_H / (W / SHOT_W);
const shot = await shotPage.screenshot({
  encoding: "base64",
  clip: { x: 0, y: 0, width: SHOT_W, height: Math.round(cssShotH) },
});

/* ---- pass 3: compose the card ---- */
const cardPage = await browser.newPage();
await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await cardPage.setContent(
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:Fraunces;src:url("file://${fontPath("fraunces-latin.woff2")}") format("woff2");font-weight:400 700}
  @font-face{font-family:Inter;src:url("file://${fontPath("inter-latin.woff2")}") format("woff2");font-weight:400 600}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;background:${DEEP};font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
  .card{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${DEEP}}
  .shot-wrap{position:absolute;top:0;left:0;width:${W}px;height:${SHOT_H}px;overflow:hidden;background:${PAPER}}
  .shot-wrap img{width:100%;display:block}
  .shot-edge{position:absolute;left:0;right:0;top:${SHOT_H}px;height:${px(3)}px;background:${GOLD};opacity:.55}
  .band{position:absolute;left:0;right:0;bottom:0;height:${BAND_PX}px;background:${DEEP};padding:${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px}
  ${banner.split("<style>")[1].split("</style>")[0]}
  </style></head><body>
  <div class="card">
    <div class="shot-wrap"><img src="data:image/png;base64,${shot}" alt=""></div>
    <div class="shot-edge"></div>
    <div class="band">
      <div class="kicker">${esc(t.kicker)}</div>
      <div class="headline">${esc(t.headline)}</div>
      <div class="reason">${esc(t.reason)}</div>
      <div class="row">
        <div class="left">
          <div class="deadline${t.deadline && !t.statement ? " is-set" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg><span>${esc(t.deadline)}</span></div>
          <div class="statement${t.statement ? " is-set" : ""}"><span class="lead">${esc(t.statementLead || "")}</span><span class="amount">${esc(t.statementPrice || "")}</span><span class="tail">${esc(t.statementTail || "")}</span></div>
      <div class="price-eq${t.statement ? "" : " is-set"}"><span class="yr">${esc(t.price)}</span><span class="eq">=</span><span class="mo">${esc(t.priceMonthly || "")}</span></div>
          <div class="price-note${t.statement ? " is-off" : ""}">${esc(t.priceNote)}</div>
          <div class="features${t.features ? " is-set" : ""}">${esc(t.features)}</div>
          <div class="url">${esc(urlLine)}</div>
        </div>
        <div class="qr-wrap">
          <div class="qr"><img src="${qrDataUrl}" alt=""></div>
          <div class="qr-hint">${esc(t.scan)}</div>
        </div>
      </div>
    </div>
  </div>
  </body></html>`,
  { waitUntil: "load" }
);
await cardPage.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

/* ---- verify placement before saving ---- */
const fit = await cardPage.evaluate((bandPx, expectShot) => {
  const band = document.querySelector(".band");
  const bb = band.getBoundingClientRect();
  const out = { band: { top: Math.round(bb.top), h: Math.round(bb.height) }, clipped: [], slackBottom: 0 };
  document.querySelectorAll(".kicker, .headline, .reason, .deadline, .features, .statement, .price-eq, .price, .price-note, .url, .qr, .qr-hint").forEach((el) => {
    const r = el.getBoundingClientRect();
    const key = el.className.split(" ")[0];
    if (r.right > window.innerWidth + 1) out.clipped.push(key + ":right");
    if (r.bottom > bandPx.top + bandPx.h + 1) out.clipped.push(key + ":below");
    if (el.scrollWidth > el.clientWidth + 1) out.clipped.push(key + ":scroll");
  });
  /* the last visible element must sit near the band's bottom padding, or the card
     has a dead strip under the price that the eye reads as an error */
  const kids = [...band.children];
  const last = kids[kids.length - 1].getBoundingClientRect();
  out.slackBottom = Math.round(bb.bottom - last.bottom);
  out.shotH = Math.round(expectShot);
  return out;
}, { top: H - BAND_PX, h: BAND_PX }, SHOT_H);

const slackLimit = PAD_BOTTOM + px(6);
console.log("card fit:", JSON.stringify(fit));
if (fit.clipped.length) {
  console.error(`✗ clipped: ${[...new Set(fit.clipped)].join(", ")}`);
  process.exitCode = 1;
}
if (fit.slackBottom > slackLimit) {
  console.error(`✗ dead strip of ${fit.slackBottom}px under the copy (limit ${slackLimit})`);
  process.exitCode = 1;
}
if (process.exitCode) {
  await browser.close(); server.close();
  throw new Error("postcard layout failed");
}

const png = await cardPage.screenshot({ type: "png" });
await browser.close();
server.close();

/* ---- write 300 dpi into the PNG ---- */
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
  const d = Buffer.alloc(9);
  d.writeUInt32BE(ppm, 0); d.writeUInt32BE(ppm, 4); d.writeUInt8(1, 8);
  const crc = zlib.crc32(Buffer.concat([Buffer.from("pHYs", "ascii"), d]));
  const chunk = Buffer.alloc(12 + d.length);
  chunk.writeUInt32BE(d.length, 0);
  chunk.write("pHYs", 4, "ascii");
  d.copy(chunk, 8);
  chunk.writeUInt32BE(crc >>> 0, 8 + d.length);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  const base = stripPhys(buf, chunks);
  return Buffer.concat([base.slice(0, ihdr.start + ihdr.total), chunk, base.slice(ihdr.start + ihdr.total)]);
}

const SUFFIX = arg("suffix", "");
const NAME = arg("name", `postcard-${LANG}${SUFFIX ? "-" + SUFFIX : ""}`);
const outPath = join(OUT, `${NAME}.png`);
writeFileSync(outPath, setDpiPng(png, DPI));
console.log(`✓ ${outPath}`);
console.log(`  ${W}x${H} px = ${MM_W}x${MM_H} mm at ${DPI} dpi — ${Math.round(png.length / 1024)} kB`);
console.log(`  website print: ${SHOT_H}px · pitch band: ${BAND_PX}px · slack under copy: ${fit.slackBottom}px`);
console.log(`  URL: ${URL}`);
