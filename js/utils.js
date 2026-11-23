// أدوات مشتركة بين التطبيق ولوحة الأدمن

export const CATEGORIES = ["شعر", "بشرة", "وزن", "أطفال", "عناية شخصية", "رياضة"];

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

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function money(v) {
  return num(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج";
}

// حساب الإجماليات ونسبة الخصم من قائمة المنتجات
export function calcTotals(products) {
  let totalPublic = 0, totalOffer = 0, items = 0;
  for (const p of products || []) {
    const q = Math.max(1, num(p.qty) || 1);
    totalPublic += q * num(p.publicPrice);
    totalOffer += q * num(p.offerPrice);
    items += q;
  }
  const discount = totalPublic > 0 ? Math.round((1 - totalOffer / totalPublic) * 100) : 0;
  return { totalPublic, totalOffer, discount, items };
}

export const SAMPLE_OFFER = {
  company: "باريشيا فارما",
  category: "شعر",
  name: "كورس جمال الشعر المتكامل",
  imageUrl: "",
  products: [
    { name: "أوركينتا", qty: 1, publicPrice: 330, offerPrice: 168 },
    { name: "هيرسكينو", qty: 1, publicPrice: 370, offerPrice: 188 },
    { name: "سيرم الشعر", qty: 1, publicPrice: 400, offerPrice: 203 },
    { name: "لوشن الشعر", qty: 1, publicPrice: 500, offerPrice: 254 },
    { name: "شامبو القشرة", qty: 1, publicPrice: 400, offerPrice: 204 },
    { name: "سيرم الرموش", qty: 1, publicPrice: 300, offerPrice: 153 }
  ]
};
