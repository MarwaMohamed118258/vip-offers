// أدوات مشتركة بين التطبيق ولوحة الأدمن

export const CATEGORIES = ["شعر", "بشرة", "وزن", "أطفال", "عناية شخصية", "رياضة"];

// الأقسام الأساسية + أي قسم جديد موجود في العروض (زي اللي بييجي من ملف الاستيراد)
export function allCategories(offers = []) {
  const extra = [...new Set(offers.map((o) => String(o.category || "").trim()).filter(Boolean))]
    .filter((c) => !CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b, "ar"));
  return [...CATEGORIES, ...extra];
}

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

// تحويل عرض من ملف الاستيراد (title, items) لشكل العرض في Firestore (name, products)
// بيرجّع { offer } لو سليم، أو { reason } لو ناقص
export function mapImportedOffer(raw) {
  if (!raw || typeof raw !== "object") return { reason: "مش عرض" };
  const company = String(raw.company ?? "").trim();
  const category = String(raw.category ?? "").trim();
  const name = String(raw.title ?? raw.name ?? "").trim().replace(/\s+/g, " ");
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.products) ? raw.products : [];
  const products = items
    .filter((p) => p && String(p.name ?? "").trim())
    .map((p) => ({
      name: String(p.name).trim(),
      qty: Math.max(1, num(p.qty) || 1),
      publicPrice: num(p.publicPrice),
      offerPrice: num(p.offerPrice)
    }));
  if (!name) return { reason: "من غير اسم" };
  if (!company || !category) return { reason: "ناقصه الشركة أو القسم", name };
  if (!products.length) return { reason: "من غير منتجات", name };

  // الإجماليات بتتحسب من المنتجات عشان تطابق اللي بيظهر للعميل
  const t = calcTotals(products);
  const fileTotal = num(raw.totalOffer);
  const mismatch = fileTotal > 0 && Math.abs(fileTotal - t.totalOffer) > 1;
  return {
    offer: {
      company, category, name,
      imageUrl: safeUrl(raw.imageUrl),
      products,
      totalPublic: t.totalPublic, totalOffer: t.totalOffer, discount: t.discount, itemsCount: t.items
    },
    mismatch
  };
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
