// أدوات مشتركة بين التطبيق ولوحة الأدمن

export const CATEGORIES = [
  "شعر", "بشرة", "وزن", "أطفال", "عناية شخصية", "رياضة", "مكملات غذائية", "فيتامينات"
];

// الأقسام الأساسية + الأقسام اللي الأدمن ضافها (settings/categories)
// + أي قسم موجود في العروض أو المنتجات (زي اللي بييجي من ملف الاستيراد)
export function allCategories(items = [], saved = []) {
  const out = [...CATEGORIES];
  const seen = new Set(out.map((c) => normTitle(c)));
  const extra = [...saved, ...items.map((o) => o.category)]
    .map((c) => String(c || "").trim().replace(/\s+/g, " "))
    .filter((c) => c && !seen.has(normTitle(c)) && seen.add(normTitle(c)))
    .sort((a, b) => a.localeCompare(b, "ar"));
  return [...out, ...extra];
}

// لو القسم اللي اتكتب موجود بشكل قريب (مسافات، أ/ا، ة/ه…) نستخدم الموجود
export function matchCategory(name, cats) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  return cats.find((c) => normTitle(c) === normTitle(n)) || n;
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
      totalPublic: t.totalPublic, totalOffer: t.totalOffer, discount: t.discount, itemsCount: t.items,
      endDate: isDateStr(raw.endDate) ? raw.endDate : "",
      titleEn: typeof raw.titleEn === "string" ? raw.titleEn.trim() : ""
    },
    mismatch
  };
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

export function endLabel(daysLeft) {
  return daysLeft === 0 ? "آخر يوم النهارده" : `ينتهي خلال ${daysLeft} يوم`;
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
    product: {
      company, category, name, publicPrice: num(raw.publicPrice), image: safeImage(raw.image),
      nameEn: typeof raw.nameEn === "string" ? raw.nameEn.trim() : ""
    }
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
  const nameEn = typeof p.nameEn === "string" ? p.nameEn.trim() : "";
  if (nameEn) item.nameEn = nameEn;
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

// ---------- استيراد الأسماء الإنجليزي ----------
// json: { products:{عربي:English}, offers:{عربي:English}, categories:{…}, companies:{…} }
// بيرجّع التعديلات المطلوبة (من غير ما يكتب حاجة) + الأرقام
export function planEnglishNames(json, products, offers, knownCategories = [], knownCompanies = []) {
  const toMap = (obj) => {
    const m = new Map();
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [ar, en] of Object.entries(obj)) {
        const v = typeof en === "string" ? en.trim() : "";
        if (String(ar).trim() && v) m.set(normTitle(ar), { ar: String(ar).trim(), en: v });
      }
    }
    return m;
  };
  const pMap = toMap(json?.products), oMap = toMap(json?.offers);
  const cMap = toMap(json?.categories), coMap = toMap(json?.companies);
  const usedP = new Set(), usedO = new Set();

  const productUpdates = [];
  let productsSame = 0;
  for (const p of products) {
    const hit = pMap.get(normTitle(p.name));
    if (!hit) continue;
    usedP.add(normTitle(p.name));
    if ((p.nameEn || "") === hit.en) productsSame++;
    else productUpdates.push({ id: p.id, nameEn: hit.en });
  }

  const offerUpdates = [];
  let offersSame = 0, itemsUpdated = 0;
  for (const o of offers) {
    const change = {};
    const hit = oMap.get(normTitle(o.name));
    if (hit) {
      usedO.add(normTitle(o.name));
      if ((o.titleEn || "") !== hit.en) change.titleEn = hit.en; else offersSame++;
    }
    let itemsChanged = false;
    const items = (o.products || []).map((it) => {
      const ph = pMap.get(normTitle(it.name));
      if (!ph) return it;
      usedP.add(normTitle(it.name));
      if ((it.nameEn || "") === ph.en) return it;
      itemsChanged = true; itemsUpdated++;
      return { ...it, nameEn: ph.en };
    });
    if (itemsChanged) change.products = items;
    if (Object.keys(change).length) offerUpdates.push({ id: o.id, ...change });
  }

  // الأقسام والشركات: نربط بالاسم الموجود لو قريب منه (مسافات، أ/ا، ة/ه…)
  const mapNames = (m, known) => {
    const out = {};
    for (const { ar, en } of m.values()) {
      const existing = known.find((k) => normTitle(k) === normTitle(ar));
      out[existing || ar] = en;
    }
    return out;
  };
  const categories = mapNames(cMap, knownCategories);
  const companies = mapNames(coMap, knownCompanies);

  return {
    productUpdates, offerUpdates, categories, companies,
    stats: {
      productsUpdated: productUpdates.length, productsSame,
      productsNotFound: [...pMap.entries()].filter(([k]) => !usedP.has(k)).map(([, v]) => v.ar),
      offersUpdated: offerUpdates.filter((u) => u.titleEn !== undefined).length, offersSame,
      offersNotFound: [...oMap.entries()].filter(([k]) => !usedO.has(k)).map(([, v]) => v.ar),
      itemsUpdated,
      categories: Object.keys(categories).length,
      companies: Object.keys(companies).length
    }
  };
}
