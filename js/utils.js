// أدوات خاصة بتطبيق VIP ولوحة الأدمن (والأدوات العامة في core.js)
export * from "./core.js";
import { normTitle, esc, safeUrl, safeImage, num, mergeItems, calcTotals, isDateStr, toMillis, lineQty, lineOffer, linePublic } from "./core.js";


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


// تحويل عرض من ملف الاستيراد (title, items) لشكل العرض في Firestore (name, products)
// بيرجّع { offer } لو سليم، أو { reason } لو ناقص
export function mapImportedOffer(raw) {
  if (!raw || typeof raw !== "object") return { reason: "مش عرض" };
  const company = String(raw.company ?? "").trim();
  const category = String(raw.category ?? "").trim();
  const name = String(raw.title ?? raw.name ?? "").trim().replace(/\s+/g, " ");
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.products) ? raw.products : [];
  const products = mergeItems(items
    .filter((p) => p && String(p.name ?? "").trim())
    .map((p) => ({
      name: String(p.name).trim(),
      qty: Math.max(1, num(p.qty) || 1),
      publicPrice: num(p.publicPrice),
      offerPrice: num(p.offerPrice)
    })));
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
  if (num(p.offerTotal) > 0) item.offerTotal = num(p.offerTotal);
  if (num(p.publicTotal) > 0) item.publicTotal = num(p.publicTotal);
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

// =====================================================================
// الطلبات والمكافآت والتقييمات
// =====================================================================
export const ORDER_STATUSES = ["جديد", "تم التواصل", "اتسلّم", "ملغي"];
export const DELIVERED = "اتسلّم";


// الشهر بالشكل 2026-11 (بالتوقيت المحلي)
export function monthKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// مفتاح المنتج للتقييمات: الـ productId لو موجود، وإلا بصمة من الاسم (حروف وأرقام بس عشان ينفع ID)
export function productKey(it) {
  if (it && typeof it.productId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(it.productId)) return it.productId;
  const s = normTitle(it?.name || "");
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 31) ^ c; }
  return "n_" + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// المنتجات المختلفة جوّه طلب (عشان التقييم): [{ key, productId, name }]
export function orderProducts(order) {
  const seen = new Map();
  for (const line of order.items || []) {
    for (const p of line.products || []) {
      const key = productKey(p);
      if (!seen.has(key)) seen.set(key, { key, productId: p.productId || "", name: String(p.name || "") });
    }
  }
  return [...seen.values()];
}

// مستويات المكافآت: [{ name, target, reward }] مترتبة بالهدف
export function sortLevels(levels) {
  return (Array.isArray(levels) ? levels : [])
    .filter((l) => l && String(l.name || "").trim() && num(l.target) > 0)
    .map((l) => ({ name: String(l.name).trim(), target: num(l.target), reward: String(l.reward || "").trim() }))
    .sort((a, b) => a.target - b.target);
}

// المستوى الحالي واللي بعده ونسبة التقدّم لمجموع معيّن
export function levelInfo(total, levels) {
  const ls = sortLevels(levels);
  let current = null, next = null;
  for (const l of ls) { if (total >= l.target) current = l; else { next = l; break; } }
  const from = current ? current.target : 0;
  const progress = next ? Math.max(0, Math.min(1, (total - from) / (next.target - from))) : (current ? 1 : 0);
  return { current, next, progress, remaining: next ? Math.max(0, next.target - total) : 0 };
}

// ملخّص التقييمات: ratings [{ id, productId, productName, stars, comment, commentHidden }]
// بيرجّع دالة بتجيب { avg, count, list } لمجموعة منتجات (بالـ id أو بالاسم)
export const MIN_RATINGS = 3;
export function ratingsIndex(ratings) {
  const byId = new Map(), byName = new Map();
  for (const r of ratings || []) {
    const s = Math.round(num(r.stars));
    if (s < 1 || s > 5) continue;
    const rr = { ...r, stars: s };
    if (r.productId) (byId.get(r.productId) || byId.set(r.productId, []).get(r.productId)).push(rr);
    const n = normTitle(r.productName || "");
    if (n) (byName.get(n) || byName.set(n, []).get(n)).push(rr);
  }
  return (products) => {
    const all = new Map();
    for (const p of products || []) {
      for (const r of [...(byId.get(p.productId || p.id) || []), ...(byName.get(normTitle(p.name || "")) || [])]) all.set(r.id, r);
    }
    const list = [...all.values()];
    const count = list.length;
    const avg = count ? list.reduce((s, r) => s + r.stars, 0) / count : 0;
    return { avg, count, list };
  };
}

// أكتر 5 عروض اتطلبت (طلبات «اتسلّم» في آخر 30 يوم، بالكمية)
export function topOffers(orders, now = Date.now(), n = 5, days = 30) {
  const since = now - days * 86400000;
  const qty = new Map();
  for (const o of orders || []) {
    if (o.status !== DELIVERED || toMillis(o.createdAt) < since) continue;
    for (const it of o.items || []) if (it.offerId) qty.set(it.offerId, (qty.get(it.offerId) || 0) + Math.max(1, num(it.qty)));
  }
  return [...qty.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}

// ---------- الاقتراحات ----------
// النوع والحالة بيتسجّلوا بالعربي دايماً (الأدمن بيشتغل بالعربي)
export const SUGGESTION_TYPES = ["اقتراح عرض", "منتج جديد", "ملاحظة"];
export const SUGGESTION_STATUSES = ["جديد", "اتبعت للأونر", "اتنفّذ", "مؤجل"];
export const SUGGESTION_OTHER = "أخرى";
export const SUGGESTION_MAX = 1000;

// ---------- صفحة «مانجر مروة» ----------
// المحتوى الافتراضي لحد ما يتحفظ من لوحة الأدمن. كل سطر لوحده، والسطور اللي بتبدأ بـ ✔️ بتظهر كقائمة.
export const DEFAULT_ABOUT = {
  name: "مانجر / مروة محمد",
  nameEn: "Manager / Marwa Mohamed",
  title: "Sales & Business Development Manager",
  titleEn: "Sales & Business Development Manager",
  tagline: "شراكة ناجحة أساسها الثقة، وأسعار تدعم تجارتكم ومكاسبكم.",
  taglineEn: "A successful partnership built on trust, with prices that support your business and profits.",
  body: [
    "خبرة أكثر من 13 عامًا في مجال التسويق وإدارة المبيعات وبناء فرق العمل.",
    "أؤمن أن النجاح الحقيقي لا يقتصر على إتمام عملية البيع، بل يبدأ ببناء علاقة قوية ومستدامة مع شركاء النجاح.",
    "✔️ أفضل فرص التعاون والعروض من مصادر موثوقة.",
    "✔️ دعم تسويقي وبيعي يساعد على تنمية تجارتكم.",
    "✔️ متابعة شخصية واهتمام بكل طلب.",
    "✔️ فرص مستمرة لتحقيق المزيد من المكاسب.",
    "يسعدني أن أكون جزءًا من رحلتكم نحو نجاح أكبر ❤️"
  ].join("\n"),
  bodyEn: [
    "13+ years of experience in marketing, sales management, and team building.",
    "I believe real success is not just about closing a sale; it starts with building a strong, lasting relationship with our partners.",
    "✔️ The best opportunities and offers from trusted sources.",
    "✔️ Marketing and sales support to help your business grow.",
    "✔️ Personal follow-up and care for every order.",
    "✔️ Ongoing opportunities to earn more.",
    "Happy to be part of your journey to greater success ❤️"
  ].join("\n"),
  photoUrl: "",
  reviews: []
};
// الحقل من المستند لو اتحفظ قبل كده (حتى لو فاضي)، وإلا الافتراضي
export const aboutField = (a, k) => (a && k in a ? a[k] : DEFAULT_ABOUT[k]);

// النص → فقرات + قائمة ✔️ (HTML آمن)
const CHECK_RE = /^(✔️|✔|✅|☑️)\s*/;
export function aboutBodyHtml(text) {
  const out = [];
  let list = [];
  const flush = () => { if (list.length) out.push(`<ul class="checklist">${list.join("")}</ul>`); list = []; };
  for (const line of String(text || "").split("\n").map((s) => s.trim()).filter(Boolean)) {
    if (CHECK_RE.test(line)) list.push(`<li>${esc(line.replace(CHECK_RE, ""))}</li>`);
    else { flush(); out.push(`<p>${esc(line)}</p>`); }
  }
  flush();
  return out.join("");
}
