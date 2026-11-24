import { isFirebaseConfigured, WHATSAPP_NUMBER } from "./firebase-config.js";
import {
  allCategories, esc, safeUrl, safeImage, num, calcTotals, offerStatus, normTitle
} from "./utils.js";
import {
  getCart, addToCart, setQty, removeFromCart, clearCart, cartCount,
  getPharmacy, savePharmacy, getLastOrder, saveLastOrder, buildOrderMessage
} from "./cart.js";
import {
  initNotifications, enableNotifications, getStatus, onNotifChange, needsIOSInstall, registerAppServiceWorker,
  reloadOnNewServiceWorker
} from "./notifications.js";
import { t, isEn, fmtMoney as money, applyStatic, toggleLang } from "./i18n.js";
import { setupVoiceSearch } from "./voice.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const WELCOME_KEY = "vip_welcomed";
const CACHE_KEY = "vip_offers_cache";
const PRODUCTS_KEY = "vip_products_v2";
const CATS_KEY = "vip_categories";
const NAMES_KEY = "vip_names_en";
const ALL = "__all";
const KIND_KEY = "vip_kind";

const state = {
  offers: [], loaded: false, fresh: false, company: "", category: ALL, search: "",
  kind: null, // "single" = عروض منتج واحد، "bundle" = مجموعات مشكّلة
  about: null,
  products: [], productsLoaded: false, productSearch: "",
  productById: new Map(), productByName: new Map(),
  savedCategories: [],
  names: { categories: {}, companies: {} } // الأسماء الإنجليزي للأقسام والشركات
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
const visibleOffers = () => state.offers.filter((o) => !offerStatus(o).expired);
const findAvailable = (id) => visibleOffers().find((o) => o.id === id) || null;

async function loadOffers() {
  const cached = readJSON(CACHE_KEY, null);
  if (Array.isArray(cached)) { state.offers = cached; state.loaded = true; rerender(); }
  try {
    const { db, collection, getDocs, query, orderBy } = await firestore();
    const snap = await getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc")));
    // من غير نت، Firestore بيرجّع نتيجة فاضية من الكاش بتاعه بدل ما يدّي error:
    // منعتبرهاش، ونفضل على النسخة المحفوظة عندنا
    if (snap.metadata.fromCache) throw new Error("offline");
    state.offers = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: data.createdAt?.toMillis?.() || 0, updatedAt: undefined };
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
  try {
    const { db, doc, getDoc } = await firestore();
    const [cats, names] = await Promise.all([
      getDoc(doc(db, "settings", "categories")),
      getDoc(doc(db, "settings", "names"))
    ]);
    if (cats.metadata.fromCache || names.metadata.fromCache) throw new Error("offline");
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
  rerender();
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
  if (r.name === "about" && state.about) renderAbout();
  if (r.name === "notifications") renderNotif();
  updateCartBadge();
  updateReorder();
}

// ---------- أجزاء مشتركة ----------
function badges(o) {
  const s = offerStatus(o);
  const out = [];
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
      </div>
    </div>
  </article>`;
}

// عرض منتج واحد = فيه منتج واحد بس (بأي كمية)، ومجموعة مشكّلة = فيه منتجين أو أكتر
const offerKind = (o) => ((o.products || []).filter((p) => p && p.name).length >= 2 ? "bundle" : "single");

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
    const q = Math.max(1, num(p.qty) || 1);
    return `<tr>
      <td><div class="item-cell">${itemImage(p) ? lazyImg(itemImage(p), "", "", 44) : ""}<span>${esc(itemName(p))}</span></div></td>
      <td class="num">${q}</td>
      <td class="num old">${money(num(p.publicPrice) * q)}</td>
      <td class="num new">${money(num(p.offerPrice) * q)}</td>
    </tr>`;
  }).join("");

  // نحافظ على الكمية لو الصفحة اترسمت تاني (بعد تحميل الصور أو تغيير اللغة)
  const prevQty = body.dataset.offerId === o.id ? Number(body.dataset.qty) || 1 : 1;
  body.dataset.offerId = o.id;

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
  const list = state.products.filter((p) => productMatches(p, state.productSearch));
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
  if (!p) {
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
    </div>
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
  const pharm = getPharmacy();
  const pharmBox = `
    <div class="panel pharm-box">
      <div class="info">
        ${pharm
          ? `<b>🏪 ${esc(pharm.name)}</b><div class="meta">📍 ${esc(pharm.area)}</div>`
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
  const pharm = getPharmacy();
  if (pharm) sendOrder(available, fromCart, pharm);
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
function sendOrder(items, fromCart, pharm) {
  const lines = items.map((x) => {
    const o = findAvailable(x.id);
    return { name: o.name, company: o.company, qty: x.qty, unitPrice: calcTotals(o.products).totalOffer };
  });
  openWhatsApp(buildOrderMessage(pharm, lines));
  saveLastOrder(items);
  if (fromCart) clearCart();
  rerender();
  showThanks();
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
  const p = getPharmacy() || { name: "", area: "" };
  const m = openModal(`
    <h2>${t("pharmTitle")}</h2>
    <p>${t("pharmIntro")}</p>
    <form class="form-grid">
      <div class="field"><label for="ph-name">${t("pharmName")}</label><input id="ph-name" class="input" required value="${esc(p.name)}" autocomplete="organization"></div>
      <div class="field"><label for="ph-area">${t("area")}</label><input id="ph-area" class="input" required value="${esc(p.area)}"></div>
      <button type="submit" class="btn ${sending ? "btn-green" : "btn-purple"} btn-block">${sending ? `<svg><use href="#i-wa"/></svg>${t("saveSend")}` : t("save")}</button>
      <button type="button" class="btn btn-ghost btn-block" data-close>${t("cancel")}</button>
    </form>`);
  $("#ph-name", m).focus();
  $("form", m).addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#ph-name", m).value.trim();
    const area = $("#ph-area", m).value.trim();
    if (!name || !area) return;
    savePharmacy(name, area);
    m.remove();
    if (onSaved) onSaved(getPharmacy());
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

// محتوى الصفحة نفسه (النبذة والكورسات) بيتكتب من لوحة الأدمن بالعربي
function renderAbout() {
  const a = state.about || {};
  const photo = safeUrl(a.photoUrl);
  const courses = (a.courses || []).filter(Boolean);
  const reviews = (a.reviews || []).map(safeUrl).filter(Boolean);
  const name = a.name && !(isEn() && a.name === "مانجر مروة") ? a.name : t("aboutTitle");
  $("#about-body").innerHTML = `
    <div class="panel about-hero">
      ${photo ? `<img class="avatar" src="${esc(photo)}" alt="${esc(name)}">` : `<div class="avatar" style="display:grid;place-items:center;color:var(--purple)"><svg width="64" height="64"><use href="#i-user"/></svg></div>`}
      <h2>${esc(name)}</h2>
      ${num(a.years) ? `<span class="years-pill">${t("years", { n: num(a.years) })}</span>` : ""}
      ${a.bio ? `<p style="margin:12px 0 0">${esc(a.bio)}</p>` : ""}
    </div>
    ${courses.length ? `<div class="panel"><h3 class="section-title">${t("coursesTitle")}</h3><ul class="courses">${courses.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    ${reviews.length ? `<div class="panel"><h3 class="section-title">${t("reviewsTitle")}</h3><div class="reviews">${reviews.map((r) => `<img src="${esc(r)}" alt="${esc(t("reviewAlt"))}" loading="lazy" data-zoom>`).join("")}</div></div>` : ""}
    <a class="btn btn-green btn-block" style="margin-top:16px" target="_blank" rel="noopener"
       href="${whatsappLink("أهلاً، عايز أستفسر عن العروض")}"><svg><use href="#i-wa"/></svg>${t("contactWa")}</a>`;
}

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
  if (["notifications", "about", "cart", "products"].includes(h)) return { name: h };
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
  if (r.name === "about" && !state.about) loadAbout();
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
initNotifications();
window.addEventListener("load", registerAppServiceWorker);
