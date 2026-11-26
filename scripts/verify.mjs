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
      langs: (function () {
        var n = document.querySelector(".langs");
        if (!n) return { missing: true };
        var pills = Array.prototype.slice.call(n.querySelectorAll("a"));
        var flagsInside = pills.every(function (a) {
          var f = a.querySelector(".langs__flag");
          if (!f) return false;
          var ar = a.getBoundingClientRect(), fr = f.getBoundingClientRect();
          return fr.top >= ar.top - 0.5 && fr.bottom <= ar.bottom + 0.5 &&
                 fr.left >= ar.left - 0.5 && fr.right <= ar.right + 0.5;
        });
        var rect = n.getBoundingClientRect();
        return {
          w: Math.round(rect.width), h: Math.round(rect.height),
          scrollW: n.scrollWidth, scrollH: n.scrollHeight,
          overflow: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1,
          pills: pills.length,
          codes: pills.filter(function (a) { return !!a.querySelector(".langs__code"); }).length,
          flagsInside: flagsInside,
        };
      })(),
      /* Contrast of every visible text element against its real painted background.
         A section that loses its dark background (e.g. a class dropped while adding a
         descriptive name) leaves white text on cream at 1.08:1, which no other
         assertion notices. */
      lowContrast: (function () {
        function lum(c) {
          var m = (c || "").match(/\d+(\.\d+)?/g);
          if (!m || m.length < 3) return null;
          var v = m.slice(0, 3).map(function (x) {
            x = Number(x) / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        }
        /* Composite the background stack rather than returning the first opaque
           colour: a white-on-dark card uses rgba(255,255,255,.06) over a dark
           section, and reading only the overlay reports 1:1 for text that is fine. */
        function bgOf(el) {
          var layers = [];
          var e = el;
          while (e) {
            var c = getComputedStyle(e).backgroundColor;
            var m = (c || "").match(/\d+(\.\d+)?/g);
            if (m && Number(m[3] === undefined ? 1 : m[3]) > 0.05) {
              layers.push({ rgb: m.slice(0, 3).map(Number), a: m.length > 3 ? Number(m[3]) : 1 });
              if (layers[layers.length - 1].a >= 0.999) break;
            }
            e = e.parentElement;
          }
          var base = [255, 255, 255];
          for (var i = layers.length - 1; i >= 0; i--) {
            var L = layers[i];
            base = [0, 1, 2].map(function (k) { return L.rgb[k] * L.a + base[k] * (1 - L.a); });
          }
          return "rgb(" + base.map(function (v) { return Math.round(v); }).join(",") + ")";
        }
        var bad = [];
        document.querySelectorAll("main p, main h1, main h2, main h3, main dt, main dd, main li, main a, main span, main figcaption, footer p, footer a").forEach(function (el) {
          if (el.querySelector("p,h1,h2,h3,dt,dd,li,a,span,figcaption")) return;
          var text = (el.textContent || "").trim();
          if (text.length < 2) return;
          var cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") return;
          if (Number(cs.opacity) < 0.5) return;
          /* When an ancestor paints a gradient, the composited background-color is
             the page default and tells us nothing. Parse the gradient's own colour
             stops and judge against the worst one for this text colour. */
          /* Only fall back to gradient parsing when nothing between the text and the
             root paints a solid colour. A white card inside a dark hero resolves to
             white here, which is correct and must not be overridden. */
          /* A background-image closer to the text than any opaque colour is the real
             ground. body usually has an opaque cream, which would otherwise win and
             make white hero text look like it sits on cream. */
          var solidFound = false, probeEl = el, gradientFirst = false;
          while (probeEl) {
            var pcs = getComputedStyle(probeEl);
            var pm = (pcs.backgroundColor || "").match(/\d+(\.\d+)?/g);
            var opaque = pm && Number(pm.length > 3 ? pm[3] : 1) >= 0.9;
            var hasImg = pcs.backgroundImage && pcs.backgroundImage !== "none";
            if (hasImg) { gradientFirst = true; break; }
            if (opaque) { solidFound = true; break; }
            probeEl = probeEl.parentElement;
          }
          if (gradientFirst) solidFound = false;
          var bg = bgOf(el);
          var m0 = bg.match(/\d+/g).map(Number);
          if (!solidFound) {
            var g = el;
            while (g) {
              var gcs = getComputedStyle(g);
              if (gcs.backgroundImage && gcs.backgroundImage !== "none") {
                /* Only opaque stops are a ground colour. A decorative grid overlay
                   uses rgba(...,.5) and transparent, and treating `transparent` as
                   black invents a contrast failure that is not there. */
                var stops = (gcs.backgroundImage.match(/rgba?\([^)]+\)/g) || [])
                  .filter(function (c) { return !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(c); })
                  .map(function (c) {
                    var mm = c.match(/\d+(\.\d+)?/g);
                    var a = mm.length > 3 ? Number(mm[3]) : 1;
                    if (a < 0.35) return null;   /* too faint to be a ground */
                    return [Number(mm[0]), Number(mm[1]), Number(mm[2])];
                  })
                  .filter(Boolean);
                if (!stops.length) { g = g.parentElement; continue; }
                var textL = lum(cs.color);
                var worst = null;
                stops.forEach(function (st) {
                  var sl = lum("rgb(" + st.join(",") + ")");
                  var r2 = (Math.max(textL, sl) + 0.05) / (Math.min(textL, sl) + 0.05);
                  if (worst === null || r2 < worst) worst = r2;
                });
                if (worst !== null) {
                  var size0 = parseFloat(cs.fontSize);
                  var large0 = size0 >= 24 || (size0 >= 18.66 && Number(cs.fontWeight) >= 700);
                  if (worst < (large0 ? 3 : 4.5)) {
                    bad.push({ text: text.slice(0, 24), ratio: Math.round(worst * 100) / 100 });
                  }
                }
                g = null;
                break;
              }
              g = g.parentElement;
            }
            return;
          }
          var L1 = lum(cs.color), L2 = lum(bg);
          if (L1 === null || L2 === null) return;
          var ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          var size = parseFloat(cs.fontSize);
          var large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) {
            bad.push({ text: text.slice(0, 24), ratio: Math.round(ratio * 100) / 100 });
          }
        });
        return bad.slice(0, 6);
      })(),
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

  // Language switch: one canonical toolbar. These four measurements caught a flag
  // overflowing its pill and a toolbar that was a different height on each site.
  ok(info.langs.overflow === false, `[${l.code}] language switch has no clipped content`,
    `scroll ${info.langs.scrollW}x${info.langs.scrollH} vs ${info.langs.w}x${info.langs.h}`);
  ok(info.langs.flagsInside, `[${l.code}] every flag sits inside its pill`);
  ok(info.langs.codes === info.langs.pills,
    `[${l.code}] every language pill shows its code`, `${info.langs.codes}/${info.langs.pills}`);
  ok(info.langs.h === 32, `[${l.code}] language switch is 32px tall at desktop`, `${info.langs.h}px`);
  ok(info.langs.pills === LANGS.length, `[${l.code}] one pill per locale`, String(info.langs.pills));

  // README must exist, link the live site, and use the shared section order.
  const readmePath = join(ROOT, "README.md");
  ok(existsSync(readmePath), `[${l.code}] README.md exists`);
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, "utf8");
    ok(readme.includes(new URL(SITE_URL).hostname),
      `[${l.code}] README links the live site`);
    ok(/^## Page structure$/m.test(readme) && /^## Repo layout$/m.test(readme) &&
       /^## Deploy$/m.test(readme) && /^## Technical notes$/m.test(readme),
      `[${l.code}] README uses the shared section order`);
  }
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
  ok((info.lowContrast || []).length === 0, `[${l.code}] all visible text meets contrast`,
    (info.lowContrast || []).map((b) => `"${b.text}" ${b.ratio}:1`).join(", "));

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
