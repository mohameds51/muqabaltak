/* =========================================================
   مقابلتك — common.js (كل الصفحات)
   1) حفظ بيانات الحملة (UTM / fbclid) خلال جلسة التصفح وتمريرها لصفحة التسجيل
   2) قياس داخلي بدون ملفات ارتباط: عدّادات مجمّعة تُرسل إلى /api/track
      (لا IP محفوظ، لا معرّف زائر، لا بيانات شخصية)
   3) Meta Pixel + Microsoft Clarity — لا يوقفان عرض الصفحة:
      تُعرَّف الدوال (fbq / clarity) فورًا فلا يضيع أي حدث، لكن ملفاتهما الثقيلة
      لا تُحمَّل إلا بعد اكتمال تحميل الصفحة (أو عند أول تفاعل من الزائر).
      Meta Pixel — يعمل عندما META_PIXEL_ENABLED = true في config.js.
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
  var CLARITY_ID = String(CFG.CLARITY_ID || '').trim();
  var CLARITY_ON = CFG.CLARITY_ENABLED === true && /^[a-z0-9]{6,20}$/i.test(CLARITY_ID) && !optedOut();
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
     3) META PIXEL + MICROSOFT CLARITY

     Delivery stages — tracked separately, never assumed to imply each other:
       a) "pending"  → saved in sessionStorage (survives navigation), not yet given to any SDK
       b) "queued"   → pushed into the SDK stub queue on a page that stays open
       c) "handed"   → passed to the loaded Meta library (fbq.callMethod exists)
       d) arrival at Meta's servers → NOT observable from the browser; only Events Manager shows it.

     Rules:
       - Page events (PageView, ViewContent) are queued in the stub and sent when the library loads
         on that page. A visitor who leaves before that (≈ load + idle) is not counted — known trade-off
         of deferring third-party scripts for speed.
       - Action events (PurchaseIntent, Lead) use the "pending" store, so a click that navigates
         immediately does not lose the event: the next page flushes it (and starts loading the SDK
         right away). Each has a once-key, so it is never sent twice.
       - Opt-out stops everything on the current page: no SDK injection, stub queues emptied,
         pending store cleared, loaded SDKs told to stop (consent revoke).
     ========================================================= */

  var optOutNow = optedOut();
  function trackingAllowed() { return !optOutNow && !optedOut(); }

  /* ---------- Deferred loader: after window load + idle, or first interaction ---------- */
  var deferred = [], deferredFired = false;
  function runDeferred() {
    if (deferredFired) return;
    deferredFired = true;
    var jobs = deferred; deferred = [];
    if (!trackingAllowed()) return;                 // opted out meanwhile → inject nothing
    jobs.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  MUQ.loadTrackingNow = runDeferred;
  function scheduleIdle() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(runDeferred, { timeout: 1500 });
    else window.setTimeout(runDeferred, 200);
  }
  if (document.readyState === 'complete') scheduleIdle();
  else window.addEventListener('load', scheduleIdle, { once: true });
  // First interaction also starts loading — EXCEPT an interaction with the opt-out button itself:
  // pointerdown/keydown fire before its click, so without this check pressing "stop tracking"
  // would be the very thing that loads Meta + Clarity.
  var IX = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
  function onFirstInteraction(e) {
    var t = e && e.target;
    if (t && t.closest && t.closest('#adsOptOutBtn')) return;   // keep listening
    IX.forEach(function (ev) { window.removeEventListener(ev, onFirstInteraction, { passive: true }); });
    runDeferred();
  }
  IX.forEach(function (ev) { window.addEventListener(ev, onFirstInteraction, { passive: true }); });
  var injected = {};
  function injectScript(src, onDone) {
    if (injected[src]) return;                      // never inject the same SDK twice
    injected[src] = true;
    var t = document.createElement('script');
    t.async = true; t.src = src;
    var done = false;
    var finish = function (ok) { if (done) return; done = true; if (onDone) { try { onDone(ok); } catch (e) {} } };
    t.onload = function () { finish(true); };
    t.onerror = function () { finish(false); };      // blocked / offline → no hanging state
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(t, s);
  }

  /* ---------- Meta Pixel: stub now, library later ---------- */
  var pixelOn = false;          // stub installed on this page
  var pixelState = 'off';       // off | stub | loading | ready | failed
  function pixelLibReady() { return !!(window.fbq && typeof window.fbq.callMethod === 'function'); }
  function loadPixel() {
    if (pixelOn || !PIXEL_ON || !trackingAllowed()) return;
    pixelOn = true;
    if (!window.fbq) {
      /* Official Meta Pixel base code, split in two: the queue stub now, fbevents.js later */
      var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!window._fbq) window._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      pixelState = 'stub';
      deferred.push(function () {
        pixelState = 'loading';
        injectScript('https://connect.facebook.net/en_US/fbevents.js', function (ok) {
          pixelState = ok && pixelLibReady() ? 'ready' : 'failed';
        });
      });
    } else {
      pixelState = pixelLibReady() ? 'ready' : 'stub';
    }
    try {
      window.fbq('set', 'autoConfig', false, PIXEL_ID);   // no automatic events / button scraping
      window.fbq('init', PIXEL_ID);                        // no advanced-matching data
      window.fbq('track', 'PageView');
    } catch (e) {}
  }

  /* ---------- Microsoft Clarity: stub now, library later ---------- */
  var clarityOn = false;
  var clarityState = 'off';     // off | stub | loading | loaded | failed
  function loadClarity() {
    if (clarityOn || !CLARITY_ON || !trackingAllowed()) return;
    clarityOn = true;
    /* Official Clarity snippet, split the same way */
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    clarityState = 'stub';
    deferred.push(function () {
      clarityState = 'loading';
      injectScript('https://www.clarity.ms/tag/' + CLARITY_ID, function (ok) { clarityState = ok ? 'loaded' : 'failed'; });
    });
  }

  var BLOCKED = { Purchase: 1, InitiateCheckout: 1, AddPaymentInfo: 1 };   // no payments exist
  function fbqCall(kind, name, params, eventID) {
    if (!pixelOn || !trackingAllowed() || BLOCKED[name] || !window.fbq) return false;
    try {
      var method = kind === 'custom' ? 'trackCustom' : 'track';
      if (eventID) window.fbq(method, name, params || {}, { eventID: eventID });
      else window.fbq(method, name, params || {});
      return true;
    } catch (e) { return false; }
  }

  /** Page-bound standard event (e.g. ViewContent). Returns 'handed' | 'queued' | 'skipped'. */
  MUQ.track = function (name, params, opts) {
    if (!fbqCall('standard', name, params, opts && opts.eventID)) return 'skipped';
    return pixelLibReady() ? 'handed' : 'queued';
  };
  MUQ.trackCustom = function (name, params) {
    if (!fbqCall('custom', name, params)) return 'skipped';
    return pixelLibReady() ? 'handed' : 'queued';
  };

  /* ---------- Reliable action events (survive navigation, never duplicated) ---------- */
  var PENDING_KEY = 'muq_pending_events';
  function readPending() { try { return JSON.parse(sget(PENDING_KEY) || '[]'); } catch (e) { return []; } }
  function writePending(list) { try { list.length ? sset(PENDING_KEY, JSON.stringify(list)) : window.sessionStorage.removeItem(PENDING_KEY); } catch (e) {} }
  function newEventId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  var leaving = false;   // set when this page is about to navigate away (same-tab click)

  /**
   * MUQ.trackAction({ meta: {kind, name, params}, clarity: 'event_name', onceKey, defer })
   *  - onceKey: sessionStorage key — the action is recorded at most once per tab session
   *  - defer=true: the page is navigating away → save as "pending" for the next page
   *  - defer=false: the page stays → hand/queue to the SDKs on this page now
   * Returns { meta: 'pending'|'handed'|'queued'|'skipped'|'duplicate', clarity: ... }
   */
  MUQ.trackAction = function (o) {
    var res = { meta: 'skipped', clarity: 'skipped' };
    if (!trackingAllowed()) return res;
    var key = 'muq_once_' + o.onceKey;
    if (sget(key)) return { meta: 'duplicate', clarity: 'duplicate' };
    var wantMeta = !!(o.meta && pixelOn && !BLOCKED[o.meta.name]);
    var wantClarity = !!(o.clarity && clarityOn);
    if (!wantMeta && !wantClarity) return res;
    sset(key, '1');
    var item = { meta: wantMeta ? { kind: o.meta.kind, name: o.meta.name, params: o.meta.params, eventID: newEventId() } : null,
                 clarity: wantClarity ? o.clarity : null };
    if (o.defer) {
      // The page is navigating away. Each channel whose library is ALREADY loaded fires right now,
      // from this page (before the navigation, Event URL = this page). Only a channel whose library
      // is not loaded yet is kept as "pending" for the next page — a stub queue would die with this page.
      var now = { meta: item.meta && pixelLibReady() ? item.meta : null,
                  clarity: item.clarity && clarityState === 'loaded' ? item.clarity : null };
      var later = { meta: item.meta && !now.meta ? item.meta : null,
                    clarity: item.clarity && !now.clarity ? item.clarity : null };
      var out = { meta: 'skipped', clarity: 'skipped' };
      if (now.meta || now.clarity) {
        var d = deliver(now);
        if (now.meta) out.meta = d.meta;
        if (now.clarity) out.clarity = d.clarity;
      }
      if (later.meta || later.clarity) {
        var list = readPending(); list.push(later); writePending(list);
        if (later.meta) out.meta = 'pending';
        if (later.clarity) out.clarity = 'pending';
      }
      return out;
    }
    return deliver(item);
  };
  function deliver(item) {
    var r = { meta: 'skipped', clarity: 'skipped' };
    if (item.meta && fbqCall(item.meta.kind, item.meta.name, item.meta.params, item.meta.eventID)) {
      r.meta = pixelLibReady() ? 'handed' : 'queued';
    }
    if (item.clarity && clarityOn && typeof window.clarity === 'function' && trackingAllowed()) {
      try { window.clarity('event', item.clarity); r.clarity = 'queued'; } catch (e) {}
    }
    return r;
  }
  /** Move pending actions into this page's SDKs (called on every page that stays open). */
  function flushPending() {
    if (leaving || !trackingAllowed()) return 0;
    var list = readPending();
    if (!list.length) return 0;
    writePending([]);                                  // remove first → no double send
    list.forEach(deliver);
    // Load the SDKs as soon as this page's own load finishes (not later on idle) to shorten the
    // loss window — but not before `load`: an async script injected during parsing holds back
    // the page's load event, so a slow Meta/Clarity CDN would keep the tab "loading".
    if (document.readyState === 'complete') runDeferred();
    else window.addEventListener('load', runDeferred, { once: true });
    return list.length;
  }
  MUQ.markLeaving = function () { leaving = true; };
  window.addEventListener('pageshow', function (ev) {  // back/forward cache: page is alive again
    if (ev.persisted) { leaving = false; flushPending(); }
  });

  /** Debug/QA snapshot (no personal data) — e.g. MUQ.trackingState() in the console */
  MUQ.trackingState = function () {
    return {
      optedOut: !trackingAllowed(),
      pixel: pixelOn ? (pixelLibReady() ? 'ready' : pixelState) : 'off',
      pixelStubQueue: window.fbq && window.fbq.queue ? window.fbq.queue.length : null,
      clarity: clarityState,
      pending: readPending().map(function (i) { return [i.meta && i.meta.name, i.clarity].filter(Boolean).join('+'); }),
    };
  };

  /* ---------- Opt-out (privacy page) ---------- */
  MUQ.adsOptedOut = function () { return !trackingAllowed(); };
  MUQ.setAdsOptOut = function (on) {
    try {
      if (on) window.localStorage.setItem(OPTOUT_KEY, '1');
      else window.localStorage.removeItem(OPTOUT_KEY);
    } catch (e) {}
    optOutNow = !!on;
    if (!on) return;   // re-enabling takes effect from the next page load
    deferred = [];                 // SDKs not injected yet → never injected
    writePending([]);              // nothing pending is sent later
    if (window.fbq) {
      try {
        if (pixelLibReady()) {
          window.fbq('consent', 'revoke');            // loaded: Meta stops sending further events
        } else if (window.fbq.queue) {
          window.fbq.queue.length = 0;                // stub: drop everything still queued…
          window.fbq.queue.push(['consent', 'revoke']); // …and revoke in case the library still arrives
        }
      } catch (e) {}
    }
    if (typeof window.clarity === 'function') {
      try {
        if (window.clarity.q) window.clarity.q.length = 0;               // stub: drop queued calls
        window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
        window.clarity('consent', false);                                 // legacy: clear cookies
      } catch (e) {}
    }
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
    loadClarity();
    flushPending();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Stubs must exist before page scripts call MUQ.track / MUQ.trackAction
  loadPixel();
  loadClarity();
})();
