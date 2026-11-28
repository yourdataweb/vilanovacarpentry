/**
 * Offer panel — the conversion surface.
 *
 * Source of truth: yourdataweb/site-components (offer-panel.css, offer-panel.js).
 * Vendored into every site by scripts/sync-shared.mjs and pinned by src/components.lock.
 *
 * The situation this serves: the business has a finished website it did not commission.
 * The site is live for a fixed period, then it comes down unless they buy. This panel is
 * where that fact is stated and where the decision is made.
 *
 * Read from the site's data file (src/data.json):
 *   offerEnds   ISO date (YYYY-MM-DD) the site stops being free. Omit to hide the countdown.
 *   buyUrl      checkout / payment link. When absent the primary action becomes a call,
 *               because inventing a "buy" that only dials a phone would be a mislabel.
 *   offerEmail  contact address for the sales action. When absent, falls back to the phone.
 *
 * Behaviour, deliberately conservative:
 *   - Shows once per visit (sessionStorage), not on every page load, and never again in the
 *     same tab after closing. A nagging modal is why visitors bounce.
 *   - Closing leaves a small, quiet "offer" pill so the decision is never lost, only deferred.
 *   - Escape closes, focus is trapped while open and restored on close, the page behind is
 *     inert to mouse and keyboard.
 *   - With JavaScript off nothing renders: the site stays fully readable, which is the point
 *     of the site. The panel is an overlay, never the content.
 */
(function () {
  "use strict";

  var KEY = "sm-offer-dismissed-v1";
  var DELAY = 900;

  function readConfig() {
    var el = document.getElementById("sm-offer-config");
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function daysLeft(iso) {
    if (!iso) return null;
    var end = new Date(iso + "T23:59:59").getTime();
    if (isNaN(end)) return null;
    return Math.ceil((end - Date.now()) / 86400000);
  }

  function dismissed() {
    try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function remember() {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ }
  }

  function build(cfg, t) {
    var overlay = document.createElement("div");
    overlay.className = "sm-offer";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "sm-offer-title");
    overlay.setAttribute("aria-describedby", "sm-offer-lead");

    var days = daysLeft(cfg.offerEnds);
    var urgent = days !== null && days <= 30;

    var features = (t.features || []).map(function (f) {
      return '<li class="sm-offer__feature">' + f + "</li>";
    }).join("");

    /* Days are stated as a number, not a ticking clock: a per-second countdown on a
       three-month window is theatre, and visitors read theatre as pressure. */
    var meta = "";
    if (cfg.offerEnds) {
      meta = '<p class="sm-offer__meta' + (urgent ? " is-urgent" : "") + '">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>' +
        '<span>' + t.until + " <strong>" + cfg.offerEndsLabel + "</strong>" +
        (days !== null && days > 0
          ? ' <span class="sm-offer__days">' + t.days.replace("{n}", days) + "</span>"
          : "") +
        "</span></p>";
    }

    /* Two actions must go two different places. Without a checkout link the primary
       becomes the phone call, and the secondary is dropped rather than pointing at the
       same number twice — two buttons that do the same thing is a dead end dressed as
       a choice. */
    /* No checkout link and no phone means there is no action to offer. Never build a
       `tel:` with an empty number: it renders a dead link, and on a business with no
       phone that is worse than admitting there is only one way to reach them. */
    var hasPhone = !!(cfg.phoneE164 && String(cfg.phoneE164).replace(/[^0-9]/g, "").length >= 6);
    var primaryHref = cfg.buyUrl || (hasPhone ? ("tel:" + cfg.phoneE164) : ("mailto:" + (cfg.offerEmail || "")));
    if (!cfg.buyUrl && !hasPhone && !cfg.offerEmail) return null;
    var primaryLabel = cfg.buyUrl ? t.buy : (hasPhone ? t.buyPhone : t.contact);
    var primaryAttrs = cfg.buyUrl ? ' target="_blank" rel="noopener"' : "";

    var secondaryHref = "";
    var secondaryLabel = "";
    if (cfg.buyUrl) {
      /* Checkout exists: the alternative is a human, by email if we have one. */
      if (cfg.offerEmail) { secondaryHref = "mailto:" + cfg.offerEmail; secondaryLabel = t.contact; }
      else if (hasPhone) { secondaryHref = "tel:" + cfg.phoneE164; secondaryLabel = t.call; }
    } else if (cfg.offerEmail && hasPhone) {
      secondaryHref = "tel:" + cfg.phoneE164;
      secondaryLabel = t.call;
    }

    overlay.innerHTML =
      '<div class="sm-offer__backdrop" data-offer-close></div>' +
      '<div class="sm-offer__panel">' +
        '<button class="sm-offer__close" type="button" data-offer-close aria-label="' + t.close + '">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>' +
        "</button>" +
        '<p class="sm-offer__kicker">' + t.kicker + "</p>" +
        '<h2 class="sm-offer__title" id="sm-offer-title">' + t.title + "</h2>" +
        '<p class="sm-offer__lead" id="sm-offer-lead">' + t.lead + "</p>" +
        (features ? '<ul class="sm-offer__features">' + features + "</ul>" : "") +
        '<div class="sm-offer__price">' +
          '<span class="sm-offer__price-year">' + t.priceYear + "</span>" +
          '<span class="sm-offer__price-eq" aria-hidden="true">=</span>' +
          '<span class="sm-offer__price-month">' + t.priceMonth + "</span>" +
        "</div>" +
        '<p class="sm-offer__price-note">' + t.priceNote + "</p>" +
        meta +
        '<div class="sm-offer__actions">' +
          '<a class="sm-offer__cta" href="' + primaryHref + '"' + primaryAttrs + ">" +
            t.cta + "</a>" +
          (secondaryHref
            ? '<a class="sm-offer__secondary" href="' + secondaryHref + '">' + secondaryLabel + "</a>"
            : "") +
        "</div>" +
        '<p class="sm-offer__foot">' + t.foot + "</p>" +
      "</div>";

    return overlay;
  }

  function init() {
    var cfg = readConfig();
    if (!cfg || !cfg.copy) return;

    var page = document.body;
    var opener = null;

    function open() {
      if (document.getElementById("sm-offer-root")) return;
      var overlay = build(cfg, cfg.copy);
      /* No reachable action at all: show nothing rather than a panel with no exit. */
      if (!overlay) { showPill(); return; }
      overlay.id = "sm-offer-root";
      page.appendChild(overlay);
      page.classList.add("sm-offer-open");
      document.documentElement.classList.add("sm-offer-open");

      var focusables = overlay.querySelectorAll(
        'a[href], button:not([disabled])'
      );
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (first) first.focus({ preventScroll: true });

      overlay.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { close(); return; }
        if (e.key !== "Tab" || !focusables.length) return;
        /* Keep Tab inside the dialog; without this it walks into the page behind. */
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      });
    }

    function close() {
      var overlay = document.getElementById("sm-offer-root");
      if (overlay) overlay.parentNode.removeChild(overlay);
      page.classList.remove("sm-offer-open");
      document.documentElement.classList.remove("sm-offer-open");
      remember();
      showPill();
      if (opener && opener.focus) opener.focus({ preventScroll: true });
    }

    /* A quiet reopen affordance, so closing defers the decision instead of losing it. */
    function showPill() {
      if (document.getElementById("sm-offer-pill")) return;
      var pill = document.createElement("button");
      pill.id = "sm-offer-pill";
      pill.className = "sm-offer-pill";
      pill.type = "button";
      pill.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v4h1"/></svg>' +
        "<span>" + cfg.copy.pill + "</span>";
      pill.addEventListener("click", function (e) {
        /* Direct binding, and the event is consumed here: a site script that stops
           propagation on body clicks was swallowing the reopen. */
        e.preventDefault();
        e.stopPropagation();
        opener = pill;
        if (pill.parentNode) pill.parentNode.removeChild(pill);
        open();
      }, true);
      page.appendChild(pill);
    }

    page.addEventListener("click", function (e) {
      if (e.target.closest("[data-offer-close]")) { close(); }
    });

    if (dismissed()) {
      showPill();
    } else {
      /* Never steal a click the visitor has already made. If they interact with the
         page (language switch, nav, a link) before the panel is due, drop the auto
         open and leave the pill: a dialog that appears under someone's cursor while
         they are choosing a language is the worst possible first impression. */
      var cancelled = false;
      function cancel() {
        if (cancelled) return;
        cancelled = true;
        window.clearTimeout(timer);
        document.removeEventListener("pointerdown", cancel, true);
        document.removeEventListener("keydown", cancel, true);
        if (!document.getElementById("sm-offer-root")) showPill();
      }
      var timer = window.setTimeout(function () {
        document.removeEventListener("pointerdown", cancel, true);
        document.removeEventListener("keydown", cancel, true);
        open();
      }, DELAY);
      document.addEventListener("pointerdown", cancel, true);
      document.addEventListener("keydown", cancel, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
