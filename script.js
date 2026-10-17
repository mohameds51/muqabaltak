/* =========================================================
   مقابلتك — script.js (الصفحة الرئيسية فقط)
   يتطلب config.js ثم common.js قبله.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.MUQ_CONFIG || {};
  var MUQ = window.MUQ || { track: function () { return false; }, withAttribution: function (h) { return h; } };

  var header = document.querySelector('.site-header');
  var sticky = document.getElementById('stickyCta');

  /* ---------- Header shadow after slight scroll ---------- */
  var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 8); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Reveal on scroll (fade-up) ---------- */
  var reveals = document.querySelectorAll('.reveal, .flow');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Sticky mobile CTA ----------
     Visible after the hero leaves the viewport,
     hidden while the offer or final CTA is on screen. */
  if (sticky && 'IntersectionObserver' in window) {
    var hero = document.querySelector('.hero');
    var blockers = [document.getElementById('offer'), document.getElementById('final')];
    var heroVisible = true;
    var blockerVisible = new Set();
    var update = function () {
      var show = !heroVisible && blockerVisible.size === 0;
      sticky.classList.toggle('show', show);
      sticky.setAttribute('aria-hidden', String(!show));
      sticky.querySelector('a').tabIndex = show ? 0 : -1;
    };
    new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; update(); }).observe(hero);
    var bo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? blockerVisible.add(e.target) : blockerVisible.delete(e.target); });
      update();
    }, { threshold: 0.15 });
    blockers.forEach(function (b) { if (b) bo.observe(b); });
  }

  /* =========================================================
     MEASUREMENT
     ========================================================= */

  /* 1) First-party visit count (cookieless, once per tab session) */
  MUQ.count && MUQ.count('view_home');

  /* 1b) Meta ViewContent — the visitor is viewing the bundle offer page.
         Once per page load (PageView is sent by common.js). */
  MUQ.track && MUQ.track('ViewContent', { content_name: 'Muqabaltak', content_type: 'product', value: 49, currency: 'SAR' });

  /* 2) CTA → checkout.html, keeping UTM / fbclid in the link.
        Each button has data-cta="<position>" (header, hero, coach, tools, bonuses, offer, final, sticky).
        On a real (trusted) click:
          - first-party "cta_click" count (once per session; position of the first click is stored)
          - Meta custom event PurchaseIntent — once per tab session (avoids double counting
            when a visitor clicks several buttons), only real (trusted) clicks
        No InitiateCheckout / Purchase: nothing is being paid for. */
  var checkoutUrl = CFG.CHECKOUT_URL || 'checkout.html';
  document.querySelectorAll('a[data-cta]').forEach(function (a) {
    a.setAttribute('href', MUQ.withAttribution(checkoutUrl));
  });

  var navigating = false;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-cta]');
    if (!a || !e.isTrusted) return;
    var cta = a.getAttribute('data-cta') || 'unknown';
    MUQ.count && MUQ.count('cta_click', { cta: cta });   // sendBeacon survives navigation

    // New-tab / modified clicks: let the browser handle them
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (navigating) { e.preventDefault(); return; }   // double-tap guard
    var sent = MUQ.trackOncePerSession && MUQ.trackOncePerSession('custom', 'PurchaseIntent', { content_name: 'Muqabaltak', currency: 'SAR', value: 49 });
    if (sent) {
      // Pixel active: give the request a moment to leave before navigating
      e.preventDefault();
      navigating = true;
      var href = a.getAttribute('href');
      window.setTimeout(function () { window.location.href = href; }, 250);
    }
  });
  window.addEventListener('pageshow', function () { navigating = false; });
})();
