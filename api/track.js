// =========================================================
// مقابلتك — POST /api/track
// قياس داخلي بدون ملفات ارتباط: يسجّل عدّادًا مجمّعًا فقط.
// المحفوظ: نوع الحدث + موضع الزر + اسم الحملة (UTM).
// غير محفوظ: IP، معرّف زائر، fbclid، أي بيانات شخصية.
// =========================================================

import pg from 'pg';
import crypto from 'node:crypto';

const TYPES = new Set(['view_home', 'view_checkout', 'cta_click']);   // 'lead' is written only by /api/register
const CTAS = new Set(['header', 'hero', 'coach', 'tools', 'bonuses', 'offer', 'final', 'sticky']);
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebot|preview|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i;
const MAX_PER_MIN = 30;

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1|host=\/|@\/|%2Ftmp/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
      ssl: local ? false : { rejectUnauthorized: true } });
  }
  return pool;
}

// In-memory throttle (per function instance). The key is a short-lived hash, never stored.
const hits = new Map();
function throttled(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const key = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > MAX_PER_MIN;
}

const clean = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s && /^[\w\-.~%+:|/ ]+$/u.test(s) ? s : null;
};

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2_000) throw new Error('too large'); }
  return raw ? JSON.parse(raw) : {};
}

function done(res, status) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return done(res, 405); }
  if (BOT_UA.test(String(req.headers['user-agent'] || ''))) return done(res, 204);   // ignore bots silently
  if (throttled(req)) return done(res, 429);

  let b;
  try { b = await readJson(req); } catch { return done(res, 400); }
  const type = typeof b.type === 'string' ? b.type : '';
  if (!TYPES.has(type)) return done(res, 400);
  const cta = type === 'cta_click' && CTAS.has(b.cta) ? b.cta : null;
  if (type === 'cta_click' && !cta) return done(res, 400);

  try {
    await getPool().query(
      `INSERT INTO events (type, cta, utm_source, utm_medium, utm_campaign, utm_content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [type, cta, clean(b.utm_source, 150), clean(b.utm_medium, 150), clean(b.utm_campaign, 150), clean(b.utm_content, 150)]
    );
    return done(res, 204);
  } catch (err) {
    console.error('[track] db error:', err.code || 'error');
    return done(res, 503);
  }
}
