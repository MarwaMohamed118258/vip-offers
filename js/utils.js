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

// صورة المنتج: رابط http/https أو data URL لصورة (أقصى حجم ~700KB عشان حد Firestore)
const DATA_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
export function safeImage(v) {
  const s = String(v || "").trim();
  if (s.startsWith("data:")) return s.length <= 700000 && DATA_IMG.test(s) ? s : "";
  return safeUrl(s);
}

// توزيع سعر العرض الكلي على المنتجات بنسبة سعر الجمهور.
// بيرجّع سعر الوحدة لكل منتج (جنيهات صحيحة)، وآخر منتج بيتعدّل عشان المجموع يطلع بالظبط.
export function splitOfferTotal(total, items) {
  const T = Math.round(num(total));
  const qty = items.map((it) => Math.max(1, num(it.qty) || 1));
  const lines = items.map((it, i) => qty[i] * Math.max(0, num(it.publicPrice)));
  const sumPub = lines.reduce((a, b) => a + b, 0);
  if (!items.length || T <= 0) return items.map(() => 0);
  const share = (i) => sumPub > 0 ? T * lines[i] / sumPub : T * qty[i] / qty.reduce((a, b) => a + b, 0);
  // المنتج اللي بيتعدّل: آخر منتج كميته 1 (عشان يفضل رقم صحيح)، وإلا آخر منتج
  let adj = -1;
  for (let i = items.length - 1; i >= 0; i--) if (qty[i] === 1) { adj = i; break; }
  if (adj === -1) adj = items.length - 1;
  const units = items.map((_, i) => i === adj ? 0 : Math.round(share(i) / qty[i]));
  const rest = T - units.reduce((s, u, i) => s + u * qty[i], 0);
  units[adj] = Math.round((rest / qty[adj]) * 100) / 100;
  return units;
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

// منتج من ملف الاستيراد → شكل المنتج في Firestore
export function mapImportedProduct(raw) {
  if (!raw || typeof raw !== "object") return { reason: "مش منتج" };
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  const company = String(raw.company ?? "").trim();
  const category = String(raw.category ?? "").trim();
  if (!name) return { reason: "من غير اسم" };
  if (!company) return { reason: "ناقصه الشركة", name };
  return {
    product: { company, category, name, publicPrice: num(raw.publicPrice), image: safeImage(raw.image) }
  };
}

// شكل عنصر العرض اللي بيتحفظ: لو المنتج من الكتالوج بنحفظ productId،
// والصورة بتتحفظ في العرض بس لو كانت رابط (الصور المرفوعة بتتجاب من المنتج نفسه عشان العرض يفضل خفيف)
export function offerItem(p) {
  const item = {
    name: String(p.name || "").trim(),
    qty: Math.max(1, num(p.qty) || 1),
    publicPrice: num(p.publicPrice),
    offerPrice: num(p.offerPrice)
  };
  if (p.productId) item.productId = String(p.productId);
  const img = safeImage(p.image);
  if (img && !img.startsWith("data:")) item.image = img;
  return item;
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
