/**
 * Shared header toolbar — one row on every screen size.
 *
 * Source of truth: yourdataweb/site-components (header-tools.css, header-tools.js).
 * Vendored into every site by scripts/sync-shared.mjs and pinned by src/components.lock.
 *
 * The problem this fixes: sites put the language switch in a top strip and the menu
 * button in the header below it, so on a phone they landed on two rows, misaligned,
 * often with the business name squeezed to a few characters. Measured on 8 of 16
 * sites: language switch at y=35, menu button at y=77.
 *
 * The fix is a single toolbar that owns the name, the menu button and the language
 * switch in one flex row. Nothing is duplicated: this script moves the existing
 * switch into the existing header and wraps the three items in one container, so
 * every site keeps its own markup and colours and gains the same geometry.
 *
 * Progressive: with JavaScript off the switch stays where the template put it. It
 * still works, it is just less tidy — this is layout polish, never content.
 */
(function () {
  "use strict";

  /* Class families used by the generated sites for the same three things. Listed
     explicitly: matching on structure alone picked up the footer brand too. */
  var IDENTITY_NAMES = [
    ".brand__name", ".identity__name", ".marchio__name",
    ".logo__name", ".mark__name", ".sign__name", ".brand-name"
  ];
  /* Some sites put the icon straight into the identity link instead of wrapping it
     in a __mark span. Marking it here means the stylesheet can keep it from
     shrinking without needing a class per site. */
  var IDENTITY_LINKS = [
    ".brand", ".identity", ".marchio", ".logo", ".mark", ".sign", ".site-brand"
  ];
  var HEADERS = [
    ".header", ".site-header", ".insegna", ".site-head", ".bar", ".topbar"
  ];

  function first(list, root) {
    for (var i = 0; i < list.length; i++) {
      var el = (root || document).querySelector(list[i]);
      if (el) return el;
    }
    return null;
  }

  /* The header that actually holds the identity, not the thin address strip. */
  function findHeader() {
    var candidates = [];
    for (var i = 0; i < HEADERS.length; i++) {
      var all = document.querySelectorAll(HEADERS[i]);
      for (var j = 0; j < all.length; j++) candidates.push(all[j]);
    }
    /* Score rather than pick the first match: the thin address strip is also a
       `.topbar`, and choosing it left the menu button behind in the real header.
       A menu button outranks a language switch, because the button is what has to
       share the row with the switch. */
    var best = null, bestScore = -1;
    for (var k = 0; k < candidates.length; k++) {
      var el = candidates[k];
      var score = 0;
      if (el.querySelector(".nav-toggle, .navbtn, .menu-toggle")) score += 3;
      if (el.querySelector(".langs")) score += 2;
      if (el.querySelector("a.brand, .identity, .marchio, .logo, .sign")) score += 1;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore > 0 ? best : first(HEADERS);
  }

  function run() {
    var header = findHeader();
    if (!header || header.getAttribute("data-tools") === "ready") return;
    /* Idempotent: a second pass (script re-evaluated, or an SPA-like re-entry) must
       not append a second toolbar beside the first. */
    if (header.querySelector(".sm-tools")) {
      header.setAttribute("data-tools", "ready");
      return;
    }

    var inner = header.querySelector(".wrap, .shell, .container") || header;
    var toggle = first([".nav-toggle", ".navbtn", ".menu-toggle"], header);
    /* Prefer a switch already inside the header; a site with two (one in the thin
       address strip, one in the bar) would otherwise move the strip's copy and
       leave the visible one stranded. */
    var langs = header.querySelector(".langs") || first([".langs"], document);
    var identity = first([
      ".brand", ".identity", ".marchio", ".logo", ".sign", ".site-brand"
    ], header);
    var nameEl = first(IDENTITY_NAMES, document);

    if (!toggle && !langs) return;

    /* One container for the three things that belong on the bar's right edge. */
    var tools = document.createElement("div");
    tools.className = "sm-tools";

    /* A site may carry its own tools wrapper (a phone link, a switch). Fold its
       children into the shared toolbar instead of leaving a second flex group that
       squeezes the identity to zero width. */
    var existing = inner.querySelector(":scope > .head-tools, :scope > .header-tools, :scope > .topbar__right, :scope > .topbar__tools, :scope > .header__tools");
    if (existing) {
      while (existing.firstChild) tools.appendChild(existing.firstChild);
      existing.parentNode.removeChild(existing);
    }

    if (langs && langs.parentNode !== tools) tools.appendChild(langs);
    if (toggle && toggle.parentNode !== tools) tools.appendChild(toggle);

    inner.appendChild(tools);
    header.setAttribute("data-tools", "ready");
    document.documentElement.classList.add("has-tools");

    /* Hand the name element its own hook so the stylesheet can clamp it without
       matching a dozen different BEM families. */
    if (nameEl) nameEl.classList.add("sm-name");

    /* A bare <svg> directly inside the identity link is that site's mark. */
    var link = first(IDENTITY_LINKS, header);
    if (link) {
      var kids = link.children;
      for (var c = 0; c < kids.length; c++) {
        if (kids[c].tagName && kids[c].tagName.toLowerCase() === "svg") {
          kids[c].classList.add("sm-mark");
        }
      }
    }

    /* The address strip above the header repeats information that is in the footer
       and in the contact block. On a phone it is the thing pushing the bar down,
       so the stylesheet hides it below the mobile breakpoint. */
    var strip = document.querySelector(".topbar__note, .topbar__tel");
    if (strip) strip.classList.add("sm-strip-note");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
