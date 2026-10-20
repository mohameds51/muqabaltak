/* =========================================================
   مقابلتك — checkout.js (صفحة تسجيل الاهتمام)
   - تحقق من الحقول بالعربي (والخادم يتحقق مرة أخرى)
   - إرسال إلى /api/register
   - Lead فقط بعد استجابة 201 مؤكدة من الخادم
   - لا يوجد Purchase ولا أي بيانات دفع
   يتطلب config.js ثم common.js قبله.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.MUQ_CONFIG || {};
  var MUQ = window.MUQ || { track: function () { return false; }, getAttribution: function () { return {}; } };
  var ENDPOINT = CFG.REGISTER_ENDPOINT || '/api/register';
  var TIMEOUT_MS = 15000;
  var startedAt = Date.now();

  // First-party, cookieless page-view count (once per tab session)
  if (MUQ.count) MUQ.count('view_checkout');

  var form = document.getElementById('signupForm');
  var btn = document.getElementById('submitBtn');
  var alertBox = document.getElementById('formAlert');
  var formCard = document.getElementById('formCard');
  var successCard = document.getElementById('successCard');
  var sending = false;

  var MSG = {
    network: 'تعذّر الاتصال الآن. تأكد من الإنترنت وحاول مرة ثانية — لم يتم حفظ تسجيلك بعد.',
    server: 'حصل خطأ مؤقت عندنا ولم يتم حفظ تسجيلك. حاول مرة ثانية بعد قليل.',
    rate: 'وصلتنا محاولات كثيرة من نفس الجهاز. انتظر قليلًا ثم حاول مرة ثانية.',
    duplicate: 'بريدك مسجّل عندنا مسبقًا ✓ — بنبلغك أول ما تتوفر الحقيبة، وما تحتاج تسجّل مرة ثانية.',
    fix: 'فيه حقول تحتاج تصحيح — راجع الملاحظات تحت كل حقل.',
  };

  /* ---------- Client-side validation (mirrors the server) ---------- */
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{1,39}$/u;
  var EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

  function val(id) { return (document.getElementById(id).value || '').replace(/\s+/g, ' ').trim(); }

  function validate() {
    var e = {};
    var name = val('first_name');
    if (!name) e.first_name = 'الاسم الأول مطلوب.';
    else if (!NAME_RE.test(name)) e.first_name = 'اكتب اسمك الأول بحروف فقط (2–40 حرف).';

    var email = val('email');
    if (!email) e.email = 'البريد الإلكتروني مطلوب.';
    else if (!EMAIL_RE.test(email)) e.email = 'تأكد من كتابة البريد الإلكتروني بشكل صحيح.';

    var num = val('whatsapp_number').replace(/[\s\-()]/g, '');
    if (num) {
      var code = val('whatsapp_code');
      var local = num.replace(/^\+/, '').replace(/\D/g, '');
      if (local.indexOf(code) === 0 && local.length > 9) local = local.slice(code.length);
      local = local.replace(/^0+/, '');
      if (/[^\d+\s\-()]/.test(num) || !/^\d{6,12}$/.test(local)) e.whatsapp_number = 'رقم الواتساب غير صحيح.';
      else if (code === '966' && !/^5\d{8}$/.test(local)) e.whatsapp_number = 'رقم الجوال السعودي يبدأ بـ 5 ويتكون من 9 أرقام (مثال: 5XXXXXXXX).';
    }

    return e;
  }

  function showErrors(errors) {
    ['first_name', 'email', 'whatsapp_number'].forEach(function (k) {
      var p = document.getElementById('err-' + k);
      var input = document.getElementById(k);
      var msg = errors[k] || '';
      if (p) p.textContent = msg;
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    var first = ['first_name', 'email', 'whatsapp_number'].filter(function (k) { return errors[k]; })[0];
    if (first) document.getElementById(first).focus();
  }

  function setAlert(text, kind) {
    if (!text) { alertBox.hidden = true; alertBox.textContent = ''; return; }
    alertBox.className = 'form-alert ' + (kind || 'error');
    alertBox.textContent = text;
    alertBox.hidden = false;
  }

  function setBusy(b) {
    sending = b;
    btn.disabled = b;
    btn.classList.toggle('is-busy', b);
    btn.setAttribute('aria-busy', String(b));
  }

  // Clear a field's error as the user fixes it
  form.addEventListener('input', function (ev) {
    var id = ev.target.id === 'whatsapp_code' ? 'whatsapp_number' : ev.target.id;
    var p = document.getElementById('err-' + id);
    if (p && p.textContent) { p.textContent = ''; ev.target.setAttribute('aria-invalid', 'false'); }
  });

  /* ---------- Submit ---------- */
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (sending) return;
    setAlert('');

    var errors = validate();
    showErrors(errors);
    if (Object.keys(errors).length) { setAlert(MSG.fix); return; }

    var payload = {
      first_name: val('first_name'),
      email: val('email'),
      whatsapp_code: val('whatsapp_code'),
      whatsapp_number: val('whatsapp_number'),
      // No checkboxes: submitting the form next to the visible privacy notice is the
      // user's request to be contacted about availability. The server stores the
      // notice version. No marketing opt-in is collected.
      notice_ack: true,
      company: document.getElementById('company').value,   // honeypot
      elapsed_ms: Date.now() - startedAt,
      attribution: MUQ.getAttribution(),                     // UTM / fbclid only
    };

    setBusy(true);
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
      })
      .then(function (r) {
        clearTimeout(timer);
        setBusy(false);

        // ✅ Saved for real: 201 + ok + id from the database
        if (r.status === 201 && r.data && r.data.ok === true && /^\d+$/.test(String(r.data.id || ''))) {
          onSuccess(r.data.id);
          return;
        }
        if (r.status === 409) { setAlert(MSG.duplicate, 'info'); return; }
        if (r.status === 400 && r.data && r.data.errors) {
          showErrors(r.data.errors);
          setAlert(r.data.errors.form || MSG.fix);
          return;
        }
        if (r.status === 429) { setAlert(MSG.rate); return; }
        setAlert(MSG.server);   // 5xx, honeypot "ignored", anything unexpected → never a fake success
      })
      .catch(function () {
        clearTimeout(timer);
        setBusy(false);
        setAlert(MSG.network);
      });
  });

  function onSuccess(id) {
    // Lead — only after the server confirmed the row was saved (201 + ok + numeric id).
    // Once per registration (once-key uses the local id; the id itself is never sent anywhere).
    // The page stays open, so the event is handed/queued here; if the Meta library is not
    // loaded yet, it is queued and sent when it loads. No name/email/phone/IP/id is sent.
    try {
      if (MUQ.trackAction) {
        MUQ.trackAction({ meta: { kind: 'standard', name: 'Lead', params: { content_name: 'Muqabaltak', value: 49, currency: 'SAR' } },
                          clarity: 'lead', onceKey: 'lead_' + id, defer: false });
        if (MUQ.loadTrackingNow) MUQ.loadTrackingNow();
      }
    } catch (e) {}

    form.reset();
    formCard.hidden = true;
    successCard.hidden = false;
    successCard.focus();
    successCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

})();
