// نسخة تلقائية من /js/core.js (node tools/sync-store.mjs) — متعدّليش هنا
// أدوات عامة مشتركة بين تطبيق VIP و Offers Store ولوحة الأدمن
// (store/js/core.js نسخة تلقائية من الملف ده: node tools/sync-store.mjs)

// توحيد اسم العرض للمقارنة (مسافات زيادة، ي/ى، أ/إ/آ، ة/ه)
export function normTitle(s) {
  return String(s || "").trim().replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();
}

// منع حقن HTML من البيانات المخزنة
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// نقبل روابط http/https بس للصور
export function safeUrl(u) {
  try {
    const url = new URL(String(u || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
}

// صورة المنتج: رابط http/https أو data URL لصورة (أقصى حجم ~700KB عشان حد Firestore)
const DATA_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
export function safeImage(v) {
  const s = String(v || "").trim();
  if (s.startsWith("data:")) return s.length <= 700000 && DATA_IMG.test(s) ? s : "";
  return safeUrl(s);
}

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function money(v) {
  return num(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج";
}

// حساب الإجماليات ونسبة الخصم من قائمة المنتجات
// ---------- سطور العرض ----------
// السطر ممكن يكون فيه offerTotal / publicTotal = إجمالي السطر بالظبط (لما السعر على الكمية مش رقم صحيح:
// مثلاً 3 علب بـ 800 → offerPrice 267 للعرض بس، والإجمالي 800 زي ما هو)
export const round2 = (v) => Math.round(v * 100) / 100;
export const lineQty = (p) => Math.max(1, num(p?.qty) || 1);
export const lineOffer = (p) => (num(p?.offerTotal) > 0 ? num(p.offerTotal) : lineQty(p) * num(p?.offerPrice));
export const linePublic = (p) => (num(p?.publicTotal) > 0 ? num(p.publicTotal) : lineQty(p) * num(p?.publicPrice));
// نفس المنتج = نفس الاسم
export const itemKey = (p) => normTitle(p?.name);
// عدد المنتجات المختلفة في العرض (مش عدد السطور)
export const distinctProducts = (items) => new Set((items || []).filter((p) => p && String(p.name || "").trim()).map(itemKey)).size;

// السعر للوحدة + الإجمالي الدقيق لو القسمة مش رقم صحيح
function unitAndTotal(total, qty, priceKey, totalKey) {
  const t = round2(total), unit = t / qty;
  return Number.isInteger(unit) || round2(unit) * qty === t
    ? { [priceKey]: Number.isInteger(unit) ? unit : round2(unit) }
    : { [priceKey]: Math.round(unit), [totalKey]: t };
}

// دمج السطور المكررة لنفس المنتج في سطر واحد بالكمية الكلية (إجمالي العرض بيفضل زي ما هو بالظبط)
export function mergeItems(items) {
  const groups = new Map();
  for (const p of items || []) {
    if (!p) continue;
    const k = String(p.name || "").trim() ? itemKey(p) : Symbol("blank");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const qty = g.reduce((s, p) => s + lineQty(p), 0);
    const merged = { ...g[0] };
    delete merged.offerTotal; delete merged.publicTotal;
    merged.productId = g.find((p) => p.productId)?.productId || merged.productId;
    if (!merged.productId) delete merged.productId;
    merged.image = merged.image || g.find((p) => p.image)?.image;
    if (!merged.image) delete merged.image;
    merged.nameEn = merged.nameEn || g.find((p) => p.nameEn)?.nameEn;
    if (!merged.nameEn) delete merged.nameEn;
    merged.qty = qty;
    Object.assign(merged,
      unitAndTotal(g.reduce((s, p) => s + linePublic(p), 0), qty, "publicPrice", "publicTotal"),
      unitAndTotal(g.reduce((s, p) => s + lineOffer(p), 0), qty, "offerPrice", "offerTotal"));
    return merged;
  });
}
export const hasDuplicateLines = (items) => mergeItems(items).length < (items || []).filter(Boolean).length;

export function calcTotals(products) {
  let totalPublic = 0, totalOffer = 0, items = 0;
  for (const p of products || []) {
    if (!p) continue;
    totalPublic += linePublic(p);
    totalOffer += lineOffer(p);
    items += lineQty(p);
  }
  totalPublic = round2(totalPublic); totalOffer = round2(totalOffer);
  const discount = totalPublic > 0 ? Math.round((1 - totalOffer / totalPublic) * 100) : 0;
  return { totalPublic, totalOffer, discount, items };
}

// ---------- التواريخ: "جديد" وتاريخ الانتهاء ----------
const DAY = 86400000;
export const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

export function toMillis(v) {
  if (typeof v === "number") return v;
  if (v?.toMillis) return v.toMillis();
  if (typeof v?.seconds === "number") return v.seconds * 1000;
  return 0;
}

// تاريخ النهارده بالتوقيت المحلي YYYY-MM-DD
export function todayStr(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// عدد الأيام من النهارده لتاريخ الانتهاء (0 = آخر يوم النهارده، سالب = خلص)
export function daysUntil(endDate, now = Date.now()) {
  const [y1, m1, d1] = todayStr(now).split("-").map(Number);
  const [y2, m2, d2] = endDate.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

export function offerStatus(o, now = Date.now()) {
  const created = toMillis(o.createdAt);
  const isNew = created > 0 && now - created < 3 * DAY;
  const daysLeft = isDateStr(o.endDate) ? daysUntil(o.endDate, now) : null;
  return {
    isNew,
    daysLeft,
    expired: daysLeft !== null && daysLeft < 0,
    endingSoon: daysLeft !== null && daysLeft >= 0 && daysLeft <= 3
  };
}

// كود عشوائي طويل (للعميل): 32 حرف من crypto
export function randomId(len = 32) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}
