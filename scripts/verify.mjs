#!/usr/bin/env node
/**
 * Verifies the BUILT output over a local static server. Exits non-zero on any failure.
 * Contract: src/data.json, src/locales.json (see references/site-contract.md).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tmp/shots");
mkdirSync(OUT, { recursive: true });

const biz = JSON.parse(readFileSync(join(ROOT, "src/data.json"), "utf8"));
const LANGS = JSON.parse(readFileSync(join(ROOT, "src/locales.json"), "utf8"));
const DEFAULT = (LANGS.find((l) => l.default) || LANGS[0]).code;
const SITE_DOMAIN = biz.siteDomain || "vilanovailageltru.info";
const SITE_URL = (biz.siteUrl || `https://${biz.slug}.${SITE_DOMAIN}`).replace(/\/?$/, "");
const TEL = biz.phoneE164;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2",
  ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
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

const fails = [], passes = [];
const ok = (cond, label, extra = "") => {
  if (cond) passes.push(label); else fails.push(label + (extra ? ` — ${extra}` : ""));
};

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] });

for (const l of LANGS) {
  const url = BASE + l.dir;
  // fresh context per locale: a consent stored by an earlier locale would otherwise
  // load the map on the next locale and fail the pre-consent assertion
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.setViewport({ width: 1280, height: 900 });
  const resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  ok(resp.status() === 200, `[${l.code}] 200 response`, String(resp.status()));

  // Readability with scripts blocked: the reveal-on-scroll effect must not be the
  // only thing making content visible.
  // Must run before the no-JS reload below, which resets document.body.innerText.
  await page.setJavaScriptEnabled(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  const noJs = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".reveal")];
    const hidden = els.filter((e) => {
      const cs = getComputedStyle(e);
      return Number(cs.opacity) < 0.05 && cs.visibility !== "hidden";
    }).length;
    return { hidden, total: els.length, bodyText: (document.body.innerText || "").trim().length };
  });
  await page.setJavaScriptEnabled(true);
  await page.goto(url, { waitUntil: "networkidle2" });
  // innerText excludes elements at opacity 0, and .reveal starts hidden until the
  // IntersectionObserver fires. Force them visible so text assertions read real content.
  await page.evaluate(() => {
    document.querySelectorAll(".reveal").forEach((e) => e.classList.add("is-visible"));
  });
  // Set the page-side constants AFTER the no-JS reload above: a reload clears window,
  // and an unset count made the "review count shown" assertion fail on every site.
  await page.evaluate((c, sel) => {
    window.BUSINESS_RATING_COUNT = c;
    window.PHOTO_SELECTOR = sel;
  }, biz.ratingCount || 0, biz.photoSelector || ".hero__photo img");

  const info = await page.evaluate(() => {
    const ld = document.querySelector('script[type="application/ld+json"]');
    let ldOk = false, ldType = null;
    try { const j = JSON.parse(ld.textContent); ldOk = true; ldType = j["@type"]; } catch { ldOk = false; }
    return {
      lang: document.documentElement.lang,
      title: document.title,
      h1: (document.querySelector("h1") || {}).textContent || "",
      h1Count: document.querySelectorAll("h1").length,
      canonical: (document.querySelector('link[rel="canonical"]') || {}).href,
      hreflangs: [...document.querySelectorAll('link[rel="alternate"][hreflang]')]
        .map((n) => [n.hreflang, n.getAttribute("href")]),
      ldOk, ldType,
      telLinks: [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href")),
      waLinks: [...document.querySelectorAll('a[href*="wa.me"]')].map((a) => a.getAttribute("href")),
      mapSrc: (document.getElementById("map-template") || {}).innerHTML || "",
      mapIframes: document.querySelectorAll("#map-shell iframe").length,
      cookieBar: !!document.getElementById("cookiebar"),
      imgsNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
      emptyLinks: [...document.querySelectorAll("a")].filter((a) => {
        const h = a.getAttribute("href"); return h === "" || h === null;
      }).length,
      langLinks: [...document.querySelectorAll(".langs__link")].map((a) => a.getAttribute("href")),
      quotes: document.querySelectorAll(".quote").length,
      /* Sections whose class names describe this business, not a generic template. */
      sectionNames: (function () {
        var names = [];
        document.querySelectorAll("main section").forEach(function (el) {
          var got = false;
          Array.prototype.forEach.call(el.classList, function (c) {
            if (c !== "section" && !/^section--/.test(c)) { names.push(c); got = true; }
          });
          if (!got && el.id) names.push(el.id);
        });
        return names;
      })(),
      namedSections: (function () {
        var n = 0;
        document.querySelectorAll("main section").forEach(function (el) {
          /* A descriptive id is as good a signal as a descriptive class:
             <section id="serveis"> is named for the business even when its
             class list is only "section". */
          var byClass = Array.prototype.some.call(el.classList, function (c) {
            return c !== "section" && !/^section--/.test(c);
          });
          var byId = !!el.id && !/^section[-\d]/.test(el.id);
          if (byClass || byId) n++;
        });
        return n;
      })(),
      totalSections: document.querySelectorAll("main section").length,
      wrapPaddingLeft: parseFloat(getComputedStyle(document.querySelector(".wrap")).paddingLeft) || 0,
      wrapMaxWidth: getComputedStyle(document.querySelector(".wrap")).maxWidth,
      /* Flat values, not an IIFE returning an object: an IIFE here serialises as an empty
         object through page.evaluate, so the photo assertions would read undefined. */
      heroPhotoSrc: (function () { var el = document.querySelector(window.PHOTO_SELECTOR || ".hero__photo img"); return el ? el.getAttribute("src") : null; })(),
      heroPhotoAlt: (function () { var el = document.querySelector(window.PHOTO_SELECTOR || ".hero__photo img"); return el ? el.getAttribute("alt") : null; })(),
      heroPhotoNatural: (function () { var el = document.querySelector(window.PHOTO_SELECTOR || ".hero__photo img"); return el ? el.naturalWidth : 0; })(),
      heroPhotoTop: (function () { var el = document.querySelector(window.PHOTO_SELECTOR || ".hero__photo img"); return el ? el.getBoundingClientRect().top : -1; })(),
      heroPhotoHeight: (function () { var el = document.querySelector(window.PHOTO_SELECTOR || ".hero__photo img"); return el ? el.getBoundingClientRect().height : 0; })(),
      viewportHeight: window.innerHeight,
      /* Does the review count appear as visible text anywhere in the page? */
      ratingCountVisible: (function () {
        var n = Number(window.BUSINESS_RATING_COUNT);
        if (!n) return false;
        /* textContent, not innerText: innerText skips anything at opacity 0, so a
           scroll-reveal that has not fired yet reads as "count missing". */
        return (document.body.textContent || "").indexOf(String(n)) !== -1;
      })(),
      photoCredit: (document.querySelector("[data-photo-credit]") || {}).textContent || "",
    };
  });

  ok(info.lang === l.code, `[${l.code}] html[lang]=${l.code}`, info.lang);
  ok(info.title.length > 20, `[${l.code}] title present`, info.title);
  ok(info.h1Count === 1 && info.h1.trim().length > 0, `[${l.code}] single non-empty h1`, info.h1);
  ok(!!info.canonical, `[${l.code}] canonical present`, String(info.canonical));
  ok(info.ldOk, `[${l.code}] JSON-LD parses`, String(info.ldOk));
  ok(info.telLinks.includes(`tel:${TEL}`), `[${l.code}] tel: link correct`, JSON.stringify(info.telLinks));
  if (biz.phoneIsMobile) {
    ok(info.waLinks.length > 0, `[${l.code}] whatsapp link present for mobile number`);
  } else {
    ok(info.waLinks.length === 0, `[${l.code}] no whatsapp link for landline`, JSON.stringify(info.waLinks));
  }
  ok(/output=embed/.test(info.mapSrc) && info.mapSrc.includes(String(biz.latitude)),
    `[${l.code}] map embed src with place coordinates`);
  ok(info.mapIframes === 0, `[${l.code}] map not loaded before consent`, String(info.mapIframes));
  ok(info.cookieBar, `[${l.code}] cookie notice present`);
  // With JS off the page must still be readable: a .reveal rule that starts at
  // opacity 0 and waits for a script leaves the whole site blank.
  ok(noJs.hidden === 0, `[${l.code}] content visible with JS disabled`,
    `${noJs.hidden} of ${noJs.total} .reveal block(s) stuck at opacity 0`);
  ok(noJs.bodyText > 200, `[${l.code}] page text readable without JS`, `${noJs.bodyText} chars`);
  // Structure check: a page whose body sections are all anonymous "section" blocks is a
  // recoloured template, not a page designed for this business. Each section should carry a
  // name that describes it.
  ok(info.namedSections >= 3, `[${l.code}] body sections are named for this business`,
    `named=${info.namedSections} of ${info.totalSections} — ${info.sectionNames.join(", ")}`);
  // Layout guard: a missing --pad/--wrap token renders content flush to the viewport
  // edge, which looks broken but passes every content assertion.
  ok(info.wrapPaddingLeft >= 8, `[${l.code}] page content has side padding`,
    `wrap padding-left=${info.wrapPaddingLeft}px`);
  ok(!!info.wrapMaxWidth && info.wrapMaxWidth !== "none",
    `[${l.code}] .wrap is width-constrained (--wrap token present)`, info.wrapMaxWidth);
  ok(info.imgsNoAlt === 0, `[${l.code}] all <img> have alt`, String(info.imgsNoAlt));
  ok(info.emptyLinks === 0, `[${l.code}] no empty href`, String(info.emptyLinks));
  // Quotes may come from the dictionary or from data.json, depending on the structure.
  ok(info.quotes >= 1, `[${l.code}] testimonials rendered`, String(info.quotes));

  // Feature cards fall back to one generic glyph when a dictionary key has no icon in
  // scripts/icons.json. Identical icons across cards read as a copy-paste mistake, so
  // assert every card in the visible grid has its own mark.
  const dictForIcons = JSON.parse(readFileSync(join(ROOT, `src/i18n/${l.code}.json`), "utf8"));
  const featureKeys = Object.keys(dictForIcons.features?.items || {});
  const distinctIcons = await page.evaluate(() => {
    const marks = [...document.querySelectorAll(".card .card__icon")].map((n) => n.innerHTML.trim());
    return { total: marks.length, distinct: new Set(marks).size };
  });
  if (featureKeys.length && distinctIcons.total) {
    ok(distinctIcons.total === featureKeys.length,
      `[${l.code}] one feature card per dictionary key`,
      `${distinctIcons.total} cards vs ${featureKeys.length} keys`);
    ok(distinctIcons.distinct === distinctIcons.total,
      `[${l.code}] each feature card has a distinct icon`,
      `${distinctIcons.distinct} distinct of ${distinctIcons.total}`);
  }

  // Review count rule: published only above 50, and it appears in the hero badge, the
  // stats block and the reviews header — assert the number is absent from all of them.
  const countStr = String(biz.ratingCount || "");
  if (biz.ratingCount && biz.ratingCount <= 50) {
    ok(!info.ratingCountVisible, `[${l.code}] review count hidden at ${biz.ratingCount} (<=50)`,
      info.ratingCountVisible);
  } else if (biz.ratingCount > 50) {
    ok(info.ratingCountVisible, `[${l.code}] review count shown at ${biz.ratingCount} (>50)`);
  }

  // photo rule: a real business photo in the top half, with alt text and visible credit
  const hasPhoto = !!biz.heroPhoto;
  if (hasPhoto) {
    ok(!!info.heroPhotoSrc, `[${l.code}] hero photo present`, String(info.heroPhotoSrc));
    if (info.heroPhotoSrc) {
      ok(info.heroPhotoTop < info.viewportHeight * 0.5 && info.heroPhotoHeight > 80,
        `[${l.code}] hero photo in the top half of the page`,
        `top=${Math.round(info.heroPhotoTop)} vh=${info.viewportHeight}`);
      ok((info.heroPhotoAlt || "").trim().length > 0, `[${l.code}] hero photo has alt text`,
        String(info.heroPhotoAlt));
      ok(info.heroPhotoNatural > 0, `[${l.code}] hero photo actually loads`,
        String(info.heroPhotoNatural));
      ok(info.photoCredit.trim().length > 0 && info.photoCredit.includes(biz.photoCredit),
        `[${l.code}] photo credit shows the attribution author`, info.photoCredit.trim());
    }
  }

  const hf = Object.fromEntries(info.hreflangs.filter(([k]) => k !== "x-default"));
  ok(Object.keys(hf).length === LANGS.length, `[${l.code}] hreflang count = locales`,
    JSON.stringify(Object.keys(hf)));
  // expected href comes from locales.json, so moving the default locale to root cannot
  // leave a stale assertion passing on the wrong path
  for (const o of LANGS) {
    const key = o.hreflang || o.code;
    const want = `${SITE_URL}/${o.dir}`.replace(/\/$/, "");
    const got = (hf[key] || "").replace(/\/$/, "");
    ok(got === want, `[${l.code}] ${key} alternate -> ${o.dir || "/"}`, got || "missing");
  }
  ok((hf["x-default"] === undefined) || (hf["x-default"] || "").replace(/\/$/, "") === SITE_URL,
    `[${l.code}] x-default points at default locale`);

  for (const href of info.langLinks) {
    const r = await page.goto(new URL(href, url).href, { waitUntil: "domcontentloaded" });
    ok(r.status() === 200, `[${l.code}] lang link 200 ${href}`, String(r.status()));
  }
  await page.goto(url, { waitUntil: "networkidle2" });

  for (const w of [360, 768, 1920]) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 250));
    const ov = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    ok(ov.scrollW <= ov.clientW + 1, `[${l.code}] no h-overflow @${w}`, `${ov.scrollW}>${ov.clientW}`);
  }

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 200));
  const drawer = await page.evaluate(async () => {
    const t = document.querySelector(".nav-toggle"), n = document.getElementById("site-nav");
    if (!t || !n) return { found: false };
    const before = t.getAttribute("aria-expanded");
    t.click(); await new Promise((r) => setTimeout(r, 60));
    const after = t.getAttribute("aria-expanded");
    const visible = getComputedStyle(n).display !== "none";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    return { found: true, before, after, visible,
      afterEsc: t.getAttribute("aria-expanded"),
      hiddenAfterEsc: getComputedStyle(n).display === "none" };
  });
  ok(drawer.found, `[${l.code}] drawer exists`);
  if (drawer.found) {
    ok(drawer.before === "false" && drawer.after === "true", `[${l.code}] aria-expanded flips open`,
      `${drawer.before}->${drawer.after}`);
    ok(drawer.visible, `[${l.code}] nav visible when open`);
    ok(drawer.afterEsc === "false" && drawer.hiddenAfterEsc, `[${l.code}] Escape closes nav`);
  }

  // consent must actually load the map
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "networkidle2" });
  const mapAfter = await page.evaluate(async () => {
    document.querySelector('[data-cookie="accept"]')?.click();
    await new Promise((r) => setTimeout(r, 1200));
    return document.querySelectorAll("#map-shell iframe").length;
  });
  ok(mapAfter > 0, `[${l.code}] map loads after accepting cookies`, String(mapAfter));

  ok(errors.length === 0, `[${l.code}] no page errors`, errors.join(" | ").slice(0, 300));

  // stale locale paths must still land on the site, not 404: assert the built redirect
  // file, because navigating it follows the meta refresh to the production base path,
  // which the local test server does not serve
  for (const from of Object.keys(biz.redirects || {})) {
    if (LANGS.some((o) => o.dir === from)) continue;
    const file = join(ROOT, from.replace(/\/$/, ""), "index.html");
    ok(existsSync(file), `[${l.code}] redirect page ${from} exists`);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");
    // At a subdomain root the only correct relative target is the parent directory:
    // "./" from inside /ca/ would loop straight back into /ca/.
    ok(/location\.replace\("\.\.\/"\)/.test(html),
      `[${l.code}] redirect ${from} climbs to the site root, not back into ${from}`);
    ok(/name="robots" content="noindex,follow"/.test(html),
      `[${l.code}] redirect ${from} is noindex`);
    ok(/<a href="[^"]+">/.test(html), `[${l.code}] redirect ${from} has a JS-off fallback link`);
  }
  await page.goto(url, { waitUntil: "networkidle2" });

  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(OUT, `desktop-${l.code}.png`) });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(OUT, `mobile-${l.code}.png`) });

  await page.close();
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${passes.length} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  fails.forEach((f) => console.log(" ✗ " + f));
  process.exit(1);
}
console.log("✓ all checks passed");
