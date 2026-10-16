/* =========================================================
   مقابلتك — script.js (الصفحة الرئيسية فقط)
   يتطلب config.js ثم common.js قبله.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.MUQ_CONFIG || {};
  var MUQ = window.MUQ || { track: function () { return false; }, withAttribution: function (h) { return h; } };
  var PRODUCT = { content_name: 'Muqabaltak', content_type: 'product', value: 49, currency: 'SAR' };

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
     TRACKING
     ========================================================= */

  /* 1) ViewContent — once per page view.
        If consent is still pending, it is sent once if the visitor accepts on this page. */
  MUQ.track('ViewContent', PRODUCT, { queue: true });

  /* 2) CTA → checkout.html (keeps UTM / fbclid) + InitiateCheckout
        - Every buy button has [data-cta].
        - One delegated listener → one event per click, even with nested elements (img inside link).
        - Guard prevents double-fire on double-tap. */
  var checkoutUrl = CFG.CHECKOUT_URL || 'checkout.html';
  var ctas = document.querySelectorAll('a[data-cta]');
  ctas.forEach(function (a) { a.setAttribute('href', MUQ.withAttribution(checkoutUrl)); });

  var navigating = false;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-cta]');
    if (!a) return;
    // Let new-tab / modified clicks behave normally (no event, no hijack)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (navigating) return;
    navigating = true;

    var href = a.getAttribute('href');
    var sent = MUQ.track('InitiateCheckout', PRODUCT);
    // Short delay only when the Pixel is active, so the request can leave before navigation
    window.setTimeout(function () { window.location.href = href; }, sent ? 250 : 0);
  });
  // Back/forward cache: allow clicking again
  window.addEventListener('pageshow', function () { navigating = false; });
})();
