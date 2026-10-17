// =========================================================
// مقابلتك — GET /api/cron/purge
// يحذف تسجيلات الاهتمام الأقدم من مدة الاحتفاظ (الافتراضي 90 يومًا).
// جدول events لا يحتوي بيانات شخصية ولا يُحذف هنا.
//
// يستدعيه Vercel Cron يوميًا (انظر vercel.json). على خطة Hobby:
// مرة واحدة يوميًا كحد أقصى، وفي أي دقيقة داخل الساعة المحددة،
// والتسليم «best effort» (قد يفوت أو يتكرر) — لذلك الحذف هنا
// مبني على المقارنة بالتاريخ: كل تشغيل يحذف كل ما تجاوز المدة،
// فيعوّض أي تشغيل فائت، وتكراره لا يضر.
//
// متغيرات البيئة:
//   DATABASE_URL     (موجود مسبقًا)
//   CRON_SECRET      نص عشوائي ≥ 16 حرف. Vercel يرسله تلقائيًا في
//                    Authorization: Bearer <CRON_SECRET>
//   RETENTION_DAYS   اختياري — الافتراضي 90
//
// السجلات (Logs): عدد الصفوف المحذوفة فقط — بدون أي بيانات شخصية.
// =========================================================

import pg from 'pg';
import crypto from 'node:crypto';

const DEFAULT_RETENTION_DAYS = 90;

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1|host=\/|@\/|%2Ftmp/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 5_000,
      ssl: local ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Constant-time comparison of the Authorization header
function authorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return false;                 // fail closed if not configured
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function retentionDays() {
  const n = parseInt(process.env.RETENTION_DAYS || '', 10);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_RETENTION_DAYS;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { ok: false });
  }
  if (!authorized(req)) return send(res, 401, { ok: false });

  const days = retentionDays();
  try {
    // RETURNING 1 (not the data) — we only need the count
    const r = await getPool().query(
      `DELETE FROM signups
        WHERE created_at < now() - make_interval(days => $1::int)
       RETURNING 1 AS x`,
      [days]
    );
    console.log(`[purge] retention=${days}d deleted=${r.rowCount}`);
    return send(res, 200, { ok: true, retention_days: days, deleted: r.rowCount });
  } catch (err) {
    console.error('[purge] failed:', err.code || 'error');   // no message: may contain values
    return send(res, 500, { ok: false });
  }
}
