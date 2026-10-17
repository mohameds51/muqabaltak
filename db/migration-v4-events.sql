-- =========================================================
-- مقابلتك — V4 final: جدول القياس الداخلي (بدون بيانات شخصية)
-- شغّله في Neon → SQL Editor. آمن لإعادة التشغيل (لا يحذف بيانات). لا يمس جدول signups.
-- =========================================================

CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  type          TEXT NOT NULL CHECK (type IN ('view_home','view_checkout','cta_click','lead')),
  cta           TEXT CHECK (cta IS NULL OR cta IN ('header','hero','coach','tools','bonuses','offer','final','sticky')),
  -- مستوى الحملة فقط (لا fbclid، لا IP، لا معرّف زائر)
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT
);
CREATE INDEX IF NOT EXISTS events_created ON events (created_at);
CREATE INDEX IF NOT EXISTS events_campaign ON events (utm_campaign, created_at);

-- ---------------------------------------------------------
-- مؤشرات يومية لكل حملة (التاريخ بتوقيت الرياض)
--   visits          = جلسات زارت الصفحة الرئيسية
--   intent_clicks   = جلسات ضغطت زر شراء (مرة لكل جلسة)
--   checkout_views  = جلسات وصلت لصفحة التسجيل
--   leads           = تسجيلات ناجحة محفوظة فعليًا
-- ---------------------------------------------------------
CREATE OR REPLACE VIEW campaign_daily_metrics AS
SELECT
  (created_at AT TIME ZONE 'Asia/Riyadh')::date              AS day,
  COALESCE(utm_campaign, '(بدون حملة)')                      AS campaign,
  count(*) FILTER (WHERE type = 'view_home')                 AS visits,
  count(*) FILTER (WHERE type = 'cta_click')                 AS intent_clicks,
  count(*) FILTER (WHERE type = 'view_checkout')             AS checkout_views,
  count(*) FILTER (WHERE type = 'lead')                      AS leads,
  round(100.0 * count(*) FILTER (WHERE type = 'cta_click')
        / NULLIF(count(*) FILTER (WHERE type = 'view_home'), 0), 1)  AS intent_rate_pct,
  round(100.0 * count(*) FILTER (WHERE type = 'lead')
        / NULLIF(count(*) FILTER (WHERE type = 'cta_click'), 0), 1)  AS lead_rate_of_clicks_pct,
  -- (مضاف في آخر العرض حتى يعمل CREATE OR REPLACE على قاعدة شغّلت النسخة السابقة)
  round(100.0 * count(*) FILTER (WHERE type = 'lead')
        / NULLIF(count(*) FILTER (WHERE type = 'view_home'), 0), 1)  AS visit_to_lead_pct
FROM events
GROUP BY 1, 2;

-- أي زر يضغطه الناس أكثر
CREATE OR REPLACE VIEW cta_breakdown AS
SELECT COALESCE(utm_campaign, '(بدون حملة)') AS campaign, cta, count(*) AS clicks
FROM events WHERE type = 'cta_click'
GROUP BY 1, 2;
