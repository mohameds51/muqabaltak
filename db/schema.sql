-- =========================================================
-- مقابلتك — جدول تسجيلات الاهتمام (Waitlist)
-- شغّل هذا الملف مرة واحدة على قاعدة Postgres (Neon عبر Vercel Marketplace)
-- =========================================================

CREATE TABLE IF NOT EXISTS signups (
  id                  BIGSERIAL PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- بيانات التسجيل (الحد الأدنى اللازم فقط)
  first_name          TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 2 AND 40),
  email               TEXT NOT NULL CHECK (char_length(email) <= 254),
  whatsapp            TEXT CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[0-9]{8,15}$'),

  -- الموافقات (منفصلة)
  consent_processing  BOOLEAN NOT NULL CHECK (consent_processing = TRUE),
  consent_marketing   BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version     TEXT NOT NULL,

  -- مصدر الحملة (عند توفره)
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,
  utm_term            TEXT,
  fbclid              TEXT,

  -- لمكافحة التسجيلات الآلية فقط: بصمة IP مُجزّأة (HMAC) وليست عنوان IP الفعلي
  ip_hash             TEXT
);

-- منع تكرار البريد الإلكتروني (بدون حساسية لحالة الأحرف)
CREATE UNIQUE INDEX IF NOT EXISTS signups_email_unique ON signups (lower(email));

-- لتسريع فحص معدل الطلبات
CREATE INDEX IF NOT EXISTS signups_ip_recent ON signups (ip_hash, created_at);
