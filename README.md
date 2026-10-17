# مقابلتك — V4 Final

صفحة بيع + صفحة تسجيل اهتمام مجاني + حفظ في Neon + Meta Pixel (4 أحداث) + قياس داخلي للمقارنة + حذف تلقائي بعد 90 يومًا.
**لا يوجد أي دفع**، ولا نافذة موافقة.

---

## 1) الملفات

| الملف | الوظيفة |
|---|---|
| `index.html` `styles.css` `script.js` | صفحة البيع: 8 أزرار شراء، كل زر له `data-cta="<الموضع>"` |
| `checkout.html` `checkout.js` `pages.css` | صفحة التسجيل: إفصاح قبل الحقول، ثم الاسم والبريد وواتساب اختياري |
| `privacy.html` `terms.html` `refund.html` `contact.html` | الصفحات القانونية |
| `config.js` | Pixel ID + مفتاح التشغيل `META_PIXEL_ENABLED` (حاليًا `true`) |
| `common.js` | تمرير UTM، والعدّادات الداخلية، وتحميل Pixel مرة واحدة، ومنع تكرار الأحداث، وإيقاف التتبع |
| `api/register.js` | حفظ التسجيل + احتساب Lead مجهول الهوية |
| `api/track.js` | **جديد:** عدّادات الزيارات والضغطات |
| `api/cron/purge.js` | حذف التسجيلات الأقدم من 90 يومًا |
| `db/migration-v4-events.sql` | **جديد:** جدول `events` والعروض (Views) الخاصة بالمؤشرات |
| `vercel.json` | جدولة Cron اليومية + ترويسات أمان |

---

## 2) خطوات Neon (مرة واحدة)

افتح **Neon Console → SQL Editor**، والصق محتوى `db/migration-v4-events.sql` وشغّله.
الملف ينشئ جدول `events` وعرضين: `campaign_daily_metrics` و`cta_breakdown`.
**لا يغيّر جدول `signups`**، ولا ينشئ قاعدة جديدة.

## 3) خطوات Vercel

1. **Settings → Environment Variables → Production:**

   | المتغير | الحالة |
   |---|---|
   | `DATABASE_URL` | موجود — لا تغيّره |
   | `IP_HASH_SALT` | موجود — لا تغيّره |
   | `CRON_SECRET` | **أضفه إذا لم تضفه بعد** (16 حرفًا أو أكثر) |
   | `RETENTION_DAYS` | **ضعه `90`** (الكود يفترض 90 أصلًا، لكن المتغير الصريح أوضح) |

   لتوليد `CRON_SECRET`:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **ارفع كل الملفات، بما فيها الملفات التي تبدأ بنقطة** (`.vercelignore`، `.gitignore`، `.env.example`).
   - رفع الملفات من متصفح GitHub قد يتجاهل هذه الملفات، فتأكد أنها ظهرت في المستودع.
   - `.vercelignore` يمنع نشر `README.md` ومجلد `db/` على الموقع العام.
3. بعد النشر، افتح **Settings → Cron Jobs** وتأكد من المسار `/api/cron/purge` بجدول `0 1 * * *`.
   - المواعيد بتوقيت **UTC**، أي 04:00 بتوقيت السعودية.
   - على خطة Hobby: مرة واحدة يوميًا كحد أقصى، ويُنفَّذ في أي دقيقة بين 01:00 و01:59 UTC.
   - التنفيذ قد يفوت يومًا أو يتكرر. الكود مصمم لهذا: كل تشغيل يحذف كل ما تجاوز 90 يومًا.
4. **(اختياري، مستحسن)** **Settings → Functions → Function Region → Frankfurt (fra1)** لتكون الدوال قرب قاعدة Neon في فرانكفورت. يقلل هذا زمن الاستجابة.
   - لم أتحقق من أن خطة Hobby تسمح بتغيير المنطقة، فتأكد من لوحة التحكم.
5. اختبر الحذف يدويًا (من جهازك فقط، لأن الأمر يحتوي السر):
   ```
   curl -H "Authorization: Bearer <CRON_SECRET>" https://muqabaltak.smartpdf.shop/api/cron/purge
   ```
   - المتوقع: `{"ok":true,"retention_days":90,"deleted":N}`.
   - بدون السر يجب أن يرجع `401`.

---

## 4) Meta Pixel — مفعّل

| الحدث | النوع | متى | منع التكرار | القيم |
|---|---|---|---|---|
| `PageView` | قياسي | تحميل أي صفحة | مرة لكل تحميل صفحة | — |
| `ViewContent` | قياسي | تحميل صفحة البيع (مشاهدة العرض) | مرة لكل تحميل صفحة | `Muqabaltak` / `product` / `49` / `SAR` |
| `PurchaseIntent` | **مخصص** (`trackCustom`) | ضغطة حقيقية (`isTrusted`) على أي زر من الأزرار الثمانية | **مرة لكل جلسة تبويب** + منع الضغط المزدوج | `Muqabaltak` / `SAR` / `49` |
| `Lead` | قياسي | فقط بعد `201` و`ok:true` و`id` رقمي من الخادم | مرة لكل تسجيل | `Muqabaltak` / `49` / `SAR` + `eventID` عشوائي |
| `Purchase` / `InitiateCheckout` | — | **ممنوعة في الكود** | — | — |

- لا يُرسل الاسم أو البريد أو الواتساب أو رقم التسجيل في أي حدث.
- `fbq('set','autoConfig',false)` يمنع Meta من إنشاء أحداث تلقائية من ضغطات الأزرار.
- لا توجد نافذة موافقة. في سياسة الخصوصية (البند 8) زر «إيقاف التتبع الإعلاني» لمن يريد. لا يظهر للزائر إلا إذا فتح الصفحة.
- لإيقاف Pixel بالكامل: في `config.js` غيّر السطر إلى `META_PIXEL_ENABLED: false`. القياس الداخلي يستمر.

### إعدادات مطلوبة في Meta Events Manager قبل الحملة
1. **Settings → Automatic advanced matching → OFF.** إذا كان مفعّلًا، تقرأ Meta حقول النموذج (البريد والاسم) تلقائيًا، وهذا يخالف سياستنا. هذا الإعداد لا يُتحكم فيه من الكود.
2. **Settings → Automatic events** (تتبع الضغطات التلقائي): أوقفه أيضًا. الكود يعطّله، لكن الأفضل إيقافه من الإعدادات.
3. **التحقق من النطاق:** Business Settings → Brand safety → Domains → أضف `smartpdf.shop` وتحقق منه.
4. **PurchaseIntent حدث مخصص.** لاستخدامه في تحسين الحملة أو قياسها كتحويل، أنشئ **Custom Conversion**:
   - من Events Manager → Custom conversions → Create.
   - المصدر: Pixel 1492693392907625.
   - الحدث: `PurchaseIntent`.
   - القيمة: 49 SAR.
5. **اختيار هدف الحملة بميزانية 100$:**
   - التحسين على `Lead` يحتاج عادةً عشرات التحويلات حتى يتعلم الخوارزم.
   - ابدأ بهدف **Traffic → Landing page views**، أو **Engagement/Conversions على PurchaseIntent** (بعد إنشاء الـCustom Conversion).
   - اقرأ `Lead` كنتيجة، لا كهدف تحسين.

### الاختبار عبر Test Events
1. Events Manager → Pixel 1492693392907625 → **Test Events**.
2. أدخل `https://muqabaltak.smartpdf.shop/?utm_campaign=qa_test` واضغط **Open website**.
3. المتوقع بالترتيب:
   - `PageView` و`ViewContent` عند التحميل.
   - `PurchaseIntent` عند ضغط زر. الضغطة الثانية في نفس التبويب لا تكرره.
   - `PageView` لصفحة التسجيل. لا يظهر `InitiateCheckout`.
   - بيانات خاطئة: لا يظهر شيء.
   - تسجيل ناجح ببريد جديد: `Lead` مرة واحدة.
   - نفس البريد مرة ثانية: لا يظهر `Lead`.
4. افتح تفاصيل `Lead` في Test Events. يجب ألا ترى بريدًا أو اسمًا في Parameters أو Advanced matching.
5. نظّف بيانات الاختبار من Neon (القسم 7).

يمكنك أيضًا استخدام إضافة **Meta Pixel Helper** في Chrome.

## 5) القياس الداخلي (بدون ملفات ارتباط، وبدون بيانات شخصية)

| المقياس | المصدر |
|---|---|
| زيارات الصفحة الرئيسية | `view_home` — مرة لكل جلسة (تبويب) |
| ضغطات أزرار الشراء | `cta_click` — مرة لكل جلسة، مع موضع الزر |
| زيارات صفحة التسجيل | `view_checkout` |
| التسجيلات الناجحة | `lead` — يكتبها الخادم بعد الحفظ الفعلي فقط، ولا يمكن تزويرها من المتصفح |

**المحفوظ في كل حدث:**
- النوع.
- موضع الزر.
- `utm_source` و`utm_medium` و`utm_campaign` و`utm_content`.

**غير المحفوظ:** IP، ومعرّف الزائر، و`fbclid`، وأي بيانات شخصية. لذلك جدول `events` **لا يُحذف** مع التسجيلات، وتبقى الأرقام بعد 90 يومًا.

**تقرير الحملة** (ضع إنفاقك واسم الحملة في `params`):
```sql
WITH params AS (SELECT 100.0 AS spend_usd, 'اسم_الحملة'::text AS campaign),
m AS (
  SELECT sum(d.visits) v, sum(d.intent_clicks) c, sum(d.checkout_views) cv, sum(d.leads) l
  FROM campaign_daily_metrics d, params p WHERE d.campaign = p.campaign
)
SELECT v AS visits, c AS intent_clicks, cv AS checkout_views, l AS leads,
       round(100.0*c/NULLIF(v,0),1) AS intent_rate_pct,          -- نية الشراء من الزيارات
       round(100.0*l/NULLIF(c,0),1) AS lead_rate_of_clicks_pct,  -- التسجيل من ضغطات الشراء
       round(100.0*l/NULLIF(v,0),1) AS visit_to_lead_pct,        -- التحويل من الزيارة إلى التسجيل
       round(spend_usd/NULLIF(c,0),2) AS cost_per_intent_usd,    -- تكلفة PurchaseIntent
       round(spend_usd/NULLIF(l,0),2) AS cost_per_lead_usd       -- تكلفة Lead
FROM m, params;
```

**المقارنة مع Meta:**

| داخلي (Neon) | في Ads Manager |
|---|---|
| `visits` | Landing page views |
| `intent_clicks` | PurchaseIntent / الـCustom Conversion |
| `leads` | Leads |

- الأرقام الداخلية تقريبًا هي الحد الأعلى. القياس الداخلي لا يتأثر بمانعات تتبع Meta، ويعد مرة لكل جلسة.
- أرقام Meta غالبًا أقل، بسبب مانعات الإعلانات وقيود iOS.
- فرق 10–30% طبيعي. أما الفرق الأكبر من ذلك فيستحق المراجعة.

- يومي: `SELECT * FROM campaign_daily_metrics ORDER BY day DESC;`
- أي زر يعمل أكثر: `SELECT * FROM cta_breakdown ORDER BY clicks DESC;`

**حدود هذا القياس (بصراحة):**
- العدّ «مرة لكل جلسة تبويب»، وليس «زائرًا فريدًا». نفس الشخص في يومين مختلفين يُعد مرتين.
- مانعات الإعلانات قد تحجب الطلب أحيانًا، رغم أنه من نفس النطاق.
- طلبات الروبوتات المعروفة تُتجاهل. وأي روبوت يشغّل JavaScript ويتنكر كمتصفح قد يُعد.
- لا يوجد CAPTCHA على `/api/track`. يوجد حد 30 طلبًا في الدقيقة لكل IP لكل نسخة من الدالة، وهذا يكفي لاختبار بـ100 دولار، لكنه ليس حماية كاملة.
- قارن «زيارات» القياس الداخلي بـ«نقرات الرابط» في Ads Manager. الفرق الطبيعي سببه من يضغط الإعلان ويغادر قبل تحميل الصفحة.

---

## 6) نموذج التسجيل والخصوصية

- الحقول: الاسم الأول، والبريد، وواتساب اختياري. **لا توجد خانات اختيار.**
- بجوار الزر إشعار خصوصية مختصر مع رابط السياسة. يحفظ الخادم نسخة الإشعار في العمود `consent_version` بالقيمة `notice-2026-10-16`. وقيمة `consent_processing = true` تعني «أُرسل النموذج بعد عرض الإشعار».
- لا تُجمع موافقة تسويقية. القيمة `consent_marketing = false` دائمًا، فلا ترسل للمسجلين رسائل تسويقية مستقلة عن «توفر الحقيبة».
- حماية السبام كما هي:
  - حقل مخفي (Honeypot).
  - رفض الإرسال الأسرع من 2.5 ثانية.
  - حد أقصى 5 تسجيلات في الساعة لكل IP.
  - منع تكرار البريد.
  - التحقق من المدخلات في الخادم.

**الحذف المبكر عند انتهاء الغرض** (تعهد موجود في السياسة). نفّذه يدويًا بعد مراسلة الجميع بالإطلاق، أو عند قرار عدم الإطلاق:
```sql
DELETE FROM signups;                                    -- عند انتهاء الغرض للجميع
DELETE FROM signups WHERE lower(email) = lower('x@y.com');  -- طلب حذف فردي
```

---

## 7) اختبارات ما بعد النشر

1. افتح `https://muqabaltak.smartpdf.shop/?utm_campaign=qa_test` ثم اضغط أي زر.
2. يجب أن يحتوي رابط صفحة التسجيل على `utm_campaign=qa_test`.
3. سجّل ببريد اختبار، ثم شغّل في Neon:
   ```sql
   SELECT * FROM campaign_daily_metrics WHERE campaign='qa_test';
   ```
   يجب أن ترى `visits` و`intent_clicks` و`checkout_views` و`leads` بقيمة 1 لكل منها.
4. سجّل بنفس البريد مرة ثانية. يجب أن تظهر رسالة «مسجّل عندنا مسبقًا»، وألا يزيد `leads`.
5. نظّف بيانات الاختبار:
   ```sql
   DELETE FROM signups WHERE email='بريد_الاختبار';
   DELETE FROM events WHERE utm_campaign='qa_test';
   ```
6. للتأكد من أحداث Meta استخدم Test Events (القسم 4).
