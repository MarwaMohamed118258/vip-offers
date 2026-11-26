// بينسخ الملفات المشتركة من تطبيق VIP لموقع Offers Store (store/) — بيشتغل لوحده قبل deploy الموقع
//   node tools/sync-store.mjs
// متعدّليش النسخ اللي في store/ — عدّلي الأصل وشغّلي السكريبت.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "js/core.js",
  "js/store-shared.js",
  "js/firebase.js",
  "js/voice.js",
  "js/notifications.js",
  "css/style.css"
];

let changed = 0;
for (const f of FILES) {
  const src = path.join(root, f);
  const dst = path.join(root, "store", f);
  const header = f.endsWith(".css")
    ? `/* نسخة تلقائية من /${f} (node tools/sync-store.mjs) — متعدّليش هنا */\n`
    : `// نسخة تلقائية من /${f} (node tools/sync-store.mjs) — متعدّليش هنا\n`;
  const out = header + fs.readFileSync(src, "utf8");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (!fs.existsSync(dst) || fs.readFileSync(dst, "utf8") !== out) { fs.writeFileSync(dst, out); changed++; }
}
console.log(`sync-store: ${changed ? `${changed} file(s) updated` : "up to date"}`);
