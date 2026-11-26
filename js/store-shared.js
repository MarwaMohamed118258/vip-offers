// منطق Offers Store المشترك بين تطبيق المتجر ولوحة الأدمن (والجزء اللي بيخص ظهور الشركات بيستخدمه تطبيق VIP كمان)
// store/js/store-shared.js نسخة تلقائية من الملف ده: node tools/sync-store.mjs
import { normTitle, num, money } from "./core.js";

// ---------- المحافظات (27) ----------
export const GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية", "الدقهلية", "الغربية", "المنوفية", "البحيرة",
  "كفر الشيخ", "دمياط", "بورسعيد", "الإسماعيلية", "السويس", "الفيوم", "بني سويف", "المنيا", "أسيوط",
  "سوهاج", "قنا", "الأقصر", "أسوان", "البحر الأحمر", "الوادي الجديد", "مطروح", "شمال سيناء", "جنوب سيناء"
];
export const GOVERNORATES_EN = {
  "القاهرة": "Cairo", "الجيزة": "Giza", "الإسكندرية": "Alexandria", "القليوبية": "Qalyubia", "الشرقية": "Sharqia",
  "الدقهلية": "Dakahlia", "الغربية": "Gharbia", "المنوفية": "Monufia", "البحيرة": "Beheira", "كفر الشيخ": "Kafr El Sheikh",
  "دمياط": "Damietta", "بورسعيد": "Port Said", "الإسماعيلية": "Ismailia", "السويس": "Suez", "الفيوم": "Faiyum",
  "بني سويف": "Beni Suef", "المنيا": "Minya", "أسيوط": "Asyut", "سوهاج": "Sohag", "قنا": "Qena", "الأقصر": "Luxor",
  "أسوان": "Aswan", "البحر الأحمر": "Red Sea", "الوادي الجديد": "New Valley", "مطروح": "Matrouh",
  "شمال سيناء": "North Sinai", "جنوب سيناء": "South Sinai"
};

// ---------- حالات طلبات المتجر ----------
export const STORE_STATUSES = ["جديد", "تم التأكيد", "اتشحن", "اتسلّم", "ملغي"];
export const STORE_DELIVERED = "اتسلّم";
export const FOLLOWUP_DAYS = 30;
export const FOLLOWUP_TEXT = "إزيك؟ عامل إيه مع المنتج؟ محتاج تجدد الكورس؟";

// ---------- الإعدادات (settings/store) ----------
export const DEFAULT_STORE_SETTINGS = {
  whatsapp: "01288237454",
  shippingFee: 40,
  freeThreshold: 900,
  about: [
    "متجر العروض بيجمعلك أقوى العروض من شركات موثوقة في مكان واحد.",
    "✔️ منتجات أصلية ومضمونة",
    "✔️ أسعار واضحة: سعر الجمهور وسعر العرض قدامك",
    "✔️ الدفع كاش عند الاستلام",
    "✔️ توصيل لكل محافظات مصر",
    "هدفنا إنك تاخد أحسن سعر وأحسن خدمة 🤍"
  ].join("\n"),
  aboutEn: [
    "Offers Store brings you the best offers from trusted companies in one place.",
    "✔️ Original, guaranteed products",
    "✔️ Clear prices: you see the public price and the offer price",
    "✔️ Cash on delivery",
    "✔️ Delivery to all governorates in Egypt",
    "Our goal is the best price and the best service for you 🤍"
  ].join("\n")
};
export function storeSettings(d) {
  const s = { ...DEFAULT_STORE_SETTINGS };
  if (d && typeof d === "object") {
    if (typeof d.whatsapp === "string" && d.whatsapp.replace(/\D/g, "").length >= 10) s.whatsapp = d.whatsapp.trim();
    if (Number.isFinite(Number(d.shippingFee)) && d.shippingFee !== "" && Number(d.shippingFee) >= 0) s.shippingFee = Number(d.shippingFee);
    if (Number.isFinite(Number(d.freeThreshold)) && d.freeThreshold !== "" && Number(d.freeThreshold) >= 0) s.freeThreshold = Number(d.freeThreshold);
    if (typeof d.about === "string" && d.about.trim()) s.about = d.about;
    if (typeof d.aboutEn === "string") s.aboutEn = d.aboutEn;
  }
  return s;
}

// رقم موبايل مصري → صيغة واتساب الدولية (01288237454 → 201288237454)
export function waNumber(phone) {
  let d = String(phone || "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "20" + d.slice(1);
  return d;
}

// موبايل مصري: 01xxxxxxxxx (بنقبل +20 / 0020 / أرقام عربي ومسافات ونحوّلها)
export const EG_PHONE_RE = /^01[0125][0-9]{8}$/;
export function cleanEgPhone(v) {
  let d = String(v || "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/\D/g, "");
  if (d.startsWith("0020")) d = "0" + d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = "0" + d.slice(2);
  else if (d.length === 10 && d.startsWith("1")) d = "0" + d;
  return d;
}

// ---------- الشركات (companies): الظهور في VIP / Offers Store ----------
// الشركة اللي ملهاش مستند في companies بتظهر في الاتنين (عشان البيانات القديمة تفضل شغالة)
export function companyIndex(list) {
  const m = new Map();
  for (const c of list || []) if (c && c.name) m.set(normTitle(c.name), c);
  return m;
}
export const companyDoc = (idx, name) => idx.get(normTitle(name)) || null;
export const companyVisible = (idx, name, where) => companyDoc(idx, name)?.[where] !== false;
export const offerInStore = (o, idx) => o.showStore !== false && companyVisible(idx, o.company, "showStore");
export const offerInVip = (o, idx) => o.showVip !== false && companyVisible(idx, o.company, "showVip");

// ---------- الشحن ----------
// lines: [{ qty, unitPrice, freeShipping }]
// مجاني لو الإجمالي بعد الخصم >= الحد، أو كل العروض اللي في السلة عليها «شحن مجاني»
export function calcShipping(lines, settings) {
  const s = storeSettings(settings);
  const subtotal = Math.round(lines.reduce((sum, l) => sum + num(l.qty) * num(l.unitPrice), 0) * 100) / 100;
  const allFree = lines.length > 0 && lines.every((l) => l.freeShipping === true);
  const byTotal = s.freeThreshold > 0 && subtotal >= s.freeThreshold;
  const free = lines.length > 0 && (allFree || byTotal);
  const shipping = !lines.length || free ? 0 : s.shippingFee;
  return {
    subtotal, shipping, total: subtotal + shipping, free, allFree, byTotal,
    remaining: !free && s.freeThreshold > 0 ? Math.max(0, s.freeThreshold - subtotal) : 0
  };
}

// ---------- رسالة واتساب (بالعربي دايماً) ----------
// customer: { name, phone, governorate, address, notes }, lines: [{ name, company, qty, unitPrice }]
export function buildStoreMessage(customer, lines, ship, orderCode = "") {
  const body = lines.map((l, i) =>
    `${i + 1}) ${l.name}\n` +
    (l.company ? `   🏢 الشركة: ${l.company}\n` : "") +
    `   الكمية: ${l.qty} × ${money(l.unitPrice)} = ${money(l.qty * l.unitPrice)}`
  ).join("\n\n");
  return [
    "طلب جديد من متجر العروض 🛍️",
    ...(orderCode ? [`🧾 رقم الطلب: ${orderCode}`] : []),
    "",
    "👤 بيانات العميل",
    `الاسم: ${customer.name}`,
    `📞 الموبايل: ${customer.phone}`,
    `📍 المحافظة: ${customer.governorate}`,
    `🏠 العنوان: ${customer.address}`,
    ...(customer.notes ? [`📝 ملاحظات: ${customer.notes}`] : []),
    "",
    "🛒 الطلب",
    body,
    "",
    "━━━━━━━━━━",
    `المجموع: ${money(ship.subtotal)}`,
    `🚚 الشحن: ${ship.shipping > 0 ? money(ship.shipping) : "مجاني"}`,
    `💰 الإجمالي: ${money(ship.total)}`,
    "💵 الدفع: كاش عند الاستلام"
  ].join("\n");
}

// ---------- المساعد (أسئلة وإجابات من الأدمن بس، من غير ذكاء اصطناعي) ----------
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
// توحيد الحروف: ة/ه، أ/إ/آ/ا، ى/ي، وشيل التشكيل والعلامات
export function normAr(s) {
  return normTitle(String(s || "").replace(TASHKEEL, "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/ٱ/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const STOP = new Set(("في من على عن هل ايه اي ازاي كام انا انت انتي حضرتك هو هي هم مع ده دي دا دى لو او و يا ممكن عايز عايزه " +
  "عاوز محتاج اعرف لما بس كده كدا اللي الي الى الي ال ما مش بتاع بتاعت عند عندي عندكم عندك ليه لي ليا فيه فين امتي " +
  "the a an is are to of and or what how do does i you me my can for in on with").split(" "));
// شيل «ال» و «بال» و «وال»… من أول الكلمة
function stem(w) {
  for (const p of ["وبال", "وال", "بال", "فال", "كال", "لل", "ال"]) {
    if (w.startsWith(p) && w.length - p.length >= 3) return w.slice(p.length);
  }
  return w;
}
export function arTokens(s) {
  return normAr(s).split(" ").filter((w) => w && !STOP.has(w)).map(stem).filter((w) => w.length >= 2 && !STOP.has(w));
}
// كلمتين متطابقتين أو واحدة بتبدأ بالتانية (شحن / شحنه / الشحن)
const tokMatch = (u, k) => u === k || (k.length >= 3 && u.length >= 3 && (u.startsWith(k) || k.startsWith(u)));
const hasTok = (userToks, k) => userToks.some((u) => tokMatch(u, k));

export const splitKeywords = (kw) => (Array.isArray(kw) ? kw : String(kw || "").split(/[,،;؛\n]+/))
  .map((k) => String(k).trim()).filter(Boolean);

export const GENERAL = "عام";
export const isGeneral = (f) => !String(f?.product || "").trim() || normAr(f.product) === normAr(GENERAL);

function scoreFaq(f, text, toks) {
  const nt = ` ${normAr(text)} `;
  if (normAr(f.question) && normAr(f.question) === normAr(text)) return 100; // ضغطة على سؤال مقترح
  let score = 0, kwHit = false;
  for (const kw of splitKeywords(f.keywords)) {
    const nk = normAr(kw);
    if (!nk) continue;
    const kt = arTokens(kw);
    if (nt.includes(` ${nk} `) || (kt.length && kt.every((k) => hasTok(toks, k)))) {
      score += 2 + Math.min(kt.length || 1, 3);
      kwHit = true;
    }
  }
  const pt = isGeneral(f) ? [] : arTokens(f.product);
  const qt = [...new Set(arTokens(f.question))].filter((k) => !pt.some((p) => tokMatch(k, p)));
  const overlap = qt.filter((k) => hasTok(toks, k)).length;
  score += overlap;
  if (!kwHit && qt.length && overlap / qt.length >= 0.6) score += 1;
  // اسم المنتج لوحده مش كفاية: لازم كلمة من الكلمات المفتاحية أو من السؤال كمان
  if (score > 0 && !isGeneral(f) && productMentioned(f.product, toks)) score += 3;
  return score;
}

function productMentioned(name, toks) {
  const pt = arTokens(name);
  return pt.length > 0 && pt.every((k) => hasTok(toks, k));
}

// معلومات المنتج اللي الأدمن كتبها (طريقة الاستخدام، التحذيرات، مين ميستخدموش، نصايح الأكل)
export const PRODUCT_INFO = [
  { key: "notFor", label: "مين ميستخدموش", labelEn: "Who should not use it", q: (n) => `مين ممنوع يستخدم ${n}؟`,
    words: ["ممنوع", "مينفعش", "ميستخدمش", "ميستخدموش", "حامل", "حمل", "رضاعه", "مرضعه", "امراض", "مزمن", "مسموح"] },
  { key: "warnings", label: "تحذيرات", labelEn: "Warnings", q: (n) => `إيه تحذيرات ${n}؟`,
    words: ["تحذير", "تحذيرات", "اضرار", "ضرر", "جانبيه", "اعراض", "امان", "خطر", "warning", "warnings", "side"] },
  { key: "dietTips", label: "نصايح الأكل", labelEn: "Diet tips", q: (n) => `نصايح الأكل مع ${n}؟`,
    words: ["اكل", "رجيم", "دايت", "غذا", "غذائي", "اكلات", "نظام", "مشروبات", "diet", "food"] },
  { key: "usage", label: "طريقة الاستخدام", labelEn: "How to use", q: (n) => `طريقة استخدام ${n}؟`,
    words: ["استخدام", "استخدم", "استعمال", "استعمل", "طريقه", "جرعه", "اخده", "باخد", "ناخد", "ياخد", "تتاخد", "بتتاخد", "يتاخد", "بيتاخد", "اخد", "حط", "احط", "بيتحط", "يتحط", "ادهن", "دهان", "بيتدهن", "اشرب", "بيتشرب", "مرات", "usage", "use", "dose"] }
];

// faqs: [{ id, company, product, question, keywords, answer }]
// products: [{ id, name, nameEn, company, usage, warnings, notFor, dietTips }]
// بيرجّع { answer: { text, question, company, product } | null, suggestions: [سؤال…] }
export function askAssistant(text, faqs, products = []) {
  const toks = arTokens(text);
  const list = (faqs || []).filter((f) => f && String(f.answer || "").trim() && String(f.question || "").trim());
  const general = list.filter(isGeneral);
  if (!toks.length) return { answer: null, suggestions: general.slice(0, 4).map((f) => f.question) };

  let best = null, bestScore = 0;
  for (const f of list) {
    const s = scoreFaq(f, text, toks);
    if (s > bestScore) { best = f; bestScore = s; }
  }

  // منتج اتذكر بالاسم + عنده معلومات مكتوبة
  let pBest = null, pScore = 0, pInfo = null;
  for (const p of products || []) {
    if (!PRODUCT_INFO.some((i) => String(p[i.key] || "").trim())) continue;
    const mentioned = productMentioned(p.name, toks) || (p.nameEn && productMentioned(p.nameEn, toks));
    if (!mentioned) continue;
    const intent = PRODUCT_INFO.find((i) => String(p[i.key] || "").trim() && i.words.some((w) => hasTok(toks, w)));
    const s = 3 + arTokens(p.name).length + (intent ? 3 : 0);
    if (s > pScore) { pBest = p; pScore = s; pInfo = intent || null; }
  }

  const productSuggestions = (p, exclude) => [
    ...list.filter((f) => !isGeneral(f) && normAr(f.product) === normAr(p.name) && f.question !== exclude).map((f) => f.question),
    ...PRODUCT_INFO.filter((i) => String(p[i.key] || "").trim() && i.q(p.name) !== exclude).map((i) => i.q(p.name))
  ];
  const fill = (arr, exclude) => {
    const out = [...new Set(arr)].filter((q) => q !== exclude);
    for (const f of general) { if (out.length >= 4) break; if (f.question !== exclude && !out.includes(f.question)) out.push(f.question); }
    return out.slice(0, 4);
  };

  const MIN = 2;
  if (pBest && (pScore > bestScore || bestScore < MIN) && (pInfo || bestScore < MIN)) {
    const infos = pInfo ? [pInfo] : PRODUCT_INFO.filter((i) => String(pBest[i.key] || "").trim()).reverse();
    const textOut = infos.map((i) => (infos.length > 1 ? `▪️ ${i.label}:\n` : "") + String(pBest[i.key]).trim()).join("\n\n");
    const q = pInfo ? pInfo.q(pBest.name) : pBest.name;
    return {
      answer: { text: textOut, question: q, company: pBest.company || "", product: pBest.name, title: pInfo ? pInfo.label : "" },
      suggestions: fill(productSuggestions(pBest, q), q)
    };
  }
  if (!best || bestScore < MIN) return { answer: null, suggestions: fill([], "") };

  const rel = isGeneral(best) ? [] :
    [...list.filter((f) => f !== best && normAr(f.product) === normAr(best.product)).map((f) => f.question),
     ...((products || []).filter((p) => normAr(p.name) === normAr(best.product)).flatMap((p) => productSuggestions(p, best.question)))];
  return {
    answer: { text: String(best.answer).trim(), question: best.question, company: best.company || "", product: isGeneral(best) ? "" : best.product },
    suggestions: fill(rel, best.question)
  };
}

// {shippingFee} و {freeThreshold} في الإجابة بيتبدّلوا بالأرقام من الإعدادات
export function fillAnswer(text, settings) {
  const s = storeSettings(settings);
  return String(text || "")
    .replace(/\{shippingFee\}/g, String(s.shippingFee))
    .replace(/\{freeThreshold\}/g, String(s.freeThreshold));
}

// الأسئلة العامة الأساسية (الأدمن تقدر تعدّلها أو تمسحها من «أسئلة وإجابات»)
export const STARTER_FAQ = [
  {
    question: "إزاي أطلب؟", keywords: "اطلب، طلب، اشتري، شراء، اوردر، طريقة الطلب، احجز",
    answer: "الطلب سهل جداً 👌\n1) اختار العرض اللي يعجبك واضغط «أضف للسلة».\n2) افتح السلة واكتب اسمك وموبايلك ومحافظتك وعنوانك.\n3) اضغط «اطلب على واتساب» وهتتبعت رسالة الطلب جاهزة.\nوهنتواصل معاك نأكد الطلب."
  },
  {
    question: "الشحن بكام وبياخد قد إيه؟", keywords: "شحن، توصيل، مصاريف الشحن، يوصل امتى، مدة التوصيل، محافظات، دليفري",
    answer: "بنوصل لكل محافظات مصر 🚚\nمصاريف الشحن {shippingFee} جنيه، والشحن مجاني لو طلبك {freeThreshold} جنيه أو أكتر بعد الخصم، أو لو كل العروض اللي في طلبك عليها «شحن مجاني».\nالتوصيل عادة من 2 لـ 5 أيام عمل حسب المحافظة."
  },
  {
    question: "الدفع إزاي؟", keywords: "دفع، ادفع، كاش، فيزا، الدفع عند الاستلام، فلوس، تحويل",
    answer: "الدفع كاش عند الاستلام 💵\nبتدفع لما الطلب يوصلك، ومن غير أي دفع مقدم."
  },
  {
    question: "المنتجات أصلية؟", keywords: "اصلي، اصليه، اورجينال، مضمون، تقليد، مضروب، ضمان",
    answer: "أيوه ✅ كل المنتجات أصلية ومن شركات موثوقة، وبتوصلك بتاريخ صلاحية واضح."
  },
  {
    question: "أتواصل معاكم إزاي؟", keywords: "تواصل، كلم، رقم، واتساب، خدمة العملاء، اكلمكم، اتصل",
    answer: "تقدر تكلمنا على واتساب في أي وقت 💬 من زرار «كلمنا على واتساب» تحت، وهترد عليك متخصصة على طول."
  }
];
