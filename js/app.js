import { isFirebaseConfigured, WHATSAPP_NUMBER } from "./firebase-config.js";
import {
  allCategories, esc, safeUrl, safeImage, num, calcTotals, offerStatus, normTitle,
  monthKey, levelInfo, sortLevels, ratingsIndex, MIN_RATINGS,
  aboutField, aboutBodyHtml, mergeItems, distinctProducts, lineQty, lineOffer, linePublic, SUGGESTION_TYPES, SUGGESTION_OTHER, SUGGESTION_MAX
} from "./utils.js";
import {
  getCart, addToCart, setQty, removeFromCart, clearCart, cartCount,
  getCustomer, saveCustomer, customerComplete, cleanPhone, PHONE_RE,
  getLastOrder, saveLastOrder, buildOrderMessage
} from "./cart.js";
import {
  initNotifications, enableNotifications, getStatus, onNotifChange, needsIOSInstall, registerAppServiceWorker,
  reloadOnNewServiceWorker
} from "./notifications.js";
import { t, isEn, fmtMoney as money, applyStatic, toggleLang } from "./i18n.js";
import { setupVoiceSearch } from "./voice.js";
import { companyIndex, offerInVip, companyVisible } from "./store-shared.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const WELCOME_KEY = "vip_welcomed";
const CACHE_KEY = "vip_offers_cache";
const PRODUCTS_KEY = "vip_products_v2";
const CATS_KEY = "vip_categories";
const NAMES_KEY = "vip_names_en";
const ALL = "__all";
const KIND_KEY = "vip_kind";
const RATINGS_KEY = "vip_ratings";
const LOYALTY_KEY = "vip_loyalty";
const LEVELS_KEY = "vip_levels";
const RATED_KEY = "vip_rated";
const COMPANIES_KEY = "vip_companies";
const APP_URL = "https://vip-offers-961c8.web.app";

const state = {
  offers: [], loaded: false, fresh: false, company: "", category: ALL, search: "",
  kind: null, // "single" = عروض منتج واحد، "bundle" = مجموعات مشكّلة
  about: null,
  products: [], productsLoaded: false, productSearch: "",
  productById: new Map(), productByName: new Map(),
  savedCategories: [],
  names: { categories: {}, companies: {} }, // الأسماء الإنجليزي للأقسام والشركات
  levels: [], levelsLoaded: false,      // مستويات برنامج المكافآت (settings/loyalty)
  bestsellers: [],                      // أكتر 5 عروض اتطلبت (settings/bestsellers)
  ratingFor: ratingsIndex([]),          // تقييمات حقيقية بس (ratings)
  loyalty: null, loyaltyLoaded: false,  // loyalty/{customerId}
  installPrompt: null,                  // beforeinstallprompt (أندرويد/كروم)
  cidx: companyIndex([])                // الشركات (companies): الظهور في VIP أو لأ
};

// ---------- تخزين محلي آمن ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const readJSON = (k, fallback) => { try { return JSON.parse(store.get(k)) ?? fallback; } catch { return fallback; } };

// ---------- Firebase (تحميل كسول) ----------
let fb = null;
async function firestore() {
  if (!isFirebaseConfigured()) throw new Error("not-configured");
  if (!fb) {
    const [{ db }, fs] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]);
    fb = { db, ...fs };
  }
  return fb;
}

// ---------- الأسماء حسب اللغة (الإنجليزي لو موجود، وإلا العربي) ----------
const str = (v) => (typeof v === "string" ? v.trim() : "");
const offerTitle = (o) => (isEn() && str(o.titleEn)) || o.name || "";
const companyName = (c) => (isEn() && str(state.names.companies[c])) || c || "";
const categoryName = (c) => (isEn() && str(state.names.categories[c])) || c || "";
// المنتج اللي في العرض: بالـ productId، ولو مش مربوط بالاسم
const productFor = (it) => state.productById.get(it.productId) || state.productByName.get(normTitle(it.name));
const productNameEn = (it) => str(it.nameEn) || str(productFor(it)?.nameEn);
const productName = (p) => (isEn() && str(p.nameEn)) || p.name || "";
const itemName = (it) => (isEn() && productNameEn(it)) || it.name || "";

// ---------- العروض ----------
// العروض المنتهية بتستخبى من العملاء تلقائياً
// والعروض أو الشركات اللي الأدمن قفلت «يظهر في VIP» بتاعها مبتظهرش هنا
const visibleOffers = () => state.offers.filter((o) => !offerStatus(o).expired && offerInVip(o, state.cidx));
const productInVip = (p) => companyVisible(state.cidx, p.company, "showVip");
const findAvailable = (id) => visibleOffers().find((o) => o.id === id) || null;

// السطور المكررة لنفس المنتج (2 × 267 + 1 × 266) بتتعرض سطر واحد بالكمية الكلية
const normalizeOffer = (o) => ({ ...o, products: mergeItems(o.products) });

async function loadOffers() {
  const cached = readJSON(CACHE_KEY, null);
  if (Array.isArray(cached)) { state.offers = cached.map(normalizeOffer); state.loaded = true; rerender(); }
  try {
    const { db, collection, getDocs, query, orderBy } = await firestore();
    const snap = await getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc")));
    // من غير نت، Firestore بيرجّع نتيجة فاضية من الكاش بتاعه بدل ما يدّي error:
    // منعتبرهاش، ونفضل على النسخة المحفوظة عندنا
    if (snap.metadata.fromCache) throw new Error("offline");
    state.offers = snap.docs.map((d) => {
      const data = d.data();
      return normalizeOffer({ id: d.id, ...data, createdAt: data.createdAt?.toMillis?.() || 0, updatedAt: undefined });
    });
    state.loaded = true;
    state.fresh = true;
    store.set(CACHE_KEY, JSON.stringify(state.offers));
    pruneCart();
  } catch (e) {
    if (e.message === "offline") console.warn("offers: offline, showing saved copy"); else console.error(e);
    if (!state.loaded) state.error = e.message === "not-configured" ? "notConfigured" : "loadError";
  }
  rerender();
  loadProducts();
  loadSettings();
}

// الأقسام اللي الأدمن ضافها + الأسماء الإنجليزي للأقسام والشركات (settings/categories و settings/names)
async function loadSettings() {
  state.savedCategories = readJSON(CATS_KEY, []);
  state.names = { categories: {}, companies: {}, ...readJSON(NAMES_KEY, {}) };
  const savedLv = readJSON(LEVELS_KEY, {});
  state.levels = sortLevels(savedLv.levels);
  state.bestsellers = Array.isArray(savedLv.bestsellers) ? savedLv.bestsellers : [];
  state.cidx = companyIndex(readJSON(COMPANIES_KEY, []));
  loadCompanies();
  try {
    const { db, doc, getDoc } = await firestore();
    const [cats, names, loyalty, best] = await Promise.all([
      getDoc(doc(db, "settings", "categories")),
      getDoc(doc(db, "settings", "names")),
      getDoc(doc(db, "settings", "loyalty")),
      getDoc(doc(db, "settings", "bestsellers"))
    ]);
    if ([cats, names, loyalty, best].some((d) => d.metadata.fromCache)) throw new Error("offline");
    state.levels = sortLevels(loyalty.exists() ? loyalty.data().levels : []);
    state.bestsellers = best.exists() && Array.isArray(best.data().offerIds) ? best.data().offerIds.slice(0, 5) : [];
    store.set(LEVELS_KEY, JSON.stringify({ levels: state.levels, bestsellers: state.bestsellers }));
    const list = cats.exists() && Array.isArray(cats.data().list) ? cats.data().list.filter((c) => typeof c === "string") : [];
    const n = names.exists() ? names.data() : {};
    state.savedCategories = list;
    state.names = {
      categories: n.categories && typeof n.categories === "object" ? n.categories : {},
      companies: n.companies && typeof n.companies === "object" ? n.companies : {}
    };
    store.set(CATS_KEY, JSON.stringify(list));
    store.set(NAMES_KEY, JSON.stringify(state.names));
  } catch (e) {
    console.warn("settings", e);
  }
  state.levelsLoaded = true;
  rerender();
}

// الشركات: اسم + هل تظهر في VIP (الشركة اللي ملهاش مستند بتظهر عادي)
async function loadCompanies() {
  try {
    const { db, collection, getDocs } = await firestore();
    const snap = await getDocs(collection(db, "companies"));
    if (snap.metadata.fromCache) throw new Error("offline");
    const list = snap.docs.map((d) => ({ name: str(d.data().name), showVip: d.data().showVip !== false }));
    state.cidx = companyIndex(list);
    store.set(COMPANIES_KEY, JSON.stringify(list));
    if (state.fresh) pruneCart();
    rerender();
  } catch (e) { console.warn("companies", e.message || e); }
}

// ---------- التقييمات (حقيقية بس: كل تقييم مربوط بطلب اتسلّم) ----------
async function loadRatings() {
  const cached = readJSON(RATINGS_KEY, null);
  if (Array.isArray(cached)) { state.ratingFor = ratingsIndex(cached); rerender(); }
  try {
    const { db, collection, getDocs } = await firestore();
    const snap = await getDocs(collection(db, "ratings"));
    if (snap.metadata.fromCache) throw new Error("offline");
    const list = snap.docs.map((d) => {
      const r = d.data();
      return {
        id: d.id, productId: str(r.productId), productName: str(r.productName), stars: num(r.stars),
        comment: r.commentHidden ? "" : str(r.comment), createdAt: r.createdAt?.toMillis?.() || 0
      };
    });
    state.ratingFor = ratingsIndex(list);
    const json = JSON.stringify(list);
    if (json.length < 1_000_000) store.set(RATINGS_KEY, json);
  } catch (e) {
    console.warn("ratings", e.message || e);
  }
  rerender();
}

// ---------- المكافآت: مستند العميل loyalty/{customerId} (بالكود بتاعه بس) ----------
async function loadLoyalty() {
  const c = getCustomer();
  if (!c) { state.loyaltyLoaded = true; rerender(); return; }
  const cached = readJSON(LOYALTY_KEY, null);
  if (cached && cached.id === c.id) { state.loyalty = cached.data; }
  try {
    const { db, doc, getDoc } = await firestore();
    const snap = await getDoc(doc(db, "loyalty", c.id));
    if (snap.metadata.fromCache) throw new Error("offline");
    const d = snap.exists() ? snap.data() : {};
    state.loyalty = {
      months: d.months && typeof d.months === "object" ? d.months : {},
      toRate: Array.isArray(d.toRate) ? d.toRate.filter((x) => x && x.orderId && x.key) : []
    };
    store.set(LOYALTY_KEY, JSON.stringify({ id: c.id, data: state.loyalty }));
  } catch (e) {
    console.warn("loyalty", e.message || e);
  }
  state.loyaltyLoaded = true;
  rerender();
}

// التقييمات المطلوبة: منتجات في طلبات اتسلّمت ولسه متقيّمتش من الجهاز ده
const ratedSet = () => new Set(readJSON(RATED_KEY, []));
function pendingRatings() {
  const done = ratedSet();
  return (state.loyalty?.toRate || []).filter((x) => !done.has(`${x.orderId}_${x.key}`));
}

// ---------- النجوم ----------
function starsHtml(avg) {
  const full = Math.round(avg);
  return `<span class="stars" aria-hidden="true">${"★".repeat(full)}<span class="off">${"★".repeat(5 - full)}</span></span>`;
}
// سطر التقييم بيظهر بس لو فيه 3 تقييمات أو أكتر (مفيش تقييمات وهمية أو افتراضية)
function ratingLine(products) {
  const r = state.ratingFor(products || []);
  if (r.count < MIN_RATINGS) return "";
  const avg = r.avg.toFixed(1);
  return `<div class="stars-line" aria-label="${esc(t("starsAria", { n: avg }))}">${starsHtml(r.avg)} <b>${avg}</b> <span class="meta">(${t("ratingsCount", { n: r.count })})</span></div>`;
}

// بعد ما العروض تتحمّل من النت: نشيل من السلة أي عرض اتمسح أو خلص
function pruneCart() {
  const gone = getCart().filter((x) => !findAvailable(x.id)).map((x) => x.id);
  if (gone.length) {
    removeFromCart(...gone);
    toast(gone.length === 1 ? t("pruned1") : t("prunedN", { n: gone.length }));
  }
}

// ---------- المنتجات (كتالوج «منتجاتنا» + صور المنتجات جوّه العروض) ----------
function itemImage(it) {
  return safeImage(it.image) || safeImage(productFor(it)?.image);
}

function setProducts(list) {
  state.products = list;
  state.productById = new Map(list.map((p) => [p.id, p]));
  state.productByName = new Map(list.map((p) => [normTitle(p.name), p]));
}

async function loadProducts() {
  if (!state.products.length) {
    const cached = readJSON(PRODUCTS_KEY, null);
    if (Array.isArray(cached) && cached.length) { setProducts(cached); state.productsLoaded = true; rerender(); }
  }
  try {
    const { db, collection, getDocs, query, orderBy } = await firestore();
    const snap = await getDocs(query(collection(db, "products"), orderBy("name")));
    if (snap.metadata.fromCache) throw new Error("offline");
    setProducts(snap.docs.map((d) => {
      const p = d.data();
      return {
        id: d.id, name: str(p.name), nameEn: str(p.nameEn), company: str(p.company), category: str(p.category),
        publicPrice: num(p.publicPrice), image: safeImage(p.image)
      };
    }));
    state.productsLoaded = true;
    // نحفظ نسخة عشان تفتح بسرعة ومن غير نت (من غير الصور المرفوعة لو الحجم كبير)
    let json = JSON.stringify(state.products);
    if (json.length > 2_000_000) json = JSON.stringify(state.products.map((p) => (p.image.startsWith("data:") ? { ...p, image: "" } : p)));
    if (json.length < 2_000_000) store.set(PRODUCTS_KEY, json);
  } catch (e) {
    console.warn("products", e.message || e);
    state.productsLoaded = true;
  }
  rerender();
}

// صورة بتتحمّل لما تقرّب تظهر على الشاشة بس (عشان التطبيق يفضل سريع)
function lazyImg(src, cls = "", alt = "", size = 200) {
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="${size}" height="${size}">`;
}

function rerender() {
  renderHome();
  const r = currentRoute();
  if (r.name === "offer") renderOffer(r.id);
  if (r.name === "cart") renderCart();
  if (r.name === "products") renderCatalog();
  if (r.name === "product") renderProduct(r.id);
  if (r.name === "rewards") renderRewards();
  if (r.name === "about" && state.about) renderAbout();
  if (r.name === "suggest") renderSuggest();
  renderHomeAlerts();
  if (r.name === "notifications") renderNotif();
  updateCartBadge();
  updateReorder();
}

// ---------- أجزاء مشتركة ----------
function badges(o) {
  const s = offerStatus(o);
  const out = [];
  if (state.bestsellers.includes(o.id)) out.push(`<span class="badge badge-best">${t("bestseller")}</span>`);
  if (s.isNew) out.push(`<span class="badge badge-new">${t("badgeNew")}</span>`);
  if (s.endingSoon) {
    const label = s.daysLeft === 0 ? t("lastDay") : t("endsIn", { n: s.daysLeft });
    out.push(`<span class="badge badge-ending">⏳ ${esc(label)}</span>`);
  }
  return out.length ? `<div class="badges">${out.join("")}</div>` : "";
}

const profitText = (amount) => t("profit", { x: money(amount) });

function thumbs(o) {
  const imgs = (o.products || []).map(itemImage).filter(Boolean);
  if (!imgs.length) return "";
  const shown = imgs.slice(0, 4);
  return `<div class="thumbs">${shown.map((src) => lazyImg(src, "", "", 58)).join("")}${imgs.length > 4 ? `<span class="more">+${imgs.length - 4}</span>` : ""}</div>`;
}

// ---------- البحث (بالعربي والإنجليزي) ----------
function haystack(o) {
  const parts = [
    o.name, o.titleEn, o.company, state.names.companies[o.company], o.category, state.names.categories[o.category],
    ...(o.products || []).flatMap((it) => [it.name, productNameEn(it)])
  ];
  return normTitle(parts.filter(Boolean).join(" | "));
}
function matchesSearch(o) {
  const words = normTitle(state.search).split(" ").filter(Boolean);
  if (!words.length) return true;
  const h = haystack(o);
  return words.every((w) => h.includes(w));
}

// ---------- الصفحة الرئيسية ----------
function renderFilters(offers) {
  const sel = $("#company-filter");
  const companies = [...new Set(offers.map((o) => o.company).filter(Boolean))]
    .sort((a, b) => companyName(a).localeCompare(companyName(b), isEn() ? "en" : "ar"));
  sel.innerHTML = `<option value="">${t("allCompanies")}</option>` +
    companies.map((c) => `<option value="${esc(c)}"${c === state.company ? " selected" : ""}>${esc(companyName(c))}</option>`).join("");

  const cats = [ALL, ...allCategories(offers, state.savedCategories)];
  $("#category-chips").innerHTML = cats.map((c) => {
    const label = c === ALL ? t("all") : categoryName(c);
    return `<button type="button" class="chip${c === state.category ? " active" : ""}" data-cat="${esc(c)}" role="tab" aria-selected="${c === state.category}">${esc(label)}</button>`;
  }).join("");
}

function offerCard(o) {
  const tt = calcTotals(o.products);
  const products = (o.products || []).map(itemName).filter(Boolean);
  const short = products.slice(0, 3).join(isEn() ? ", " : "، ") + (products.length > 3 ? t("more", { n: products.length - 3 }) : "");
  const img = safeUrl(o.imageUrl);
  return `
  <article class="offer-card">
    ${img ? `<img class="img" src="${esc(img)}" alt="" loading="lazy">` : ""}
    ${tt.discount > 0 ? `<span class="discount-badge">${t("discount", { n: tt.discount })}</span>` : ""}
    <div class="body">
      ${badges(o)}
      <div class="company"><svg><use href="#i-check"/></svg>${esc(companyName(o.company))}</div>
      <div class="meta">${esc(categoryName(o.category))} · ${t("items", { n: tt.items })}</div>
      <h2 class="offer-name">${esc(offerTitle(o))}</h2>
      ${ratingLine(o.products)}
      <p class="products-short">${esc(short)}</p>
      ${thumbs(o)}
      <div class="price-row">
        <span class="price-new">${money(tt.totalOffer)}</span>
        <span class="price-old">${money(tt.totalPublic)}</span>
      </div>
      ${tt.totalPublic > tt.totalOffer ? `<p class="profit">${esc(profitText(tt.totalPublic - tt.totalOffer))}</p>` : ""}
      <div class="card-actions">
        <a class="btn btn-purple" href="#/offer/${encodeURIComponent(o.id)}">${t("details")}</a>
        <button type="button" class="btn btn-yellow" data-add="${esc(o.id)}" aria-label="${esc(t("addToCart"))}"><svg><use href="#i-cart"/></svg>${t("add")}</button>
        <button type="button" class="btn btn-ghost icon-only" data-share="${esc(o.id)}" aria-label="${esc(t("share"))}" title="${esc(t("share"))}"><svg><use href="#i-share"/></svg></button>
      </div>
    </div>
  </article>`;
}

// عرض منتج واحد = كل سطوره نفس المنتج (بأي كمية وأي عدد سطور)، ومجموعة مشكّلة = منتجين مختلفين أو أكتر
const offerKind = (o) => (distinctProducts(o.products) >= 2 ? "bundle" : "single");

function renderKindTabs(counts) {
  $("#kind-tabs").setAttribute("aria-label", t("kindTabs"));
  $("#kind-tabs").innerHTML = [["single", "tabSingle"], ["bundle", "tabBundles"]].map(([k, key]) =>
    `<button type="button" role="tab" data-kind="${k}" class="${state.kind === k ? "active" : ""}" aria-selected="${state.kind === k}">${t(key)}<span class="count">${counts[k]}</span></button>`
  ).join("");
}

function renderHome() {
  const offers = visibleOffers();
  renderFilters(offers);
  const list = $("#offers-list");
  if (!state.kind) {
    // أول مرة: التبويب اللي اختاره العميل قبل كده، وإلا «عروض منتج واحد» لو فيها عروض
    const saved = store.get(KIND_KEY);
    if (saved === "single" || saved === "bundle") state.kind = saved;
    else if (state.loaded) state.kind = offers.some((o) => offerKind(o) === "single") ? "single" : "bundle";
  }
  const filtered = offers.filter((o) =>
    (!state.company || o.company === state.company) &&
    (state.category === ALL || o.category === state.category) &&
    matchesSearch(o)
  );
  // الأرقام على التبويبات بتتبع الفلاتر والبحث، عشان يبان لو فيه نتايج في التبويب التاني
  const counts = {
    single: filtered.filter((o) => offerKind(o) === "single").length,
    bundle: filtered.filter((o) => offerKind(o) === "bundle").length
  };
  // وإنتي بتدوّري: لو النتايج كلها في التبويب التاني ننقل عليه
  if (state.search.trim() && state.kind && !counts[state.kind]) {
    const other = state.kind === "single" ? "bundle" : "single";
    if (counts[other]) state.kind = other;
  }
  renderKindTabs(counts);
  if (!state.loaded) {
    if (state.error) list.innerHTML = `<p class="state-msg">${esc(t(state.error))}</p>`;
    return;
  }
  const items = filtered.filter((o) => offerKind(o) === (state.kind || "single"));
  list.innerHTML = items.length
    ? items.map(offerCard).join("")
    : `<p class="state-msg">${esc(state.search.trim() ? t("noResults") : t("noOffers"))}</p>`;
}

// ---------- تفاصيل العرض ----------
function renderOffer(id) {
  const body = $("#d-body");
  const o = findAvailable(id);
  if (!o) {
    $("#d-name").textContent = t("offerDetails");
    $("#d-company").textContent = "";
    body.innerHTML = state.loaded
      ? `<p class="state-msg">${t("offerGone")}</p><a class="btn btn-purple btn-block" href="#/">${t("backToOffers")}</a>`
      : `<div class="skeleton" style="margin-top:16px"></div>`;
    return;
  }
  const tt = calcTotals(o.products);
  const img = safeUrl(o.imageUrl);
  $("#d-name").textContent = offerTitle(o) || t("offerDetails");
  $("#d-company").textContent = `${companyName(o.company)} · ${categoryName(o.category)}`;

  const rows = (o.products || []).map((p) => {
    const q = lineQty(p);
    // سعر العلبة = إجمالي السطر ÷ الكمية لأقرب جنيه (الإجمالي نفسه بيفضل مظبوط)
    const unit = q > 1 ? `<small class="unit-price">${esc(t("perUnit", { x: money(Math.round(lineOffer(p) / q)) }))}</small>` : "";
    return `<tr>
      <td><div class="item-cell">${itemImage(p) ? lazyImg(itemImage(p), "", "", 44) : ""}<span>${esc(itemName(p))}${unit}</span></div></td>
      <td class="num">${q}</td>
      <td class="num old">${money(linePublic(p))}</td>
      <td class="num new">${money(lineOffer(p))}</td>
    </tr>`;
  }).join("");

  // نحافظ على الكمية لو الصفحة اترسمت تاني (بعد تحميل الصور أو تغيير اللغة)
  const prevQty = body.dataset.offerId === o.id ? Number(body.dataset.qty) || 1 : 1;
  body.dataset.offerId = o.id;
  countView(o.id);

  body.innerHTML = `
    ${img ? `<img src="${esc(img)}" alt="" style="margin-top:16px;border-radius:16px;width:100%">` : ""}
    <div class="panel">
      ${badges(o)}
      <div class="price-row" style="justify-content:space-between">
        <div class="company"><svg><use href="#i-check"/></svg>${esc(companyName(o.company))}</div>
        ${tt.discount > 0 ? `<span class="discount-badge" style="position:static">${t("discount", { n: tt.discount })}</span>` : ""}
      </div>
      <div class="table-wrap">
        <table class="items">
          <thead><tr><th>${t("thProduct")}</th><th>${t("thQty")}</th><th>${t("thPublic")}</th><th>${t("thOffer")}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td>${t("total")}</td><td class="num">${tt.items}</td>
            <td class="num old">${money(tt.totalPublic)}</td>
            <td class="num new">${money(tt.totalOffer)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="stepper-row">
        <b>${t("courses")}</b>
        <div class="stepper">
          <button type="button" data-step="1" aria-label="${esc(t("increase"))}">+</button>
          <output id="qty" aria-live="polite">1</output>
          <button type="button" data-step="-1" aria-label="${esc(t("decrease"))}">−</button>
        </div>
      </div>
      <div class="summary">
        <div><span>${t("publicPrice")}</span><span class="price-old" id="s-public"></span></div>
        <div class="total"><span>${t("total")}</span><span id="s-total"></span></div>
      </div>
      <p class="profit" id="s-profit" style="margin:12px 0 0"></p>
    </div>
    <div class="form-grid" style="margin-top:16px">
      <button type="button" id="add-cart-btn" class="btn btn-yellow btn-block"><svg><use href="#i-cart"/></svg>${t("addToCart")}</button>
      <button type="button" id="wa-btn" class="btn btn-green btn-block"><svg><use href="#i-wa"/></svg>${t("orderWa")}</button>
      <button type="button" class="btn btn-ghost btn-block" data-share="${esc(o.id)}"><svg><use href="#i-share"/></svg>${t("share")}</button>
    </div>`;

  let qty = prevQty;
  const update = () => {
    body.dataset.qty = qty;
    $("#qty").textContent = qty;
    $("#s-public").textContent = money(tt.totalPublic * qty);
    $("#s-total").textContent = money(tt.totalOffer * qty);
    $("#s-profit").textContent = profitText((tt.totalPublic - tt.totalOffer) * qty);
  };
  $$("[data-step]", body).forEach((b) => b.addEventListener("click", () => {
    qty = Math.min(999, Math.max(1, qty + Number(b.dataset.step)));
    update();
  }));
  $("#add-cart-btn").addEventListener("click", () => {
    addToCart(o.id, qty);
    toast(t("addedQty", { n: qty }));
  });
  $("#wa-btn").addEventListener("click", () => startOrder([{ id: o.id, qty }], false));
  update();
}

// ---------- منتجاتنا ----------
function productMatches(p, q) {
  const words = normTitle(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const h = normTitle([p.name, p.nameEn, p.company, state.names.companies[p.company], p.category, state.names.categories[p.category]].filter(Boolean).join(" | "));
  return words.every((w) => h.includes(w));
}

function productCard(p) {
  const img = safeImage(p.image);
  return `
  <a class="product-card" href="#/product/${encodeURIComponent(p.id)}">
    <div class="pimg">${img ? lazyImg(img, "", productName(p), 200) : `<svg width="40" height="40"><use href="#i-gift"/></svg>`}</div>
    <div class="pbody">
      <b>${esc(productName(p))}</b>
      <span class="meta">${esc(companyName(p.company))}</span>
      ${num(p.publicPrice) ? `<span class="pprice">${money(p.publicPrice)}</span>` : ""}
    </div>
  </a>`;
}

function renderCatalog() {
  const body = $("#catalog-body");
  if (!state.productsLoaded) { body.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`; return; }
  const list = state.products.filter((p) => productInVip(p) && productMatches(p, state.productSearch));
  if (!list.length) {
    body.innerHTML = `<p class="state-msg">${state.productSearch.trim() ? t("noResults") : t("noProducts")}</p>`;
    return;
  }
  // متجمّعين حسب القسم بنفس ترتيب الأقسام، والمنتجات من غير قسم في الآخر
  const order = allCategories(state.products, state.savedCategories);
  const groups = new Map(order.map((c) => [c, []]));
  const other = [];
  for (const p of list) (groups.get(p.category) || other).push(p);
  const sections = [...groups.entries()].filter(([, ps]) => ps.length);
  if (other.length) sections.push(["", other]);
  body.innerHTML = sections.map(([c, ps]) => `
    <section class="cat-section">
      <h2 class="section-title">${esc(c ? categoryName(c) : t("otherProducts"))} <span class="meta">(${ps.length})</span></h2>
      <div class="product-grid">${ps.map(productCard).join("")}</div>
    </section>`).join("");
}

function offersWithProduct(p) {
  const key = normTitle(p.name);
  return visibleOffers().filter((o) => (o.products || []).some((it) => it.productId === p.id || normTitle(it.name) === key));
}

function renderProduct(id) {
  const body = $("#product-body");
  const p = state.productById.get(id);
  if (!p || !productInVip(p)) {
    $("#p-title").textContent = t("navProducts");
    $("#p-sub").textContent = "";
    body.innerHTML = state.productsLoaded
      ? `<p class="state-msg">${t("productGone")}</p><a class="btn btn-purple btn-block" href="#/products">${t("backToProducts")}</a>`
      : `<div class="skeleton" style="margin-top:16px"></div>`;
    return;
  }
  const img = safeImage(p.image);
  const offers = offersWithProduct(p);
  $("#p-title").textContent = productName(p);
  $("#p-sub").textContent = [companyName(p.company), p.category ? categoryName(p.category) : ""].filter(Boolean).join(" · ");
  body.innerHTML = `
    <div class="panel product-hero">
      ${img ? lazyImg(img, "big", productName(p), 400) : ""}
      <h2>${esc(productName(p))}</h2>
      ${isEn() && p.nameEn && p.name ? `<p class="meta" lang="ar" dir="rtl">${esc(p.name)}</p>` : ""}
      <div class="company" style="justify-content:center"><svg><use href="#i-check"/></svg>${esc(companyName(p.company))}</div>
      ${num(p.publicPrice) ? `<p class="pprice big">${t("publicPrice")}: ${money(p.publicPrice)}</p>` : ""}
      ${ratingLine([{ productId: p.id, name: p.name }])}
    </div>
    ${productReviews(p)}
    <h2 class="section-title" style="margin-top:18px">${t("productOffers")} <span class="meta">(${offers.length})</span></h2>
    ${offers.length
      ? `<div class="offers-list">${offers.map(offerCard).join("")}</div>`
      : `<p class="state-msg">${t("noProductOffers")}</p>`}`;
}

// ---------- السلة ----------
function cartLines() {
  return getCart().map((x) => {
    const o = findAvailable(x.id);
    if (!o) return null;
    const tt = calcTotals(o.products);
    return { id: o.id, qty: x.qty, offer: o, unitPrice: tt.totalOffer, unitPublic: tt.totalPublic };
  }).filter(Boolean);
}

function renderCart() {
  const body = $("#cart-body");
  const pharm = getCustomer();
  const pharmBox = `
    <div class="panel pharm-box">
      <div class="info">
        ${pharm
          ? `<b>🏪 ${esc(pharm.name)}</b><div class="meta">📍 ${esc(pharm.area)}${pharm.phone ? ` · 📞 <span dir="ltr">${esc(pharm.phone)}</span>` : ""}</div>`
          : `<b>${t("pharmTitle")}</b><div class="meta">${t("pharmLater")}</div>`}
      </div>
      <button type="button" class="btn btn-sm btn-ghost" data-edit-pharm>${pharm ? t("edit") : t("addInfo")}</button>
    </div>`;
  const reorderBtn = `<button type="button" class="btn btn-ghost btn-block" data-reorder hidden style="margin-top:16px">${t("reorder")}</button>`;

  if (!state.loaded) { body.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`; return; }
  const lines = cartLines();
  if (!lines.length) {
    body.innerHTML = `
      ${reorderBtn}
      <div class="panel state-msg">
        <svg width="56" height="56" style="color:var(--purple)"><use href="#i-cart"/></svg>
        <p style="margin:8px 0 14px">${t("cartEmpty")}</p>
        <a class="btn btn-purple btn-block" href="#/">${t("seeOffers")}</a>
      </div>
      ${pharmBox}`;
    updateReorder();
    return;
  }

  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const profit = lines.reduce((s, l) => s + l.qty * (l.unitPublic - l.unitPrice), 0);
  body.innerHTML = `
    <div class="panel">
      ${lines.map((l) => {
        const img = (l.offer.products || []).map(itemImage).find(Boolean);
        return `
        <div class="cart-item">
          <div class="top">
            ${img ? lazyImg(img, "thumb", "", 56) : ""}
            <div class="info">
              <b>${esc(offerTitle(l.offer))}</b>
              <div class="meta">${esc(companyName(l.offer.company))} · ${t("perCourse", { x: money(l.unitPrice) })}</div>
            </div>
            <button type="button" class="remove-btn" data-remove="${esc(l.id)}">${t("remove")}</button>
          </div>
          <div class="line">
            <div class="stepper sm">
              <button type="button" data-cart-step="1" data-id="${esc(l.id)}" aria-label="${esc(t("increase"))}">+</button>
              <output>${l.qty}</output>
              <button type="button" data-cart-step="-1" data-id="${esc(l.id)}" aria-label="${esc(t("decrease"))}">−</button>
            </div>
            <span class="price-new" style="font-size:20px">${money(l.qty * l.unitPrice)}</span>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="panel">
      <div class="grand"><span>${t("total")}</span><span>${money(total)}</span></div>
      ${profit > 0 ? `<p class="profit" style="margin:10px 0 0">${esc(profitText(profit))}</p>` : ""}
    </div>
    ${pharmBox}
    <button type="button" id="send-order" class="btn btn-green btn-block" style="margin-top:16px"><svg><use href="#i-wa"/></svg>${t("send")}</button>
    ${reorderBtn}`;
  $("#send-order").addEventListener("click", () => startOrder(getCart(), true));
  updateReorder();
}

function updateCartBadge() {
  const n = cartCount();
  const el = $("#cart-count");
  el.hidden = n === 0;
  el.textContent = n > 99 ? "99+" : n;
}

// ---------- إرسال الطلب ----------
// items: [{ id, qty }] — fromCart: لو الطلب من السلة نفضّيها بعد الإرسال
function startOrder(items, fromCart) {
  const available = items.filter((x) => findAvailable(x.id));
  if (!available.length) { toast(t("unavailable")); return; }
  const c = getCustomer();
  if (customerComplete(c)) sendOrder(available, fromCart, c);
  else openPharmacyModal((p) => sendOrder(available, fromCart, p), true);
}

function openWhatsApp(text) {
  const a = document.createElement("a");
  a.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// رسالة الطلب بالعربي دايماً (بالأسماء العربي) مهما كانت لغة الواجهة
function sendOrder(items, fromCart, customer) {
  const lines = items.map((x) => {
    const o = findAvailable(x.id);
    const tt = calcTotals(o.products);
    return {
      offerId: o.id, name: o.name, company: o.company, qty: x.qty, unitPrice: tt.totalOffer, unitPublic: tt.totalPublic,
      products: (o.products || []).filter((p) => p && p.name).map((p) => ({ productId: str(p.productId), name: str(p.name) }))
    };
  });
  // واتساب الأول (لازم في نفس الضغطة)، وبعدين نسجّل الطلب في Firestore
  openWhatsApp(buildOrderMessage(customer, lines));
  const orderId = saveOrder(customer, lines);
  saveLastOrder(items, orderId);
  if (fromCart) clearCart();
  rerender();
  showThanks();
}

// سجل الطلبات: orders (الأدمن بس يقدر يقراه). لو النت فاصل بيتبعت لما يرجع طول ما الصفحة مفتوحة
function saveOrder(customer, lines) {
  const data = (fs) => ({
    customerId: customer.id, name: customer.name.slice(0, 100), area: customer.area.slice(0, 100), phone: customer.phone,
    items: lines.slice(0, 50),
    total: lines.reduce((s, l) => s + l.qty * l.unitPrice, 0),
    totalPublic: lines.reduce((s, l) => s + l.qty * l.unitPublic, 0),
    itemsCount: lines.reduce((s, l) => s + l.qty, 0),
    status: "جديد", createdAt: fs.serverTimestamp(), lang: isEn() ? "en" : "ar"
  });
  if (fb) {
    const ref = fb.doc(fb.collection(fb.db, "orders"));
    fb.setDoc(ref, data(fb)).catch((e) => console.warn("order not saved", e));
    return ref.id;
  }
  firestore().then((f) => f.addDoc(f.collection(f.db, "orders"), data(f))).catch((e) => console.warn("order not saved", e));
  return "";
}

// عدّاد المشاهدات: مرة واحدة لكل عرض في الجلسة (زيادة 1 في views/{offerId})
function countView(offerId) {
  const key = "vip_viewed_" + offerId;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { return; }
  firestore().then(({ db, doc, setDoc, increment }) =>
    setDoc(doc(db, "views", offerId), { count: increment(1) }, { merge: true })).catch(() => {});
}

// ---------- مشاركة عرض مع زميل ----------
async function shareOffer(id) {
  const o = findAvailable(id);
  if (!o) return;
  const tt = calcTotals(o.products);
  const url = `${APP_URL}/#/offer/${encodeURIComponent(o.id)}`;
  const text = t("shareText", { title: offerTitle(o), company: companyName(o.company), price: money(tt.totalOffer), old: money(tt.totalPublic) });
  if (navigator.share) {
    try { await navigator.share({ title: offerTitle(o), text, url }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = `https://wa.me/?text=${encodeURIComponent(text + " " + url)}`;
  a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------- تثبيت التطبيق ----------
const isStandaloneApp = () => window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
const isIOSDevice = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const canInstall = () => !isStandaloneApp() && (!!state.installPrompt || isIOSDevice());

async function installApp() {
  if (state.installPrompt) {
    const p = state.installPrompt;
    state.installPrompt = null;
    p.prompt();
    try { await p.userChoice; } catch {}
    renderHomeAlerts();
    return;
  }
  openModal(`
    <h2>${t("installIosTitle")}</h2>
    <ol class="steps"><li>${t("installIos1")}</li><li>${t("installIos2")}</li><li>${t("installIos3")}</li></ol>
    <button type="button" class="btn btn-purple btn-block" data-close>${t("ok")}</button>`);
}

// ---------- الصفحة الرئيسية: زرار التثبيت + طلب التقييم ----------
function renderHomeAlerts() {
  const box = $("#home-alerts");
  const parts = [];
  const pending = pendingRatings();
  let laterDismissed = false;
  try { laterDismissed = sessionStorage.getItem("vip_rate_later") === "1"; } catch {}
  if (pending.length && !laterDismissed) {
    parts.push(`
      <div class="alert-card">
        <div class="grow"><b>${t("rateTitle")}</b><div class="meta">${t("rateSub")}</div></div>
        <button type="button" class="btn btn-sm btn-yellow" data-rate>${t("rateNow")}</button>
      </div>`);
  }
  if (canInstall()) {
    parts.push(`<button type="button" class="btn btn-ghost btn-block install-btn" data-install>${t("install")}</button>`);
  }
  box.innerHTML = parts.join("");
}

// ---------- التقييم ----------
function openRatingModal() {
  const items = pendingRatings();
  if (!items.length) return;
  const m = openModal(`
    <h2>${t("rateModalTitle")}</h2>
    <p>${t("rateSub")}</p>
    <form class="form-grid rate-form">
      ${items.map((it, i) => {
        const p = state.productById.get(it.productId) || state.productByName.get(normTitle(it.name));
        const img = p ? safeImage(p.image) : "";
        const name = (p && isEn() && p.nameEn) || it.name;
        return `
        <div class="rate-item" data-i="${i}">
          <div class="rate-head">${img ? lazyImg(img, "thumb", "", 48) : ""}<b>${esc(name)}</b></div>
          <div class="star-pick" role="radiogroup" aria-label="${esc(name)}">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" data-star="${n}" aria-label="${esc(t("starsAria", { n }))}">★</button>`).join("")}
          </div>
          <textarea class="textarea" maxlength="500" rows="2" placeholder="${esc(t("commentPh"))}"></textarea>
        </div>`;
      }).join("")}
      <p class="error" hidden></p>
      <button type="submit" class="btn btn-purple btn-block">${t("sendRatings")}</button>
      <button type="button" class="btn btn-ghost btn-block" data-close>${t("later")}</button>
    </form>`);
  const chosen = new Map();
  m.addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]");
    if (!b) return;
    const box = b.closest(".rate-item");
    const n = Number(b.dataset.star);
    chosen.set(Number(box.dataset.i), n);
    $$("[data-star]", box).forEach((x) => {
      x.classList.toggle("on", Number(x.dataset.star) <= n);
      x.setAttribute("aria-checked", String(Number(x.dataset.star) === n));
    });
  });
  $("form", m).addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".error", m);
    if (!chosen.size) { err.hidden = false; err.textContent = t("pickStars"); return; }
    const btn = $('button[type="submit"]', m);
    btn.disabled = true;
    const { db, doc, setDoc, serverTimestamp } = await firestore();
    const done = new Set(readJSON(RATED_KEY, []));
    await Promise.allSettled([...chosen.entries()].map(async ([i, stars]) => {
      const it = items[i];
      const id = `${it.orderId}_${it.key}`;
      const comment = $(`.rate-item[data-i="${i}"] textarea`, m).value.trim().slice(0, 500);
      const data = { orderId: it.orderId, productKey: it.key, productId: it.productId || "", productName: String(it.name || "").slice(0, 200), stars, createdAt: serverTimestamp() };
      if (comment) data.comment = comment;
      try { await setDoc(doc(db, "ratings", id), data); done.add(id); }
      catch (e2) { if (e2.code === "permission-denied") done.add(id); else throw e2; } // اتقيّم قبل كده
    }));
    store.set(RATED_KEY, JSON.stringify([...done]));
    m.remove();
    toast(t("ratingsThanks"));
    loadRatings();
    renderHomeAlerts();
  });
}

// تعليقات المنتج (بتظهر بس لو فيه 3 تقييمات أو أكتر)
function productReviews(p) {
  const r = state.ratingFor([{ productId: p.id, name: p.name }]);
  if (r.count < MIN_RATINGS) return "";
  const withText = r.list.filter((x) => x.comment).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  if (!withText.length) return "";
  return `
    <div class="panel">
      <h3 class="section-title">${t("productRatings")}</h3>
      <div class="reviews-list">${withText.map((x) => `
        <div class="review"><div>${starsHtml(x.stars)}</div><p>${esc(x.comment)}</p></div>`).join("")}
      </div>
    </div>`;
}

// ---------- صفحة المكافآت ----------
function monthLabel(key) {
  const [y, mo] = key.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(isEn() ? "en-US" : "ar-EG", { month: "long", year: "numeric" });
}

function renderRewards() {
  const body = $("#rewards-body");
  if (!state.levelsLoaded || !state.loyaltyLoaded) { body.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`; return; }
  const levels = state.levels;
  const months = state.loyalty?.months || {};
  const cur = monthKey();
  const total = Math.max(0, num(months[cur]));
  const hasHistory = Object.values(months).some((v) => num(v) > 0);
  const info = levelInfo(total, levels);
  const parts = [];

  if (!levels.length) {
    parts.push(`<div class="panel state-msg"><svg width="56" height="56" style="color:var(--purple)"><use href="#i-gift"/></svg><p>${t("noLevels")}</p></div>`);
  } else if (!hasHistory) {
    // لسه مفيش طلبات اتسلّمت: نعرض المستويات ونشجّعه
    parts.push(`
      <div class="panel rewards-hero">
        <svg width="56" height="56"><use href="#i-gift"/></svg>
        <p>${t("rewardsIntro")}</p>
        <a class="btn btn-purple btn-block" href="#/">${t("seeOffers")}</a>
      </div>`);
  } else {
    parts.push(`
      <div class="panel rewards-hero">
        <div class="meta">${t("thisMonth")} · ${esc(monthLabel(cur))}</div>
        <div class="level-name">${info.current ? `🏆 ${esc(info.current.name)}` : esc(t("noLevelYet"))}</div>
        ${info.current && info.current.reward ? `<div class="reward-box">🎁 ${t("rewardLabel")}: ${esc(info.current.reward)}</div>` : ""}
        <p class="meta" style="margin:10px 0 6px">${esc(t("confirmedTotal", { x: money(total) }))}</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(info.progress * 100)}">
          <span style="width:${Math.round(info.progress * 100)}%"></span>
        </div>
        <p class="next-text">${info.next ? esc(t("nextLevel", { x: money(info.remaining), name: info.next.name })) : esc(t("topLevel"))}</p>
      </div>`);
  }

  if (levels.length) {
    parts.push(`
      <h2 class="section-title" style="margin-top:18px">${t("levelsTitle")}</h2>
      <div class="levels">${levels.map((l) => `
        <div class="level-card${info.current && info.current.name === l.name && hasHistory ? " current" : ""}">
          <b>🏆 ${esc(l.name)}</b>
          <div class="meta">${esc(t("monthlyTarget", { x: money(l.target) }))}</div>
          ${l.reward ? `<div class="reward">🎁 ${esc(l.reward)}</div>` : ""}
        </div>`).join("")}
      </div>`);
  }

  const past = Object.entries(months).filter(([k, v]) => k < cur && num(v) > 0).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  if (past.length) {
    parts.push(`
      <h2 class="section-title" style="margin-top:18px">${t("historyTitle")}</h2>
      <div class="panel history">${past.map(([k, v]) => {
        const lv = levelInfo(num(v), levels).current;
        return `<div class="history-row"><span>${esc(monthLabel(k))}</span><span>${money(num(v))}</span><span class="meta">${lv ? "🏆 " + esc(lv.name) : "—"}</span></div>`;
      }).join("")}</div>`);
  }
  if (levels.length) parts.push(`<p class="meta" style="margin-top:12px">${t("countsNote")}</p>`);
  body.innerHTML = parts.join("");
}

// ---------- نوافذ ----------
function openModal(html) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); });
  document.body.appendChild(m);
  return m;
}

function openPharmacyModal(onSaved, sending = false) {
  const p = getCustomer() || { name: "", area: "", phone: "" };
  const m = openModal(`
    <h2>${t("pharmTitle")}</h2>
    <p>${t("pharmIntro")}</p>
    <form class="form-grid">
      <div class="field"><label for="ph-name">${t("pharmName")}</label><input id="ph-name" class="input" required value="${esc(p.name)}" autocomplete="organization"></div>
      <div class="field"><label for="ph-area">${t("area")}</label><input id="ph-area" class="input" required value="${esc(p.area)}"></div>
      <div class="field"><label for="ph-phone">${t("phone")}</label><input id="ph-phone" class="input" type="tel" inputmode="tel" dir="ltr" required autocomplete="tel" value="${esc(p.phone)}" placeholder="01xxxxxxxxx"></div>
      <p class="error" id="ph-error" hidden></p>
      <button type="submit" class="btn ${sending ? "btn-green" : "btn-purple"} btn-block">${sending ? `<svg><use href="#i-wa"/></svg>${t("saveSend")}` : t("save")}</button>
      <button type="button" class="btn btn-ghost btn-block" data-close>${t("cancel")}</button>
    </form>`);
  $("#ph-name", m).focus();
  $("form", m).addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#ph-name", m).value.trim();
    const area = $("#ph-area", m).value.trim();
    const phone = cleanPhone($("#ph-phone", m).value);
    if (!name || !area) return;
    if (!PHONE_RE.test(phone) || phone.replace(/\D/g, "").length < 8) {
      const err = $("#ph-error", m); err.hidden = false; err.textContent = t("phoneInvalid");
      return;
    }
    const isNew = !getCustomer();
    saveCustomer(name, area, phone);
    if (isNew) loadLoyalty();
    m.remove();
    if (onSaved) onSaved(getCustomer());
    else { renderCart(); toast(t("saved")); }
  });
}

function showThanks() {
  openModal(`
    <div class="thanks">
      <p>${t("thanks")}</p>
      <button type="button" class="btn btn-purple btn-block" data-close>${t("ok")}</button>
    </div>`);
}

// ---------- اطلب نفس طلبك اللي فات ----------
function reorderItems() {
  const last = getLastOrder();
  return last ? last.items.filter((x) => findAvailable(x.id)) : [];
}
function updateReorder() {
  const show = state.loaded && reorderItems().length > 0;
  $$("[data-reorder]").forEach((b) => { b.hidden = !show; });
}
function reorder() {
  const last = getLastOrder();
  const items = reorderItems();
  if (!items.length) { updateReorder(); return; }
  items.forEach((x) => addToCart(x.id, x.qty));
  const missing = (last?.items.length || 0) - items.length;
  toast(missing > 0 ? t("reorderPartial", { a: items.length, b: missing }) : t("reorderAdded"));
  if (currentRoute().name === "cart") renderCart(); else location.hash = "#/cart";
}

// ---------- مانجر مروة ----------
function whatsappLink(text) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

async function loadAbout() {
  const body = $("#about-body");
  try {
    const { db, doc, getDoc } = await firestore();
    const snap = await getDoc(doc(db, "settings", "about"));
    state.about = snap.exists() ? snap.data() : {};
  } catch (e) {
    console.error(e);
    body.innerHTML = `<p class="state-msg">${t("aboutError")}</p>`;
    return;
  }
  renderAbout();
}

// المحتوى بالعربي والإنجليزي بيتكتب من لوحة الأدمن (وفيه محتوى افتراضي لحد ما يتحفظ)
function renderAbout() {
  const a = state.about || {};
  // في الإنجليزي: الحقل الإنجليزي لو مكتوب، وإلا العربي
  const f = (k) => String((isEn() && str(aboutField(a, k + "En"))) || aboutField(a, k) || "").trim();
  const photo = safeUrl(aboutField(a, "photoUrl"));
  const reviews = (aboutField(a, "reviews") || []).map(safeUrl).filter(Boolean);
  const name = f("name") || t("aboutTitle");
  const title = f("title");
  const tag = $("#about-tagline");
  tag.textContent = f("tagline");
  tag.hidden = !tag.textContent;
  const body = aboutBodyHtml(f("body"));
  $("#about-body").innerHTML = `
    <div class="panel about-hero">
      ${photo ? `<img class="avatar" src="${esc(photo)}" alt="${esc(name)}">` : `<div class="avatar" style="display:grid;place-items:center;color:var(--purple)"><svg width="64" height="64"><use href="#i-user"/></svg></div>`}
      <h2>${esc(name)}</h2>
      ${title ? `<p class="about-title" dir="auto">${esc(title)}</p>` : ""}
    </div>
    ${body ? `<div class="panel about-text">${body}</div>` : ""}
    ${reviews.length ? `<div class="panel"><h3 class="section-title">${t("reviewsTitle")}</h3><div class="reviews">${reviews.map((r) => `<img src="${esc(r)}" alt="${esc(t("reviewAlt"))}" loading="lazy" data-zoom>`).join("")}</div></div>` : ""}
    <a class="btn btn-green btn-block" style="margin-top:16px" target="_blank" rel="noopener"
       href="${whatsappLink("أهلاً، عايز أستفسر عن العروض")}"><svg><use href="#i-wa"/></svg>${t("contactWa")}</a>
    <a class="btn btn-ghost btn-block" style="margin-top:10px" href="#/suggest">💡 ${t("suggestHave")}</a>`;
}

// ---------- الاقتراحات ----------
const SUGGEST_TYPE_KEYS = { "اقتراح عرض": "offer", "منتج جديد": "product", "ملاحظة": "note" };
const suggestDraft = { type: SUGGESTION_TYPES[0], company: "", other: "", text: "", name: null, phone: null };

function suggestCompanies() {
  const set = new Set([...state.offers, ...state.products].map((x) => str(x.company)).filter(Boolean));
  return [...set].sort((a, b) => companyName(a).localeCompare(companyName(b), isEn() ? "en" : "ar"));
}

function readSuggestForm(box) {
  if (!$("#sg-text", box)) return;
  suggestDraft.type = $("[name=sg-type]:checked", box)?.value || suggestDraft.type;
  suggestDraft.company = $("#sg-company", box).value;
  suggestDraft.other = $("#sg-other", box).value;
  suggestDraft.text = $("#sg-text", box).value;
  suggestDraft.name = $("#sg-name", box).value;
  suggestDraft.phone = $("#sg-phone", box).value;
}

function renderSuggest() {
  const box = $("#suggest-body");
  readSuggestForm(box); // نحافظ على اللي اتكتب لو اللغة اتغيّرت
  const c = getCustomer() || {};
  const d = suggestDraft;
  const name = d.name ?? c.name ?? "";
  const phone = d.phone ?? c.phone ?? "";
  const companies = suggestCompanies();
  if (d.company && d.company !== SUGGESTION_OTHER && !companies.includes(d.company)) companies.push(d.company);
  const k = SUGGEST_TYPE_KEYS[d.type] || "note";
  box.innerHTML = `
    <form class="panel form-grid suggest-form" novalidate>
      <fieldset class="field">
        <legend class="label">${t("sType")}</legend>
        <div class="seg seg-3" role="radiogroup">${SUGGESTION_TYPES.map((ty) => `
          <label class="seg-opt${ty === d.type ? " active" : ""}"><input type="radio" name="sg-type" value="${esc(ty)}"${ty === d.type ? " checked" : ""}>${esc(t("sType_" + SUGGEST_TYPE_KEYS[ty]))}</label>`).join("")}
        </div>
      </fieldset>
      <div class="field"><label for="sg-company">${t("sCompany")}</label>
        <select id="sg-company" class="select">
          <option value="">${t("sCompanyNone")}</option>
          ${companies.map((co) => `<option value="${esc(co)}"${co === d.company ? " selected" : ""}>${esc(companyName(co))}</option>`).join("")}
          <option value="${SUGGESTION_OTHER}"${d.company === SUGGESTION_OTHER ? " selected" : ""}>${t("sOther")}</option>
        </select>
        <input id="sg-other" class="input" style="margin-top:8px" maxlength="100" placeholder="${esc(t("sOtherName"))}" value="${esc(d.other)}"${d.company === SUGGESTION_OTHER ? "" : " hidden"}>
      </div>
      <div class="field"><label for="sg-text">${t("sText")} *</label>
        <textarea id="sg-text" class="textarea" required maxlength="${SUGGESTION_MAX}" placeholder="${esc(t("sPh_" + k))}">${esc(d.text)}</textarea>
        <div class="suggest-hint"><span>${t("sNote")}</span><span class="meta" id="sg-count" dir="ltr">${d.text.length}/${SUGGESTION_MAX}</span></div>
      </div>
      <div class="field"><label for="sg-name">${t("pharmName")}</label><input id="sg-name" class="input" maxlength="100" autocomplete="organization" value="${esc(name)}"></div>
      <div class="field"><label for="sg-phone">${t("phone")}</label><input id="sg-phone" class="input" type="tel" inputmode="tel" dir="ltr" autocomplete="tel" placeholder="01xxxxxxxxx" value="${esc(phone)}"></div>
      <p class="error" id="sg-error" hidden></p>
      <button type="submit" class="btn btn-purple btn-block">💡 ${t("sSend")}</button>
    </form>`;
}

function resetSuggestDraft() {
  Object.assign(suggestDraft, { type: SUGGESTION_TYPES[0], company: "", other: "", text: "", name: null, phone: null });
}

async function sendSuggestion(form) {
  const err = $("#sg-error", form);
  const fail = (msg) => { err.hidden = false; err.textContent = msg; };
  err.hidden = true;
  readSuggestForm(form);
  const d = suggestDraft;
  const text = d.text.trim();
  if (!text) { fail(t("sTextRequired")); $("#sg-text", form).focus(); return; }
  const phone = cleanPhone(d.phone || "");
  if (phone && (!PHONE_RE.test(phone) || phone.replace(/\D/g, "").length < 8)) { fail(t("phoneInvalid")); return; }
  const company = d.company === SUGGESTION_OTHER ? (d.other.trim() || SUGGESTION_OTHER) : d.company;
  const c = getCustomer();
  const btn = $("button[type=submit]", form);
  btn.disabled = true;
  try {
    const { db, collection, addDoc, serverTimestamp } = await firestore();
    const data = {
      type: d.type, company: company.slice(0, 100), text: text.slice(0, SUGGESTION_MAX),
      name: String(d.name || "").trim().slice(0, 100), phone,
      status: "جديد", createdAt: serverTimestamp(), lang: isEn() ? "en" : "ar"
    };
    if (c?.id) data.customerId = c.id;
    if (c?.area) data.area = c.area.slice(0, 100);
    await addDoc(collection(db, "suggestions"), data);
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    fail(t("sError"));
    return;
  }
  resetSuggestDraft();
  $("#suggest-body").innerHTML = "";
  renderSuggest();
  openModal(`
    <div class="thanks">
      <div class="heart">🌟</div>
      <p>${t("sThanks")}</p>
      <button type="button" class="btn btn-purple btn-block" data-close>${t("ok")}</button>
    </div>`);
}

$("#suggest-body").addEventListener("change", (e) => {
  const box = $("#suggest-body");
  if (e.target.name === "sg-type") {
    readSuggestForm(box);
    $$(".seg-opt", box).forEach((l) => l.classList.toggle("active", $("input", l).checked));
    $("#sg-text", box).placeholder = t("sPh_" + (SUGGEST_TYPE_KEYS[suggestDraft.type] || "note"));
  }
  if (e.target.id === "sg-company") {
    const other = $("#sg-other", box);
    other.hidden = e.target.value !== SUGGESTION_OTHER;
    if (!other.hidden) other.focus();
  }
});
$("#suggest-body").addEventListener("input", (e) => {
  if (e.target.id === "sg-text") $("#sg-count").textContent = `${e.target.value.length}/${SUGGESTION_MAX}`;
});
$("#suggest-body").addEventListener("submit", (e) => { e.preventDefault(); sendSuggestion(e.target); });

// ---------- الإشعارات ----------
function renderNotif(status = getStatus()) {
  const banner = $("#notif-banner");
  banner.hidden = !["default", "denied", "ios-install"].includes(status) || !store.get(WELCOME_KEY);
  banner.querySelector("span").textContent = status === "ios-install" ? t("bannerIos") : t("bannerText");
  banner.querySelector("button").hidden = status === "ios-install";
  const box = $("#notif-status");
  const map = {
    "ios-install": [t("nIosT"), t("iosNote"), ""],
    granted: [t("nGrantedT"), t("nGranted"), ""],
    default: [t("nDefaultT"), t("nDefault"), `<button class="btn btn-yellow btn-block" data-enable-notif>${t("enableNotif")}</button>`],
    denied: [t("nDeniedT"), t("nDenied"), ""],
    unsupported: [t("nUnsupT"), t("nUnsup"), ""]
  };
  const [title, text, action] = map[status] || map.default;
  box.innerHTML = `<svg class="big-icon"><use href="#i-bell"/></svg><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}`;
}

// ---------- التنقل ----------
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("offer/")) return { name: "offer", id: decodeURIComponent(h.slice(6)) };
  if (h.startsWith("product/")) return { name: "product", id: decodeURIComponent(h.slice(8)) };
  if (["notifications", "about", "cart", "products", "rewards", "suggest"].includes(h)) return { name: h };
  return { name: "home" };
}

function route() {
  const r = currentRoute();
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${r.name}`).classList.add("active");
  $$("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === r.name ||
      (r.name === "offer" && a.dataset.nav === "home") || (r.name === "product" && a.dataset.nav === "products")));
  if (r.name === "offer") renderOffer(r.id);
  if (r.name === "products") renderCatalog();
  if (r.name === "product") renderProduct(r.id);
  if (r.name === "cart") renderCart();
  if (r.name === "rewards") renderRewards();
  if (r.name === "about" && !state.about) loadAbout();
  if (r.name === "suggest") renderSuggest();
  if (r.name === "notifications") renderNotif();
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

// ---------- الأحداث ----------
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-lang-toggle]")) {
    toggleLang();
    rerender();
    return;
  }

  const shareBtn = e.target.closest("[data-share]");
  if (shareBtn) { shareOffer(shareBtn.dataset.share); return; }
  if (e.target.closest("[data-install]")) { installApp(); return; }
  if (e.target.closest("[data-rate]")) { openRatingModal(); return; }

  const kindBtn = e.target.closest("[data-kind]");
  if (kindBtn) { state.kind = kindBtn.dataset.kind; store.set(KIND_KEY, state.kind); renderHome(); return; }

  const chip = e.target.closest("[data-cat]");
  if (chip) { state.category = chip.dataset.cat; renderHome(); return; }

  const add = e.target.closest("[data-add]");
  if (add) { addToCart(add.dataset.add, 1); toast(t("added")); return; }

  const step = e.target.closest("[data-cart-step]");
  if (step) {
    const it = getCart().find((x) => x.id === step.dataset.id);
    if (it) setQty(it.id, it.qty + Number(step.dataset.cartStep));
    renderCart();
    return;
  }

  const rm = e.target.closest("[data-remove]");
  if (rm) { removeFromCart(rm.dataset.remove); renderCart(); return; }

  if (e.target.closest("[data-edit-pharm]")) { openPharmacyModal(null); return; }
  if (e.target.closest("[data-reorder]")) { reorder(); return; }

  if (e.target.closest("[data-enable-notif]")) {
    const s = await enableNotifications();
    if (s === "granted") toast(t("toastGranted"));
    else if (s === "denied") toast(t("toastDenied"));
    return;
  }

  const zoom = e.target.closest("[data-zoom]");
  if (zoom) {
    const lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = `<img src="${esc(zoom.src)}" alt="">`;
    lb.addEventListener("click", () => lb.remove());
    document.body.appendChild(lb);
  }
});

$("#company-filter").addEventListener("change", (e) => { state.company = e.target.value; renderHome(); });
$("#search").addEventListener("input", (e) => { state.search = e.target.value; renderHome(); });
$("#products-search").addEventListener("input", (e) => { state.productSearch = e.target.value; renderCatalog(); });
// البحث بالصوت (بيستخبى لوحده لو المتصفح مش بيدعمه)
setupVoiceSearch($("#search"), toast);
setupVoiceSearch($("#products-search"), toast);

$("#welcome-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  // طلب الإذن لازم يبدأ في نفس الضغطة (OneSignal.Notifications.requestPermission)
  await enableNotifications();
  store.set(WELCOME_KEY, "1");
  $("#welcome").hidden = true;
  btn.disabled = false;
  location.hash = "#/";
  route();
  renderNotif();
});

window.addEventListener("hashchange", route);
window.addEventListener("cart-change", () => { updateCartBadge(); updateReorder(); });
// لو السلة اتغيّرت من تاب تاني
window.addEventListener("storage", (e) => { if (e.key === "vip_cart") rerender(); });
onNotifChange(renderNotif);

// ---------- البداية ----------
reloadOnNewServiceWorker(); // لازم أول حاجة: لو نسخة جديدة مسكت الصفحة نعمل reload مرة واحدة
applyStatic();
// لو الإشعارات متفعّلة بالفعل، منعرضش شاشة الترحيب
if (getStatus() === "granted") store.set(WELCOME_KEY, "1");
if (!store.get(WELCOME_KEY)) {
  $("#welcome").hidden = false;
  $("#welcome-ios").hidden = !needsIOSInstall();
}
route();
renderNotif();
updateCartBadge();
loadOffers();
loadRatings();
loadLoyalty();
initNotifications();

// زرار «ثبّت التطبيق»: أندرويد/كروم بيدّينا beforeinstallprompt، والآيفون خطوات
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installPrompt = e; renderHomeAlerts(); });
window.addEventListener("appinstalled", () => { state.installPrompt = null; renderHomeAlerts(); toast(t("installDone")); });
// زرار «بعدين» في نافذة التقييم: منسألش تاني في نفس الجلسة
document.addEventListener("click", (e) => {
  if (e.target.closest(".rate-form [data-close]")) { try { sessionStorage.setItem("vip_rate_later", "1"); } catch {} renderHomeAlerts(); }
});
window.addEventListener("load", registerAppServiceWorker);
