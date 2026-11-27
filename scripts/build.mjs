#!/usr/bin/env node
/**
 * Emits server-rendered HTML per locale from src/template.html + src/i18n/<code>.json.
 * Contract: src/data.json (business), src/locales.json ([{code,name,dir,default}]).
 * Fails on unresolved {{holes}}, empty href/src, or invalid JSON-LD.
 * Template keys are documented in references/site-contract.md.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const write = (p, s) => {
  const full = join(ROOT, p);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, s);
};

/* minimal mustache: {{a.b}} {{{raw}}} {{#each}} {{#if}} {{else}} */
function tokenize(src) {
  const out = [];
  const re = /\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: "raw", v: m[1].trim() } : { t: "tag", v: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

function parse(tokens) {
  const root = { children: [] };
  const stack = [root];
  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    if (tok.t === "text") { top.children.push(tok); continue; }
    if (tok.t === "raw") { top.children.push({ t: "raw", path: tok.v }); continue; }
    const v = tok.v;
    if (v.startsWith("#each ")) {
      const node = { t: "each", path: v.slice(6).trim(), children: [] };
      top.children.push(node); stack.push(node);
    } else if (v.startsWith("#if ")) {
      const node = { t: "if", path: v.slice(4).trim(), children: [], alt: [] };
      top.children.push(node); stack.push(node);
    } else if (v === "else") {
      if (top.t !== "if") throw new Error("{{else}} outside {{#if}}");
      stack.push({ children: top.alt, virtual: true });
    } else if (v.startsWith("/each") || v.startsWith("/if")) {
      let popped = stack.pop();
      if (popped.virtual) popped = stack.pop();
      if (popped.t !== v.slice(1)) throw new Error(`Mismatched closing ${v}`);
    } else {
      top.children.push({ t: "var", path: v });
    }
  }
  if (stack.length !== 1) throw new Error("Unclosed block in template");
  return root.children;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function walk(path, start) {
  let c = start;
  for (const k of path.split(".")) {
    if (c == null) return undefined;
    c = c[k];
  }
  return c;
}

function lookup(path, ctx) {
  if (path === "this" || path === ".") return ctx.value;
  if (path.startsWith("@root.")) return walk(path.slice(6), ctx.root);
  if (path.startsWith("this.")) return walk(path.slice(5), ctx.value);
  const local = walk(path, ctx.value);
  return local !== undefined ? local : walk(path, ctx.root);
}

function render(nodes, ctx) {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var" || n.t === "raw") {
      const val = lookup(n.path, ctx);
      if (val === undefined || val === null) {
        const braces = n.t === "raw" ? `{{{${n.path}}}}` : `{{${n.path}}}`;
        throw new Error(`Unresolved template key: ${braces}`);
      }
      out += n.t === "raw" ? String(val) : esc(val);
    } else if (n.t === "if") {
      const val = lookup(n.path, ctx);
      const truthy = Array.isArray(val) ? val.length > 0 : !!val;
      out += render(truthy ? n.children : n.alt, ctx);
    } else if (n.t === "each") {
      const list = lookup(n.path, ctx);
      if (!Array.isArray(list)) throw new Error(`{{#each ${n.path}}} is not an array`);
      list.forEach((item, i) => { out += render(n.children, { ...ctx, value: item, index: i }); });
    }
  }
  return out;
}

/* ---- data ---- */
const biz = JSON.parse(read("src/data.json"));
const LANGS = JSON.parse(read("src/locales.json"));
/* Every absolute URL in the output comes from here, derived from the code name and
   the publishing domain, so a new site cannot inherit a stale host. Override with
   `siteUrl` in src/data.json only when testing against a different domain. */
const SITE_DOMAIN = biz.siteDomain || "vilanovailageltru.info";
const CODE_NAME = biz.slug;
const SITE_URL = (biz.siteUrl || `https://${CODE_NAME}.${SITE_DOMAIN}`).replace(/\/?$/, "");
const DEFAULT = (LANGS.find((l) => l.default) || LANGS[0]).code;
const dicts = Object.fromEntries(LANGS.map((l) => [l.code, JSON.parse(read(`src/i18n/${l.code}.json`))]));

const coords = `${biz.latitude},${biz.longitude}`;
const links = {
  place: biz.mapsPlaceUri || `https://www.google.com/maps/search/?api=1&query=${coords}`,
  directions: `https://www.google.com/maps/dir/?api=1&destination=${coords}`,
  reviews: biz.mapsReviewsUri || biz.mapsPlaceUri || `https://www.google.com/maps/search/?api=1&query=${coords}`,
  mapEmbed: (hl) => `https://www.google.com/maps?q=${coords}&hl=${hl}&z=16&output=embed`,
};

/* Hero photo: copy the place photo the extractor found into assets/img/ so the site
   never depends on a path outside its own repo. Credit is mandatory wherever it is shown.
 */
let heroPhoto = null;
if (biz.heroPhoto && existsSync(biz.heroPhoto)) {
  const ext = (biz.heroPhoto.match(/\.[a-z0-9]+$/i) || [".jpg"])[0].toLowerCase();
  const dest = `assets/img/hero-photo${ext}`;
  mkdirSync(join(ROOT, "assets/img"), { recursive: true });
  copyFileSync(biz.heroPhoto, join(ROOT, dest));
  heroPhoto = { src: dest, credit: biz.photoCredit || "", creditUrl: biz.photoCreditUrl || "" };
} else if (biz.heroPhoto) {
  console.warn(`! heroPhoto points at a missing file: ${biz.heroPhoto} — building without it`);
}

/* Feature / dish / quote lists come from the dictionary keys, so a new business
   needs no script edit: add an item to every locale file. */
const ICONS = JSON.parse(read("scripts/icons.json"));
const iconFor = (key) => ICONS[key] || ICONS.default;

function jsonLd(t, lang) {
  const d = {
    "@context": "https://schema.org",
    "@type": biz.schemaType || "LocalBusiness",
    "@id": `${SITE_URL}/#business`,
    name: biz.legalName || biz.name,
    url: SITE_URL,
    image: `${SITE_URL}/assets/img/og-image.jpg`,
    telephone: biz.phoneE164,
    address: {
      "@type": "PostalAddress",
      streetAddress: biz.street,
      postalCode: biz.postalCode,
      addressLocality: biz.city,
      addressRegion: biz.region,
      addressCountry: biz.country,
    },
    geo: { "@type": "GeoCoordinates", latitude: biz.latitude, longitude: biz.longitude },
    hasMap: links.place,
    inLanguage: lang,
  };
  if (biz.servesCuisine?.length) d.servesCuisine = biz.servesCuisine;
  if (biz.priceRange) d.priceRange = biz.priceRange;
  if (biz.website) d.sameAs = [biz.website];
  if (biz.acceptsReservations) d.acceptsReservations = "https://schema.org/True";
  if (biz.rating) {
    d.aggregateRating = {
      "@type": "AggregateRating", ratingValue: biz.rating,
      reviewCount: biz.ratingCount, bestRating: 5, worstRating: 1,
    };
  }
  return JSON.stringify(d, null, 2);
}

/* llms.txt — the machine-readable site summary that AI crawlers and answer engines
   read (llmstxt.org). Generated on every build from data.json plus the default
   dictionary, never hand-written, so it cannot drift from the rendered pages: change a
   phone number or add a dish and the file follows. Shape follows the spec — one H1, a
   blockquote summary, then flat link lists — because that is the part parsers read
   reliably. Served at /llms.txt, which is where the convention looks for it.
   NOTE: only facts already public on the site go in here. No hours, no prices, no
   provenance — the same omissions the pages keep. */
function buildLlmsTxt() {
  const t = dicts[DEFAULT];
  const at = (p) => `${SITE_URL}/${p}`;
  const flat = (s) => String(s).replace(/\s+/g, " ").trim();
  const out = [];
  const push = (...ls) => ls.forEach((l) => out.push(l));

  push(`# ${biz.legalName || biz.name}`, "");
  push(`> ${flat(t.meta.description)}`, "");
  if (t.brand?.sub) push(`${flat(t.brand.sub)}.`);

  /* One or two prose paragraphs: the section this business type uses for the "who we
     are" text. The hero is a slogan; the about/hotel/roast lead is the description an
     answer engine can actually quote. */
  const prose = [t.about?.lead, t.about?.body1 ?? t.about?.body, t.hotel?.lead, t.roast?.lead]
    .filter((p) => typeof p === "string" && p.trim())
    .slice(0, 2)
    .map(flat);
  if (prose.length) push("", ...prose);

  /* Body sections: every dictionary section that carries content items, in dictionary
     order, titled by the section's own heading. The item text field differs per
     business type (text, note, detail), so each is tried before the item is dropped. */
  /* Section headings when a dictionary block has no title of its own. The numbered
     steps lists live inside the about/treatment area on the page and carry no heading,
     so they need one here or the file reads as an unlabelled dump. */
  const UNTITLED = { ca: "Com funciona", es: "Cómo funciona", en: "How it works" };
  const SKIP = new Set([
    "meta", "a11y", "brand", "nav", "langSwitch", "cookies", "cookie", "footer", "foot",
    "jsonLd", "languageNames", "photo", "reviews", "hero", "about", "countryName",
    "locale", "htmlLang", "ogLocale", "dir", "pathPrefix", "facts", "strip", "glance",
    "visit", "book", "contact",
  ]);
  for (const [key, sec] of Object.entries(t)) {
    if (SKIP.has(key) || !sec || typeof sec !== "object" || Array.isArray(sec)) continue;
    const entries = [];
    if (sec.items && typeof sec.items === "object") {
      for (const it of Object.values(sec.items)) {
        if (!it || typeof it !== "object") continue;
        const label = it.title ?? it.name;
        const text = it.text ?? it.note ?? it.detail ?? it.description ?? "";
        if (label) entries.push(`- **${flat(label)}**${text ? `: ${flat(text)}` : ""}`);
      }
    } else {
      /* Sections that group prose blocks instead of a list (treatments, services). */
      for (const it of Object.values(sec)) {
        if (it && typeof it === "object" && typeof it.title === "string") {
          const text = it.lead ?? it.text ?? "";
          entries.push(`- **${flat(it.title)}**${text ? `: ${flat(text)}` : ""}`);
        }
      }
    }
    if (!entries.length) continue;
    push("", `## ${flat(sec.title || sec.eyebrow || UNTITLED[DEFAULT] || key)}`);
    if (sec.lead) push("", flat(sec.lead));
    push("", ...entries);
  }

  /* The facts an answer engine quotes verbatim. */
  push("", "## Practical information", "");
  push(`- Address: ${[biz.street, `${biz.postalCode} ${biz.city}`.trim(), biz.region]
    .filter(Boolean).map(flat).join(", ")}`);
  if (biz.phoneNational) push(`- Phone: ${biz.phoneNational}${biz.phoneE164 ? ` (${biz.phoneE164})` : ""}`);
  if (biz.phoneIsMobile && biz.phoneE164) {
    push(`- WhatsApp: https://wa.me/${biz.phoneE164.replace(/[^0-9]/g, "")}`);
  }
  if (biz.website) push(`- Website: ${biz.website}`);
  push(`- Google listing: ${links.place}`);
  push(`- Directions: ${links.directions}`);
  if (biz.plusCode) push(`- Plus code: ${biz.plusCode}`);
  if (biz.rating > 4) {
    push(`- Rating: ${Number(biz.rating).toFixed(1)}/5${biz.ratingCount > 50
      ? ` from ${Number(biz.ratingCount).toLocaleString("en-GB")} Google reviews` : ""}`);
  }
  push(`- Coordinates: ${biz.latitude}, ${biz.longitude}`);

  /* Testimonials, short and attributed: the quote is what gets cited. */
  const quotes = Object.values(t.reviews?.items || {})
    .filter((q) => q && typeof q.text === "string")
    .slice(0, 3);
  if (quotes.length) {
    push("", "## What customers say");
    for (const q of quotes) {
      push("", `> "${flat(q.text)}"${q.author ? ` — ${flat(q.author)}` : ""}`);
    }
  }

  /* Every locale is a real page with its own URL, so an answer engine can send a
     reader to the language they asked in. */
  push("", "## Languages", "");
  for (const l of LANGS) {
    push(`- [${l.name}](${at(l.dir)})${l.code === DEFAULT ? " — default" : ""}`);
  }

  push("", "## Canonical", "", `- Home: ${SITE_URL}`, `- Sitemap: ${SITE_URL}/sitemap.xml`, "");
  return out.join("\n");
}

const ast = parse(tokenize(read("src/template.html")));
const YEAR = new Date().getFullYear();
const FLAGS = JSON.parse(read("scripts/flags.json"));

function buildLocale(lang) {
  const t = dicts[lang];
  const prefix = t.pathPrefix;
  const langs = LANGS.map((l) => ({
    code: l.code, name: l.name, flag: FLAGS[l.code] || "",
    current: l.code === lang, href: prefix + l.dir,
  }));
  const alternates = LANGS.map((l) => ({ hreflang: l.hreflang || l.code, path: l.dir }));
  alternates.push({ hreflang: "x-default", path: "" });

  const featureKeys = Object.keys(t.features?.items || {});
  const dishKeys = Object.keys(t.menu?.items || {});
  const quoteKeys = Object.keys(t.reviews?.items || {});

  const model = {
    meta: {
      lang, title: t.meta.title, description: t.meta.description,
      ogAlt: t.meta.ogAlt || t.meta.title, ogLocale: t.ogLocale,
      assetBase: prefix,
      canonicalPath: lang === DEFAULT ? "" : lang + "/",
    },
    site: { url: SITE_URL },
    business: {
      ...biz,
      cityShort: biz.city,
      countryName: t.countryName || biz.country,
      websiteHost: (biz.website || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
      ratingFormatted: biz.rating ? Number(biz.rating).toFixed(1) : "",
      // The brief only publishes the review count above 50. Below that the number
      // reads as inexperience, so the template must hide it in every place it appears.
      ratingCount: biz.ratingCount > 50
        ? Number(biz.ratingCount).toLocaleString(lang === "en" ? "en-GB" : "es-ES")
        : "",
      showRatingCount: biz.ratingCount > 50,
      phoneIsMobile: !!biz.phoneIsMobile,
      whatsappLink: biz.phoneIsMobile
        ? `https://wa.me/${biz.phoneE164.replace(/[^0-9]/g, "")}`
        : "",
    },
    links: { ...links, mapEmbed: links.mapEmbed(lang) },
    heroPhoto,
    t, langs, alternates, year: YEAR, jsonLd: jsonLd(t, lang),
    featureCards: featureKeys.map((k) => ({
      icon: iconFor(k), title: t.features.items[k].title, text: t.features.items[k].text,
    })),
    dishes: dishKeys.map((k) => ({ title: t.menu.items[k].title, text: t.menu.items[k].text })),
    quotes: quoteKeys.map((k) => {
      const q = t.reviews.items[k];
      return {
        text: q.text, author: q.author, meta: q.meta || "",
        initial: (q.author || "?").trim().charAt(0).toUpperCase(),
        stars: Array.from({ length: q.stars || 5 }, (_, s) => ({ s })),
        ratingLabel: (t.reviews.starsLabel || "{n}/5").replace("{n}", q.stars || 5),
      };
    }),
  };

  const html = render(ast, { root: model, value: model });
  if (/\{\{|\}\}/.test(html)) {
    const m = html.match(/.{0,60}\{\{.{0,60}/);
    throw new Error(`[${lang}] unresolved template hole near: ${m && m[0]}`);
  }
  if (/href=""/.test(html) || /src=""/.test(html)) throw new Error(`[${lang}] empty href/src emitted`);
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) throw new Error(`[${lang}] JSON-LD block missing`);
  JSON.parse(ld[1]);

  write(lang === DEFAULT ? "index.html" : `${lang}/index.html`, html);
  console.log(`✓ ${lang}/index.html (${(html.length / 1024).toFixed(1)} kB)`);
}

for (const l of LANGS) buildLocale(l.code);

/* Locale moves: when the default locale changes, the old path of the new default must
   redirect to the root, or every link already shared 404s. Declare them in
   data.json as {"redirects": {"ca": "/"}} — key: old output dir, value: target. */
const REDIRECT_COPY = {
  ca: { title: "Redirigint…", link: "Continua" },
  es: { title: "Redirigiendo…", link: "Continúa" },
  en: { title: "Redirecting…", link: "Continue" },
};
for (const [from, to] of Object.entries(biz.redirects || {})) {
  if (LANGS.some((l) => l.dir === from)) continue;
  // Sites live at a subdomain root, so the target is relative to the redirect
  // page's own directory. "../" climbs out of the old locale dir; "./" inside
  // /ca/ would resolve to /ca/ and loop forever.
  const depth = from.split("/").filter(Boolean).length;
  const target = depth === 0 ? to : "../".repeat(depth) + String(to).replace(/^\.?\//, "");
  const copy = REDIRECT_COPY[DEFAULT] || REDIRECT_COPY.en;
  const absTarget = new URL(target, `${SITE_URL}/${from.endsWith("/") ? from : from + "/"}`).href;
  const html = `<!DOCTYPE html><html lang="${DEFAULT}"><head><meta charset="utf-8">
<link rel="canonical" href="${absTarget}">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0; url=${target}">
<title>${copy.title}</title>
</head><body><p><a href="${target}">${copy.link}</a></p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;
  write(from.replace(/\/$/, "") + "/index.html", html);
  console.log(`✓ redirect ${from} -> ${target}`);
}

const today = new Date().toISOString().slice(0, 10);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map((l) => {
  const alts = LANGS.map((o) => `    <xhtml:link rel="alternate" hreflang="${o.hreflang || o.code}" href="${SITE_URL}/${o.dir}"/>`).join("\n");
  return `  <url>\n    <loc>${SITE_URL}/${l.dir}</loc>\n${alts}\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/"/>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${l.default ? "1.0" : "0.8"}</priority>\n  </url>`;
}).join("\n")}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
write("llms.txt", buildLlmsTxt());
write("site.webmanifest", JSON.stringify({
  name: biz.legalName || biz.name, short_name: biz.name, start_url: "./",
  display: "standalone", background_color: biz.manifestBackground || "#ffffff",
  theme_color: biz.manifestTheme || "#111111",
  icons: [
    { src: "assets/img/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "assets/img/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
}, null, 2) + "\n");

console.log("✓ sitemap.xml, robots.txt, site.webmanifest, llms.txt");
