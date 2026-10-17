/* =========================================================
   مقابلتك — common.js (كل الصفحات)
   1) حفظ بيانات الحملة (UTM / fbclid) خلال جلسة التصفح وتمريرها لصفحة التسجيل
   2) قياس داخلي بدون ملفات ارتباط: عدّادات مجمّعة تُرسل إلى /api/track
      (لا IP محفوظ، لا معرّف زائر، لا بيانات شخصية)
   3) Meta Pixel — يعمل عندما META_PIXEL_ENABLED = true في config.js.
      - لا يُرسل أي بيانات شخصية (لا اسم/بريد/هاتف/رقم تسجيل).
      - autoConfig مُعطّل: لا أحداث تلقائية من Meta (مثل SubscribedButtonClick).
      - يحترم اختيار الزائر «إيقاف التتبع الإعلاني» من صفحة الخصوصية.
   لا نستخدم وسم <noscript> الخاص بـ Pixel.
   يتطلب تحميل config.js قبله.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.MUQ_CONFIG || {};
  var PIXEL_ID = String(CFG.META_PIXEL_ID || '').trim();
  var OPTOUT_KEY = 'muq_ads_optout';
  function optedOut() { try { return window.localStorage.getItem(OPTOUT_KEY) === '1'; } catch (e) { return false; } }
  var PIXEL_ON = CFG.META_PIXEL_ENABLED === true && /^\d{10,20}$/.test(PIXEL_ID) && !optedOut();
  var TRACK_URL = CFG.TRACK_ENDPOINT || '/api/track';
  var ATTR_KEY = 'muq_attribution';
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

  var MUQ = (window.MUQ = window.MUQ || {});

  function sget(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }

  /* =========================================================
     1) ATTRIBUTION — whitelist, length-limited, session-scoped
     ========================================================= */
  function sanitize(v, max) {
    v = String(v || '').slice(0, max);
    return /^[\w\-.~%+:|/ ]+$/.test(v) ? v : '';
  }
  function readUrlAttr() {
    var out = {}, any = false;
    try {
      var p = new URLSearchParams(window.location.search);
      ATTR_KEYS.forEach(function (k) {
        var v = sanitize(p.get(k), k === 'fbclid' ? 500 : 150);
        if (v) { out[k] = v; any = true; }
      });
    } catch (e) {}
    return any ? out : null;
  }
  var fromUrl = readUrlAttr();
  if (fromUrl) sset(ATTR_KEY, JSON.stringify(fromUrl));
  MUQ.getAttribution = function () {
    if (fromUrl) return fromUrl;
    try { return JSON.parse(sget(ATTR_KEY) || 'null') || {}; } catch (e) { return {}; }
  };
  MUQ.withAttribution = function (href) {
    var a = MUQ.getAttribution();
    try {
      var u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin) return href;
      Object.keys(a).forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, a[k]); });
      return u.pathname.replace(/^.*\//, '') + u.search + u.hash;
    } catch (e) { return href; }
  };

  /* =========================================================
     2) FIRST-PARTY COUNTERS (cookieless)
     MUQ.count(type, {cta}) — counted once per tab session per key.
     Sends only: event type, CTA position, and campaign-level UTM
     (source/medium/campaign/content). Never fbclid, never personal data.
     ========================================================= */
  MUQ.count = function (type, extra) {
    extra = extra || {};
    var onceKey = 'muq_c_' + type;
    if (sget(onceKey)) return false;            // once per session → "sessions", not raw hits
    sset(onceKey, '1');
    var a = MUQ.getAttribution();
    var body = JSON.stringify({
      type: type,
      cta: extra.cta || null,
      utm_source: a.utm_source || null,
      utm_medium: a.utm_medium || null,
      utm_campaign: a.utm_campaign || null,
      utm_content: a.utm_content || null,
    });
    try {
      if (navigator.sendBeacon) {
        return navigator.sendBeacon(TRACK_URL, new Blob([body], { type: 'application/json' }));
      }
    } catch (e) {}
    try { fetch(TRACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }); } catch (e) {}
    return true;
  };

  /* =========================================================
     3) META PIXEL — loaded once per page
     ========================================================= */
  var pixelLoaded = false;
  function loadPixel() {
    if (pixelLoaded || !PIXEL_ON) return;
    pixelLoaded = true;
    if (!window.fbq) {
      /* Official Meta Pixel base code */
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }
    try {
      window.fbq('set', 'autoConfig', false, PIXEL_ID);   // no automatic events / button scraping
      window.fbq('init', PIXEL_ID);                        // no advanced-matching data passed
      window.fbq('track', 'PageView');
    } catch (e) {}
  }

  var BLOCKED = { Purchase: 1, InitiateCheckout: 1, AddPaymentInfo: 1 };   // no payments exist
  /**
   * MUQ.track(name, params, opts) — standard event. Returns true only if sent.
   * MUQ.trackCustom(name, params) — custom event (e.g. PurchaseIntent).
   * Both are no-ops while the Pixel is disabled.
   */
  MUQ.track = function (name, params, opts) {
    if (BLOCKED[name] || !pixelLoaded || !window.fbq) return false;
    try {
      if (opts && opts.eventID) window.fbq('track', name, params || {}, { eventID: opts.eventID });
      else window.fbq('track', name, params || {});
      return true;
    } catch (e) { return false; }
  };
  MUQ.trackCustom = function (name, params) {
    if (BLOCKED[name] || !pixelLoaded || !window.fbq) return false;
    try { window.fbq('trackCustom', name, params || {}); return true; } catch (e) { return false; }
  };
  MUQ.pixelActive = function () { return pixelLoaded && !!window.fbq; };

  /* Fire an event at most once per tab session (key = name + optional scope) */
  MUQ.trackOncePerSession = function (kind, name, params, scope) {
    var key = 'muq_px_' + name + (scope ? '_' + scope : '');
    if (sget(key)) return false;
    var sent = kind === 'custom' ? MUQ.trackCustom(name, params) : MUQ.track(name, params);
    if (sent) sset(key, '1');
    return sent;
  };

  /* Visitor opt-out of ad tracking (link on privacy.html — no pop-up) */
  MUQ.adsOptedOut = optedOut;
  MUQ.setAdsOptOut = function (on) {
    try {
      if (on) window.localStorage.setItem(OPTOUT_KEY, '1');
      else window.localStorage.removeItem(OPTOUT_KEY);
    } catch (e) {}
    if (on && window.fbq) { try { window.fbq('consent', 'revoke'); } catch (e) {} }
  };

  /* ---------- Init ---------- */
  function init() {
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    // Opt-out control (privacy page)
    var btn = document.getElementById('adsOptOutBtn'), st = document.getElementById('adsOptOutState');
    if (btn && st) {
      var paint = function () {
        var off = optedOut();
        st.textContent = off ? 'التتبع الإعلاني متوقف على هذا المتصفح.' : 'التتبع الإعلاني مفعّل على هذا المتصفح.';
        btn.textContent = off ? 'إعادة تفعيل التتبع الإعلاني' : 'إيقاف التتبع الإعلاني';
      };
      paint();
      btn.addEventListener('click', function () { MUQ.setAdsOptOut(!optedOut()); paint(); });
    }
    loadPixel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Pixel must exist before page scripts call MUQ.track
  loadPixel();
})();
