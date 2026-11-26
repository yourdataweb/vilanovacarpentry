# Vilanova Carpentry SL — website

Static, trilingual site for a joinery workshop and timber merchant in Vilanova i la Geltrú.
Plain HTML, one stylesheet, one small progressive-enhancement script. No framework, no build
runtime: the build step renders the three language pages ahead of time.

- Public URL: <https://vilanovacarpentry.vilanovailageltru.info/>
- Languages: Catalan (default, `/`), Spanish (`/es/`), English (`/en/`)

## Build

```bash
node scripts/build.mjs      # src/template.html + src/i18n/*.json -> index.html, es/, en/
node scripts/assets.mjs     # favicon, PWA icons, og-image.jpg (needs assets/fonts/)
node scripts/verify.mjs     # headless checks: SEO, a11y, layout, consent, responsive
node scripts/card.mjs       # assets/photos/handover.png (10.5 x 14.5 cm @ 300 dpi, with QR)
node scripts/optimize-card.mjs  # compacts handover.png under the 700 kB budget
```

`node_modules` is a symlink to the workspace install (puppeteer, qrcode, pngjs); it is ignored
by git.

## Structure

```
src/
  data.json          business facts: address, phone, coordinates, rating, reviews, photo credit
  locales.json       locale list: code, name, output dir, hreflang
  template.html      single template, rendered once per locale
  i18n/<code>.json   all copy: meta, hero, sections, reviews, contact, cookies
  hero-source.jpg    workshop photo, copied into assets/img/ at build time
assets/
  css/styles.css     design tokens, layout, responsive rules
  js/main.js         nav toggle, scroll reveal, cookie banner, deferred map
  fonts/             self-hosted Fraunces + Inter (woff2, latin + latin-ext)
  img/               generated icons and og-image
  photos/handover.png
scripts/             build, asset generation, verification, handover card
```

## Content rules applied

- Every absolute URL (canonical, `og:url`, hreflang, sitemap, OG image, QR) derives from
  `slug` + `siteDomain` in `src/data.json`; no host is hardcoded in the template.
- Opening hours and price level are deliberately absent: they date quickly.
- The rating is shown as `4.4 / 5` with the review count of 225. There is no oversized star
  badge, because the rating is not high enough to carry a hero claim.
- Testimonials are the two positive Google reviews, rewritten into each language rather than
  pasted in the source language.
- The phone number is a landline, so the site offers `tel:` links only — no WhatsApp button.
- The business has no website, so the "listing" links point at its Google Maps entry.
- The workshop photo is credited to its author in the hero, as the source requires.

## Privacy

Google Analytics 4 loads only after the visitor accepts. The banner calls
`window.__analyticsConsent(true|false)`, which is the single place that writes the consent key
(`cookie-consent-v1`); the embedded Google map uses the same decision and is injected as an
iframe only after acceptance. With storage denied by default, no cookies are written before
consent.

## Accessibility and SEO

- One `h1` per page, ordered headings, skip link, visible focus rings, labelled language
  switcher and nav toggle, `aria-expanded` state, Escape closes the mobile nav.
- Colour pairs meet WCAG AA for body and small text on their backgrounds.
- `LocalBusiness` JSON-LD (`HomeAndConstructionBusiness`) with address, geo, phone and rating.
- `hreflang` alternates for all three locales plus `x-default`; per-locale canonical;
  `sitemap.xml`, `robots.txt`, web manifest.
- All assets use relative paths so the site also works from a subdirectory prefix.
