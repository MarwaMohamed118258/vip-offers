// ترجمة واجهة العملاء: العربي (الافتراضي، RTL) والإنجليزي (LTR)
// رسالة الطلب على واتساب بتفضل بالعربي دايماً (دي في cart.js ومش بتستخدم الملف ده)

const LANG_KEY = "vip_lang";

const STR = {
  ar: {
    appTitle: "عروض VIP لكبار العملاء",
    homeSub: "أقوى عروض الشركات للصيدليات والمخازن",
    langBtn: "EN",
    langAria: "Switch to English",

    welcomeTitle: "أهلاً بحضرتك في عروض VIP لكبار العملاء",
    feat1: "محدش يشوف رقمك",
    feat2: "إشعار مع كل عرض جديد بس",
    feat3: "الطلب بضغطة على واتساب",
    welcomeBtn: "فعّل الإشعارات وشوف العروض",
    iosNote: "على الآيفون: ضيف التطبيق للشاشة الرئيسية الأول (زرار المشاركة ← «إضافة إلى الشاشة الرئيسية»)، وبعدين افتحه من الأيقونة وفعّل الإشعارات.",
    bannerText: "فعّل الإشعارات عشان ميفوتكش أي عرض",
    bannerIos: "على الآيفون: ضيف التطبيق للشاشة الرئيسية الأول عشان الإشعارات",
    enable: "فعّل",

    navMenu: "القائمة",
    navOffers: "العروض",
    navCart: "السلة",
    navProducts: "منتجاتنا",
    productsSub: "كل المنتجات بسعر الجمهور",
    searchProductsPh: "دوّر على منتج أو شركة",
    noProducts: "مفيش منتجات لسه",
    otherProducts: "منتجات تانية",
    productOffers: "العروض اللي فيها المنتج ده",
    noProductOffers: "مفيش عروض على المنتج ده دلوقتي",
    productGone: "المنتج ده مش موجود",
    backToProducts: "ارجع للمنتجات",
    navNotif: "الإشعارات",
    navAbout: "مانجر مروة",
    back: "رجوع",

    companyLabel: "الشركة",
    companyFilter: "فلتر الشركة",
    categoryFilter: "فلتر القسم",
    allCompanies: "كل الشركات",
    tabSingle: "عروض منتج واحد",
    tabBundles: "مجموعات مشكّلة",
    kindTabs: "نوع العروض",
    all: "الكل",
    searchPh: "دوّر على عرض أو منتج أو شركة",
    reorder: "🔁 اطلب نفس طلبك اللي فات",
    noOffers: "مفيش عروض هنا دلوقتي، فعّل الإشعارات وهنبلغك أول ما ينزل عرض جديد",
    noResults: "مفيش نتايج للبحث ده",
    loadError: "مش قادرين نحمّل العروض دلوقتي، اتأكد من النت وجرّب تاني",
    notConfigured: "لسه إعدادات Firebase متحطتش في js/firebase-config.js",

    items: "{n} صنف",
    more: " و{n} كمان",
    discount: "خصم {n}%",
    badgeNew: "جديد",
    lastDay: "آخر يوم النهارده",
    endsIn: "ينتهي خلال {n} يوم",
    profit: "مكسبك لو بعت بسعر الجمهور: {x}",
    details: "التفاصيل",
    add: "أضف",
    addToCart: "أضف للسلة",
    orderWa: "اطلب على واتساب",

    offerDetails: "تفاصيل العرض",
    offerGone: "العرض ده مش موجود أو خلص",
    backToOffers: "ارجع للعروض",
    thProduct: "المنتج",
    thQty: "الكمية",
    thPublic: "سعر الجمهور",
    thOffer: "سعر العرض",
    total: "الإجمالي",
    courses: "عدد الكورسات",
    publicPrice: "سعر الجمهور",
    increase: "زوّد",
    decrease: "قلّل",
    addedQty: "اتضاف للسلة ({n}) ✅",
    added: "اتضاف للسلة ✅",

    cartTitle: "سلة الطلبات",
    cartSub: "جمّع العروض وابعتها في طلب واحد على واتساب",
    cartEmpty: "السلة فاضية",
    seeOffers: "شوف العروض",
    perCourse: "{x} للكورس",
    remove: "شيل",
    send: "ابعت الطلب",
    pharmTitle: "بيانات الصيدلية / المخزن",
    pharmLater: "هنسألك عنها أول مرة تبعت فيها طلب",
    edit: "تعديل",
    addInfo: "ضيف البيانات",
    pharmIntro: "بنسجّلها مرة واحدة على جهازك وبتتبعت مع كل طلب.",
    pharmName: "اسم الصيدلية / المخزن",
    area: "المنطقة",
    saveSend: "احفظ وابعت الطلب",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "اتحفظت البيانات ✅",
    thanks: "هيتم تسجيل طلبك ونشكر سيادتكم على ثقتك ونسعد باستمرار التعاون المثمر معك ❤️",
    ok: "تمام",
    unavailable: "العروض دي مبقتش متاحة",
    pruned1: "اتشال عرض من السلة لأنه خلص",
    prunedN: "اتشال {n} عروض من السلة لأنها خلصت",
    reorderAdded: "اتضاف طلبك اللي فات للسلة ✅",
    reorderPartial: "اتضاف {a} عرض للسلة، و{b} مبقاش متاح",

    notifTitle: "الإشعارات",
    notifSub: "هنبعتلك إشعار مع كل عرض جديد بس",
    nIosT: "ضيف التطبيق للشاشة الرئيسية الأول",
    nGrantedT: "الإشعارات شغّالة ✅",
    nGranted: "هيوصلك إشعار مع كل عرض جديد بس، ومن غير إزعاج.",
    nDefaultT: "الإشعارات مش متفعّلة",
    nDefault: "فعّلها عشان ميفوتكش أي عرض جديد.",
    nDeniedT: "الإشعارات مقفولة من المتصفح",
    nDenied: "افتح إعدادات الموقع في المتصفح (علامة القفل جنب الرابط) وخلّي الإشعارات «سماح»، وبعدين ارجع هنا.",
    nUnsupT: "المتصفح ده مش بيدعم الإشعارات",
    nUnsup: "على الآيفون: اضغط زرار المشاركة واختار «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الأيقونة وفعّل الإشعارات.",
    enableNotif: "فعّل الإشعارات",
    toastGranted: "تمام! هيوصلك إشعار مع كل عرض جديد",
    toastDenied: "الإشعارات مقفولة، تقدر تفتحها من إعدادات المتصفح",

    aboutTitle: "مانجر مروة",
    aboutSub: "تعرّف على المسؤولة عن العروض",
    tagline: "شراكة ناجحة بقيمة الثقة وأسعار تدعم تجارتكم ومكاسبكم",
    coursesTitle: "الكورسات",
    reviewsTitle: "آراء العملاء",
    reviewAlt: "رأي عميل",
    years: "خبرة {n} سنين",
    contactWa: "كلّمني على واتساب",
    aboutError: "مش قادرين نحمّل الصفحة دلوقتي، جرّب تاني",
    currency: "ج"
  },

  en: {
    appTitle: "VIP Offers for Key Customers",
    homeSub: "Top company offers for pharmacies and warehouses",
    langBtn: "ع",
    langAria: "التحويل للعربي",

    welcomeTitle: "Welcome to VIP Offers for Key Customers",
    feat1: "Nobody sees your number",
    feat2: "A notification only for each new offer",
    feat3: "Order with one tap on WhatsApp",
    welcomeBtn: "Enable notifications & see offers",
    iosNote: "On iPhone: first add the app to your home screen (Share → “Add to Home Screen”), then open it from the icon and enable notifications.",
    bannerText: "Enable notifications so you never miss an offer",
    bannerIos: "On iPhone: add the app to your home screen first to get notifications",
    enable: "Enable",

    navMenu: "Menu",
    navOffers: "Offers",
    navCart: "Cart",
    navProducts: "Our products",
    productsSub: "All products at public price",
    searchProductsPh: "Search products or companies",
    noProducts: "No products yet",
    otherProducts: "Other products",
    productOffers: "Offers that include this product",
    noProductOffers: "No offers on this product right now",
    productGone: "This product doesn't exist",
    backToProducts: "Back to products",
    navNotif: "Notifications",
    navAbout: "Manager Marwa",
    back: "Back",

    companyLabel: "Company",
    companyFilter: "Company filter",
    categoryFilter: "Category filter",
    allCompanies: "All companies",
    tabSingle: "Single-product offers",
    tabBundles: "Mixed bundles",
    kindTabs: "Offer type",
    all: "All",
    searchPh: "Search offers, products or companies",
    reorder: "🔁 Repeat your last order",
    noOffers: "No offers here right now. Enable notifications and we'll let you know as soon as a new one is out.",
    noResults: "No results for this search",
    loadError: "We couldn't load the offers right now. Check your connection and try again.",
    notConfigured: "Firebase settings are missing in js/firebase-config.js",

    items: "{n} items",
    more: ", +{n} more",
    discount: "{n}% off",
    badgeNew: "New",
    lastDay: "Last day today",
    endsIn: "Ends in {n} days",
    endsIn1: "Ends in 1 day",
    profit: "Your profit at public price: {x}",
    details: "Details",
    add: "Add",
    addToCart: "Add to cart",
    orderWa: "Order on WhatsApp",

    offerDetails: "Offer details",
    offerGone: "This offer doesn't exist or has ended",
    backToOffers: "Back to offers",
    thProduct: "Product",
    thQty: "Qty",
    thPublic: "Public price",
    thOffer: "Offer price",
    total: "Total",
    courses: "Number of courses",
    publicPrice: "Public price",
    increase: "Increase",
    decrease: "Decrease",
    addedQty: "Added to cart ({n}) ✅",
    added: "Added to cart ✅",

    cartTitle: "Order cart",
    cartSub: "Collect offers and send them in one WhatsApp order",
    cartEmpty: "Your cart is empty",
    seeOffers: "See offers",
    perCourse: "{x} per course",
    remove: "Remove",
    send: "Send order",
    pharmTitle: "Pharmacy / warehouse details",
    pharmLater: "We'll ask for them the first time you send an order",
    edit: "Edit",
    addInfo: "Add details",
    pharmIntro: "Saved once on your device and sent with every order.",
    pharmName: "Pharmacy / warehouse name",
    area: "Area",
    saveSend: "Save & send order",
    save: "Save",
    cancel: "Cancel",
    saved: "Details saved ✅",
    thanks: "Your order will be recorded. Thank you for your trust — we look forward to continuing our fruitful cooperation ❤️",
    ok: "OK",
    unavailable: "These offers are no longer available",
    pruned1: "An offer was removed from your cart because it ended",
    prunedN: "{n} offers were removed from your cart because they ended",
    reorderAdded: "Your last order was added to the cart ✅",
    reorderPartial: "{a} offers added to the cart; {b} no longer available",

    notifTitle: "Notifications",
    notifSub: "We'll only notify you about new offers",
    nIosT: "Add the app to your home screen first",
    nGrantedT: "Notifications are on ✅",
    nGranted: "You'll get a notification for each new offer only — no spam.",
    nDefaultT: "Notifications are off",
    nDefault: "Turn them on so you never miss a new offer.",
    nDeniedT: "Notifications are blocked in your browser",
    nDenied: "Open the site settings in your browser (the lock icon next to the address), set Notifications to “Allow”, then come back here.",
    nUnsupT: "This browser doesn't support notifications",
    nUnsup: "On iPhone: tap Share, choose “Add to Home Screen”, open the app from the icon and enable notifications.",
    enableNotif: "Enable notifications",
    toastGranted: "Great! You'll be notified about every new offer",
    toastDenied: "Notifications are blocked; you can allow them in your browser settings",

    aboutTitle: "Manager Marwa",
    aboutSub: "Meet the person behind the offers",
    tagline: "A successful partnership built on trust, with prices that support your business and profits",
    coursesTitle: "Courses",
    reviewsTitle: "Customer reviews",
    reviewAlt: "Customer review",
    years: "{n} years of experience",
    contactWa: "Chat with me on WhatsApp",
    aboutError: "We couldn't load this page right now. Please try again.",
    currency: "EGP"
  }
};

let lang = "ar";
try { if (localStorage.getItem(LANG_KEY) === "en") lang = "en"; } catch {}

export const getLang = () => lang;
export const isEn = () => lang === "en";

export function t(key, vars = {}) {
  if (lang === "en" && key === "endsIn" && Number(vars.n) === 1) key = "endsIn1";
  const s = STR[lang][key] ?? STR.ar[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// المبالغ: بالعربي «١٬١٧٠ ج»، وبالإنجليزي «1,170 EGP»
export function fmtMoney(v) {
  const n = Number(v);
  const val = Number.isFinite(n) ? n : 0;
  return lang === "en"
    ? `${val.toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`
    : `${val.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج`;
}

// النصوص الثابتة في الصفحة: data-i18n (النص) و data-i18n-aria / data-i18n-ph
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  document.title = t("appTitle");
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPh)));
  root.querySelectorAll("[data-lang-toggle]").forEach((el) => {
    el.textContent = t("langBtn");
    el.setAttribute("aria-label", t("langAria"));
    el.lang = lang === "en" ? "ar" : "en";
  });
}

export function toggleLang() {
  lang = lang === "en" ? "ar" : "en";
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  applyStatic();
}
