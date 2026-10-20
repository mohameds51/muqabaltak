// =========================================================
// مقابلتك — يضمّن styles.css (مضغوطًا) داخل index.html
// السبب: إزالة طلب CSS الذي يوقف عرض الصفحة الرئيسية (أسرع FCP/LCP).
//
// متى تشغّله؟ بعد أي تعديل على styles.css:
//     node tools/inline-css.mjs
// للتحقق فقط بدون تعديل:
//     node tools/inline-css.mjs --check
// ثم ارفع index.html المحدّث. (الصفحات الأخرى تستخدم styles.css مباشرة.)
// لا يحتاج أي مكتبات.
// =========================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(root, 'styles.css'), 'utf8');

const min = css
  .replace(/\/\*[\s\S]*?\*\//g, '')        // comments
  .replace(/\s+/g, ' ')                     // collapse whitespace
  .replace(/\s*([{};,>])\s*/g, '$1')        // spaces around punctuation (not ':' — keeps selectors safe)
  .replace(/;}/g, '}')
  .trim();

const START = '<style id="inline-css">';
const END = '</style><!-- /inline-css -->';
const file = path.join(root, 'index.html');
let html = readFileSync(file, 'utf8');
const i = html.indexOf(START), j = html.indexOf(END);
if (i < 0 || j < 0) throw new Error('inline-css markers not found in index.html');
// --check: verify only (exit 1 if index.html is out of date) — no file is written
if (process.argv.includes('--check')) {
  const current = html.slice(i + START.length, j);
  if (current === min) { console.log('OK: inline CSS in index.html matches styles.css'); process.exit(0); }
  console.error('OUT OF DATE: run  node tools/inline-css.mjs'); process.exit(1);
}
html = html.slice(0, i + START.length) + min + html.slice(j);
writeFileSync(file, html);
console.log(`inlined styles.css → index.html (${(min.length / 1024).toFixed(1)} KB minified, from ${(css.length / 1024).toFixed(1)} KB)`);
