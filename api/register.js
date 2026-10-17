// =========================================================
// مقابلتك — POST /api/register
// Vercel Serverless Function (Node.js) — يحفظ تسجيل الاهتمام في Postgres.
//
// متغيرات البيئة المطلوبة (Vercel → Settings → Environment Variables):
//   DATABASE_URL   رابط Postgres (يُضاف تلقائيًا عند ربط Neon من Vercel Marketplace)
//   IP_HASH_SALT   نص عشوائي طويل — لتجزئة عنوان IP لأغراض مكافحة السبام فقط
//
// الاستجابات:
//   201 { ok:true, id }                تسجيل جديد محفوظ فعليًا
//   409 { ok:false, code:'duplicate' } البريد مسجل مسبقًا
//   400 { ok:false, code:'invalid', errors:{field:msg} }
//   429 { ok:false, code:'rate_limited' }
//   500/503 { ok:false, code:'server_error' }
// =========================================================

import pg from 'pg';
import crypto from 'node:crypto';

// نسخة إشعار الخصوصية الظاهر بجوار زر الإرسال في checkout.html.
// غيّرها إذا عدّلت نص الإشعار أو سياسة الخصوصية.
// consent_processing = TRUE يعني: أُرسل النموذج بعد عرض هذا الإشعار (لا توجد خانة اختيار).
const CONSENT_VERSION = 'notice-2026-10-16';

// حدود مكافحة السبام
const MIN_FILL_MS = 2500;            // أقل وقت معقول لتعبئة النموذج
const MAX_SIGNUPS_PER_IP_HOUR = 5;   // تسجيلات ناجحة من نفس الجهاز/الشبكة خلال ساعة
const MAX_REQUESTS_PER_IP_MIN = 10;  // كل الطلبات (حتى الفاشلة) لكل نسخة من الدالة

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

// Pool واحد لكل نسخة من الدالة (يُعاد استخدامه بين الطلبات)
let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1|host=\/|@\/|%2Ftmp/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: local ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

// ---------- In-memory throttle (أساسي — لكل نسخة من الدالة) ----------
const hits = new Map();
function throttled(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > MAX_REQUESTS_PER_IP_MIN;
}

// ---------- Helpers ----------
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel يحلل JSON تلقائيًا
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('payload too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || '';
  return crypto.createHmac('sha256', salt || 'muqabaltak').update(ip).digest('hex').slice(0, 32);
}

const str = (v) => (typeof v === 'string' ? v : '');
// إزالة محارف التحكم والمسافات الزائدة
const clean = (v, max) => str(v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{1,39}$/u;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_CODES = ['966', '20', '971', '965', '973', '974', '968', '962', '212', '216', '213', '964', '963', '961', '970', '249', '218', '967', '1', '44'];

function validate(body) {
  const errors = {};

  const firstName = clean(body.first_name, 60);
  if (!firstName) errors.first_name = 'الاسم الأول مطلوب.';
  else if (!NAME_RE.test(firstName)) errors.first_name = 'اكتب اسمك الأول بحروف فقط (2–40 حرف).';

  const email = clean(body.email, 300).toLowerCase();
  if (!email) errors.email = 'البريد الإلكتروني مطلوب.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'تأكد من كتابة البريد الإلكتروني بشكل صحيح.';

  // واتساب اختياري: مفتاح دولة + رقم محلي → E.164
  let whatsapp = null;
  const localRaw = str(body.whatsapp_number).replace(/[\s\-()]/g, '');
  if (localRaw) {
    const code = str(body.whatsapp_code).replace(/\D/g, '');
    let local = localRaw.replace(/^\+/, '').replace(/\D/g, '');
    if (!ALLOWED_CODES.includes(code)) errors.whatsapp_number = 'اختر مفتاح الدولة.';
    else {
      if (local.startsWith(code) && local.length > 9) local = local.slice(code.length); // كتب المفتاح داخل الرقم
      local = local.replace(/^0+/, '');
      if (!/^\d{6,12}$/.test(local)) errors.whatsapp_number = 'رقم الواتساب غير صحيح.';
      else if (code === '966' && !/^5\d{8}$/.test(local)) errors.whatsapp_number = 'رقم الجوال السعودي يبدأ بـ 5 ويتكون من 9 أرقام (مثال: 5XXXXXXXX).';
      else whatsapp = `+${code}${local}`;
    }
  }

  // The form shows a privacy notice next to the submit button (no checkbox). The client sends notice_ack:true.
  if (body.notice_ack !== true && body.consent_processing !== true) errors.form = 'طلب غير صالح.';
  const consentMarketing = false;   // no marketing opt-in is collected in this version

  const utm = {};
  const src = body.attribution && typeof body.attribution === 'object' ? body.attribution : {};
  for (const k of UTM_KEYS) {
    const v = clean(src[k], k === 'fbclid' ? 500 : 150);
    utm[k] = v && /^[\w\-.~%+:|/ ]+$/u.test(v) ? v : null;
  }

  return { errors, data: { firstName, email, whatsapp, consentMarketing, utm } };
}

// =========================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  const ip = clientIp(req);
  const ipHash = hashIp(ip);
  if (throttled(ipHash)) return send(res, 429, { ok: false, code: 'rate_limited' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { ok: false, code: 'invalid', errors: { form: 'طلب غير صالح.' } });
  }

  // Honeypot: حقل مخفي يتركه الإنسان فارغًا
  if (str(body.company).trim() !== '') {
    // نرد بنجاح شكلي حتى لا يتعلم الروبوت — ولا نحفظ شيئًا (الواجهة لا تطلق Lead إلا مع id رقمي)
    return send(res, 200, { ok: false, code: 'ignored' });
  }
  // وقت التعبئة
  const elapsed = Number(body.elapsed_ms);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
    return send(res, 400, { ok: false, code: 'too_fast', errors: { form: 'حصل خطأ بسيط، حاول مرة ثانية بعد ثوانٍ.' } });
  }

  const { errors, data } = validate(body);
  if (Object.keys(errors).length) return send(res, 400, { ok: false, code: 'invalid', errors });

  try {
    const db = getPool();

    const recent = await db.query(
      `SELECT count(*)::int AS n FROM signups WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`,
      [ipHash]
    );
    if (recent.rows[0].n >= MAX_SIGNUPS_PER_IP_HOUR) return send(res, 429, { ok: false, code: 'rate_limited' });

    const r = await db.query(
      `INSERT INTO signups
         (first_name, email, whatsapp, consent_processing, consent_marketing, consent_version,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ip_hash)
       VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT ((lower(email))) DO NOTHING
       RETURNING id`,
      [
        data.firstName, data.email, data.whatsapp, data.consentMarketing, CONSENT_VERSION,
        data.utm.utm_source, data.utm.utm_medium, data.utm.utm_campaign, data.utm.utm_content,
        data.utm.utm_term, data.utm.fbclid, ipHash,
      ]
    );

    if (r.rowCount === 0) return send(res, 409, { ok: false, code: 'duplicate' });

    // Anonymous first-party lead count (campaign level only — survives the 90-day purge of signups).
    // Non-fatal: the registration is already saved.
    try {
      await db.query(
        `INSERT INTO events (type, utm_source, utm_medium, utm_campaign, utm_content) VALUES ('lead', $1, $2, $3, $4) RETURNING id`,
        [data.utm.utm_source, data.utm.utm_medium, data.utm.utm_campaign, data.utm.utm_content]
      );
    } catch (e) { console.error('[register] lead count failed:', e.code || 'error'); }

    return send(res, 201, { ok: true, id: String(r.rows[0].id) });
  } catch (err) {
    console.error('[register] db error:', err.code || 'error');   // no message/values in logs
    return send(res, 503, { ok: false, code: 'server_error' });
  }
}
