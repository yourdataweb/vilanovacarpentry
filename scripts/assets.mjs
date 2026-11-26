#!/usr/bin/env node
/**
 * Icon set + Open Graph image from the default-locale dictionary.
 * Run: node scripts/assets.mjs   -> assets/img/{favicon.svg,icon-192.png,icon-512.png,
 *                                    apple-touch-icon.png,og-image.jpg}
 * Reads src/data.json (name, city, ratingCount, phoneNational) and the default locale's meta.
 * Waits for 'load', not 'networkidle0', which times out on data URIs.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets/img");
mkdirSync(OUT, { recursive: true });

const biz = JSON.parse(readFileSync(join(ROOT, "src/data.json"), "utf8"));
const LANGS = JSON.parse(readFileSync(join(ROOT, "src/locales.json"), "utf8"));
const DEF = (LANGS.find((l) => l.default) || LANGS[0]).code;
const t = JSON.parse(readFileSync(join(ROOT, `src/i18n/${DEF}.json`), "utf8"));

const ACCENT = biz.accent || "#0a2f3b";
const DEEP = biz.deep || "#06202a";
const GOLD = biz.gold || "#d9a02c";
const LIGHT = biz.light || "#8fc4cf";

/* ---- favicon / logo mark ---- */
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="${ACCENT}"/>
  <path d="M16 40c4 2.6 8 3.8 16 3.8S44 42.6 48 40" stroke="${GOLD}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  <path d="M19 32c3-4 6.4-6 13-6s10 2 13 6" stroke="${LIGHT}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  <circle cx="32" cy="19.6" r="3.2" fill="${GOLD}"/>
</svg>`;
writeFileSync(join(OUT, "favicon.svg"), mark + "\n");
const uri = "data:image/svg+xml;base64," + Buffer.from(mark).toString("base64");

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();

for (const size of [180, 192, 512]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent}` +
    `img{display:block;width:${size}px;height:${size}px}</style></head><body><img src="${uri}"></body></html>`,
    { waitUntil: "load" }
  );
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  await page.screenshot({ path: join(OUT, name), omitBackground: true });
  console.log("✓", name);
}

/* ---- OG image 1200x630 ---- */
const heroPath = join(OUT, "hero.svg");
let heroUri = "";
try {
  heroUri = "data:image/svg+xml;base64," + readFileSync(heroPath).toString("base64");
} catch { /* optional artwork: the gradient still renders */ }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ratingPill = biz.rating
  ? `<span class="pill"><svg class="star" viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.4l-5.8 3.1 1.1-6.45-4.7-4.6 6.5-.95L12 2.6Z"/></svg>${Number(biz.rating).toFixed(1)}${biz.ratingCount > 50 ? ` · ${Number(biz.ratingCount).toLocaleString("es-ES")}` : ""}</span>`
  : "";

await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:Fraunces;src:url("file://${join(ROOT, "assets/fonts/fraunces-latin.woff2")}") format("woff2");font-weight:400 700}
  @font-face{font-family:Inter;src:url("file://${join(ROOT, "assets/fonts/inter-latin.woff2")}") format("woff2");font-weight:400 600}
  *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px}
  .card{position:relative;width:1200px;height:630px;overflow:hidden;background:${DEEP}}
  .art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:62% 55%}
  .scrim{position:absolute;inset:0;background:linear-gradient(100deg,rgba(6,32,42,.94),rgba(6,32,42,.86) 46%,rgba(6,32,42,.34))}
  .body{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column;justify-content:center;color:#fdfaf4}
  .eyebrow{font:600 15px/1.3 Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${GOLD};margin:0 0 22px}
  h1{font:600 62px/1.06 Fraunces,Georgia,serif;letter-spacing:-.025em;margin:0 0 20px;max-width:800px;color:#fff}
  .sub{font:400 21px/1.5 Inter,sans-serif;color:rgba(253,250,244,.85);margin:0 0 32px;max-width:620px}
  .meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .pill{display:inline-flex;align-items:center;gap:9px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:11px 20px;font:600 16px/1 Inter,sans-serif;color:#fff}
  .star{width:17px;height:17px;fill:${GOLD}}
  .addr{font:500 16px/1 Inter,sans-serif;color:rgba(253,250,244,.75)}
  </style></head><body><div class="card">
  ${heroUri ? `<img class="art" src="${heroUri}">` : ""}
  <div class="scrim"></div><div class="body">
    <p class="eyebrow">${esc(biz.city)}${biz.street ? " · " + esc(biz.street) : ""}</p>
    <h1>${esc(biz.name)}</h1>
    <p class="sub">${esc(t.meta.ogAlt || t.meta.title)}</p>
    <div class="meta">${ratingPill}${biz.phoneNational ? `<span class="addr">${esc(biz.phoneNational)}</span>` : ""}</div>
  </div></div></body></html>`,
  { waitUntil: "load" }
);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(OUT, "og-image.jpg"), type: "jpeg", quality: 88 });
console.log("✓ og-image.jpg");

await browser.close();
