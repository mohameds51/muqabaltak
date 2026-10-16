/* =========================================================
   مقابلتك — common.js (كل الصفحات)
   - حفظ بيانات الحملة (UTM / fbclid) خلال الجلسة
   - موافقة ملفات تعريف الارتباط
   - تحميل Meta Pixel مرة واحدة فقط وبعد الموافقة
   - تعبئة بيانات التواصل من config.js
   يتطلب تحميل config.js قبله.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.MUQ_CONFIG || {};
  var PIXEL_ID = String(CFG.META_PIXEL_ID || '').trim();
  var PIXEL_ENABLED = /^\d{10,20}$/.test(PIXEL_ID); // يتجاهل أي قيمة غير صالحة
  var CONSENT_KEY = 'muq_cookie_consent';             // 'granted' | 'denied'
  var ATTR_KEY = 'muq_attribution';
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

  var MUQ = (window.MUQ = window.MUQ || {});
  var pending = [];            // أحداث تنتظر الموافقة (مرة واحدة لكل اسم)
  var pixelLoaded = false;

  /* ---------- Safe storage ---------- */
  function sget(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function sset(store, k, v) { try { window[store].setItem(k, v); } catch (e) {} }

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
  // الرابط الحالي له الأولوية؛ وإلا آخر قيم محفوظة في نفس الجلسة
  var fromUrl = readUrlAttr();
  if (fromUrl) sset('sessionStorage', ATTR_KEY, JSON.stringify(fromUrl));
  MUQ.getAttribution = function () {
    if (fromUrl) return fromUrl;
    try { return JSON.parse(sget('sessionStorage', ATTR_KEY) || 'null') || {}; } catch (e) { return {}; }
  };
  // يضيف UTM/fbclid إلى رابط داخلي (لا يرسل أي بيانات شخصية)
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
     2) META PIXEL — loaded once, only with consent
     ========================================================= */
  function loadPixel() {
    if (pixelLoaded || !PIXEL_ENABLED) return;
    pixelLoaded = true;
    if (!window.fbq) {
      /* Official Meta Pixel base code (unchanged logic) */
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v;
        t.onerror = function () { MUQ.pixelBlocked = true; };   // حجب من المتصفح/إضافة
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }
    try {
      window.fbq('consent', 'grant');
      window.fbq('init', PIXEL_ID);
      window.fbq('track', 'PageView');
    } catch (e) {}
    var q = pending; pending = [];
    q.forEach(function (ev) { fire(ev.name, ev.params, ev.opts); });
  }

  function fire(name, params, opts) {
    try {
      if (opts && opts.eventID) window.fbq('track', name, params || {}, { eventID: opts.eventID });
      else window.fbq('track', name, params || {});
      return true;
    } catch (e) { return false; }
  }

  /**
   * MUQ.track(name, params, opts)
   * يرجع true إذا أُرسل الحدث الآن.
   * opts.queue = true → إذا كانت الموافقة لم تُحسم بعد، يُرسل مرة واحدة عند الموافقة.
   */
  MUQ.track = function (name, params, opts) {
    if (name === 'Purchase') return false;                      // ممنوع في هذه المرحلة
    if (!PIXEL_ENABLED) return false;
    if (pixelLoaded && window.fbq) return fire(name, params, opts);
    if (opts && opts.queue && consentState() === null) {
      if (!pending.some(function (e) { return e.name === name; })) pending.push({ name: name, params: params, opts: opts });
    }
    return false;
  };
  MUQ.pixelActive = function () { return PIXEL_ENABLED && pixelLoaded && !!window.fbq; };

  /* =========================================================
     3) COOKIE CONSENT
     ========================================================= */
  function consentState() {
    if (!PIXEL_ENABLED) return 'n/a';
    if (CFG.REQUIRE_COOKIE_CONSENT === false) return 'granted';
    var v = sget('localStorage', CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  }

  function buildBanner() {
    var el = document.createElement('div');
    el.className = 'consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'إعدادات ملفات تعريف الارتباط');
    el.innerHTML =
      '<p>نستخدم ملفات تعريف الارتباط وأداة <span dir="ltr">Meta Pixel</span> لقياس أداء إعلاناتنا وتحسينها، ولا نفعّلها إلا بموافقتك. ' +
      '<a href="privacy.html#cookies">التفاصيل في سياسة الخصوصية</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-consent="granted">موافق</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-consent="denied">رفض</button>' +
      '</div>';
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-consent]');
      if (!b) return;
      setConsent(b.getAttribute('data-consent'));
    });
    return el;
  }
  var banner = null;
  function showBanner() {
    if (!banner) { banner = buildBanner(); document.body.appendChild(banner); }
    banner.hidden = false;
    document.body.classList.add('consent-open');
  }
  function hideBanner() {
    if (banner) banner.hidden = true;
    document.body.classList.remove('consent-open');
  }
  function setConsent(v) {
    sset('localStorage', CONSENT_KEY, v);
    hideBanner();
    if (v === 'granted') loadPixel();
    else {
      pending = [];
      if (pixelLoaded && window.fbq) { try { window.fbq('consent', 'revoke'); } catch (e) {} }
    }
  }
  // لإعادة فتح الاختيار (رابط في الفوتر)
  MUQ.openConsent = function () { if (PIXEL_ENABLED) showBanner(); };

  /* =========================================================
     4) SITE HELPERS — contact data, owner name, draft banner, year
     ========================================================= */
  function fillSite() {
    var email = String(CFG.CONTACT_EMAIL || '').trim();
    var wa = String(CFG.CONTACT_WHATSAPP || '').replace(/\s/g, '');
    var owner = String(CFG.OWNER_NAME || '').trim();

    function missing(el, label) {
      el.textContent = '[بانتظار الإضافة: ' + label + ']';
      el.classList.add('missing');
    }
    document.querySelectorAll('[data-contact="email"]').forEach(function (el) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        var a = document.createElement('a'); a.href = 'mailto:' + email; a.textContent = email; a.dir = 'ltr';
        el.textContent = ''; el.appendChild(a);
      } else missing(el, 'البريد الإلكتروني الرسمي');
    });
    document.querySelectorAll('[data-contact="whatsapp"]').forEach(function (el) {
      if (/^\+\d{8,15}$/.test(wa)) {
        var a = document.createElement('a'); a.href = 'https://wa.me/' + wa.slice(1); a.textContent = wa; a.dir = 'ltr';
        a.rel = 'noopener'; a.target = '_blank';
        el.textContent = ''; el.appendChild(a);
      } else missing(el, 'رقم واتساب الرسمي');
    });
    document.querySelectorAll('[data-owner]').forEach(function (el) {
      if (owner) el.textContent = owner; else missing(el, 'اسم صاحب المشروع أو المؤسسة');
    });
    document.querySelectorAll('[data-legal-draft]').forEach(function (el) { el.hidden = CFG.LEGAL_DRAFT === false; });
    document.querySelectorAll('[data-consent-open]').forEach(function (el) {
      if (!PIXEL_ENABLED) { el.hidden = true; return; }
      el.addEventListener('click', function (e) { e.preventDefault(); MUQ.openConsent(); });
    });
    var y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
  }

  /* ---------- Init ---------- */
  function init() {
    fillSite();
    var s = consentState();
    if (s === 'granted') loadPixel();
    else if (s === null) showBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
