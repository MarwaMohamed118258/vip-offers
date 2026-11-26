// متجر العروض (Offers Store): تطبيق العملاء (الجمهور)
import { isFirebaseConfigured, STORE_URL } from "./firebase-config.js";
import {
  esc, safeUrl, safeImage, num, calcTotals, offerStatus, normTitle, mergeItems, distinctProducts,
  lineQty, lineOffer, linePublic, randomId, toMillis
} from "./core.js";
import {
  GOVERNORATES, GOVERNORATES_EN, storeSettings, waNumber, cleanEgPhone, EG_PHONE_RE,
  companyIndex, companyDoc, companyVisible, offerInStore, calcShipping, buildStoreMessage,
  askAssistant, fillAnswer, STARTER_FAQ, PRODUCT_INFO, FOLLOWUP_DAYS
} from "./store-shared.js";
import {
  initNotifications, enableNotifications, getStatus, onNotifChange, needsIOSInstall,
  registerAppServiceWorker, reloadOnNewServiceWorker
} from "./notifications.js";
import { t, isEn, fmtMoney as money, applyStatic, toggleLang } from "./i18n.js";
import { setupVoiceSearch } from "./voice.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ALL = "__all";
const K = {
  welcome: "store_welcomed", cache: "store_cache_v1", kind: "store_kind", cart: "store_cart",
  customer: "store_customer", last: "store_last_order", followSeen: "store_followup_seen"
};
const DAY = 86400000;

const state = {
  offers: [], loaded: false, error: "",
  products: [], productsLoaded: false, productById: new Map(), productByName: new Map(),
  companies: [], cidx: companyIndex([]),
  names: { categories: {}, companies: {} },
  settings: storeSettings(null),
  faqs: null,
  company: "", category: ALL, search: "", productSearch: "", kind: null,
  installPrompt: null, followup: null,
  chat: [], chatSuggestions: [], pendingAsk: ""
};

// ---------- تخزين محلي آمن ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const readJSON = (k, fb) => { try { return JSON.parse(store.get(k)) ?? fb; } catch { return fb; } };
const writeJSON = (k, v) => store.set(k, JSON.stringify(v));
const str = (v) => (typeof v === "string" ? v.trim() : "");

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

// ---------- الأسماء حسب اللغة ----------
const offerTitle = (o) => (isEn() && str(o.titleEn)) || o.name || "";
const companyName = (c) => {
  const d = companyDoc(state.cidx, c);
  return (isEn() && (str(d?.nameEn) || str(state.names.companies[c]))) || str(d?.name) || c || "";
};
const companyLogo = (c) => safeImage(companyDoc(state.cidx, c)?.logo);
const categoryName = (c) => (isEn() && str(state.names.categories[c])) || c || "";
const productFor = (it) => state.productById.get(it.productId) || state.productByName.get(normTitle(it.name));
const productName = (p) => (isEn() && str(p.nameEn)) || p.name || "";
const itemName = (it) => (isEn() && (str(it.nameEn) || str(productFor(it)?.nameEn))) || it.name || "";
const itemImage = (it) => safeImage(it.image) || safeImage(productFor(it)?.image);
const govName = (g) => (isEn() && GOVERNORATES_EN[g]) || g;

function companyBadge(c, cls = "company") {
  const logo = companyLogo(c);
  return `<div class="${cls}">${logo ? `<img class="co-logo" src="${esc(logo)}" alt="" loading="lazy">` : `<svg><use href="#i-check"/></svg>`}${esc(companyName(c))}</div>`;
}

// ---------- البيانات ----------
const visibleOffers = () => state.offers.filter((o) => !offerStatus(o).expired && offerInStore(o, state.cidx));
const visibleProducts = () => state.products.filter((p) => companyVisible(state.cidx, p.company, "showStore"));
const findAvailable = (id) => visibleOffers().find((o) => o.id === id) || null;
const normalizeOffer = (o) => ({ ...o, products: mergeItems(o.products) });

function setProducts(list) {
  state.products = list;
  state.productById = new Map(list.map((p) => [p.id, p]));
  state.productByName = new Map(list.map((p) => [normTitle(p.name), p]));
}
function setCompanies(list) {
  state.companies = list;
  state.cidx = companyIndex(list);
}

function applyCache() {
  const c = readJSON(K.cache, null);
  if (!c || !Array.isArray(c.offers)) return;
  state.offers = c.offers.map(normalizeOffer);
  setProducts(Array.isArray(c.products) ? c.products : []);
  setCompanies(Array.isArray(c.companies) ? c.companies : []);
  state.names = { categories: {}, companies: {}, ...(c.names || {}) };
  state.settings = storeSettings(c.settings);
  if (Array.isArray(c.faqs)) state.faqs = c.faqs;
  state.loaded = state.productsLoaded = true;
}

function mapProduct(id, p) {
  return {
    id, name: str(p.name), nameEn: str(p.nameEn), company: str(p.company), category: str(p.category),
    publicPrice: num(p.publicPrice), image: safeImage(p.image),
    usage: str(p.usage), warnings: str(p.warnings), notFor: str(p.notFor), dietTips: str(p.dietTips)
  };
}

async function loadAll() {
  applyCache();
  rerender();
  try {
    const { db, collection, getDocs, getDoc, doc, query, orderBy } = await firestore();
    const [offers, products, companies, settings, names, faqs] = await Promise.all([
      getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "products"), orderBy("name"))),
      getDocs(collection(db, "companies")),
      getDoc(doc(db, "settings", "store")),
      getDoc(doc(db, "settings", "names")),
      getDocs(collection(db, "faq")).catch(() => null)
    ]);
    // من غير نت Firestore بيرجّع نتيجة فاضية من الكاش: منعتبرهاش
    if ([offers, products, companies, settings, names].some((s) => s.metadata.fromCache)) throw new Error("offline");
    state.offers = offers.docs.map((d) => {
      const x = d.data();
      return normalizeOffer({
        id: d.id, name: str(x.name), titleEn: str(x.titleEn), company: str(x.company), category: str(x.category),
        imageUrl: safeUrl(x.imageUrl), products: Array.isArray(x.products) ? x.products : [], endDate: str(x.endDate),
        showStore: x.showStore !== false, freeShipping: x.freeShipping === true,
        createdAt: x.createdAt?.toMillis?.() || 0
      });
    });
    setProducts(products.docs.map((d) => mapProduct(d.id, d.data())));
    setCompanies(companies.docs.map((d) => {
      const c = d.data();
      return { id: d.id, name: str(c.name), nameEn: str(c.nameEn), logo: safeImage(c.logo), showVip: c.showVip !== false, showStore: c.showStore !== false, order: num(c.order) };
    }));
    state.settings = storeSettings(settings.exists() ? settings.data() : null);
    const n = names.exists() ? names.data() : {};
    state.names = {
      categories: n.categories && typeof n.categories === "object" ? n.categories : {},
      companies: n.companies && typeof n.companies === "object" ? n.companies : {}
    };
    if (faqs && !faqs.metadata.fromCache) {
      state.faqs = faqs.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((f) => f.active !== false)
        .map((f) => ({ id: f.id, company: str(f.company), product: str(f.product), question: str(f.question), keywords: f.keywords, answer: str(f.answer), order: num(f.order) }))
        .sort((a, b) => a.order - b.order);
    }
    state.loaded = state.productsLoaded = true;
    state.error = "";
    saveCache();
    pruneCart();
  } catch (e) {
    if (e.message === "offline") console.warn("offline, showing saved copy"); else console.error(e);
    if (!state.loaded) state.error = e.message === "not-configured" ? "notConfigured" : "loadError";
  }
  rerender();
  checkFollowup();
}

function saveCache() {
  const slim = (p) => (p.image && p.image.startsWith("data:") ? { ...p, image: "" } : p);
  let data = { offers: state.offers, products: state.products, companies: state.companies, names: state.names, settings: state.settings, faqs: state.faqs };
  let json = JSON.stringify(data);
  if (json.length > 2_500_000) json = JSON.stringify({ ...data, products: state.products.map(slim), companies: state.companies.map(slim) });
  if (json.length < 4_000_000) store.set(K.cache, json);
}

// ---------- السلة: [{ id, qty }] ----------
const clampQty = (q) => Math.min(99, Math.max(1, Math.round(Number(q) || 1)));
function getCart() {
  const c = readJSON(K.cart, []);
  return Array.isArray(c) ? c.filter((x) => x && typeof x.id === "string").map((x) => ({ id: x.id, qty: clampQty(x.qty) })) : [];
}
function saveCart(c) { writeJSON(K.cart, c); updateCartBadge(); }
function addToCart(id, qty = 1) {
  const c = getCart();
  const it = c.find((x) => x.id === id);
  if (it) it.qty = clampQty(it.qty + qty); else c.push({ id, qty: clampQty(qty) });
  saveCart(c);
}
const setQty = (id, qty) => saveCart(getCart().map((x) => (x.id === id ? { ...x, qty: clampQty(qty) } : x)));
const removeFromCart = (...ids) => saveCart(getCart().filter((x) => !ids.includes(x.id)));
const cartCount = () => getCart().reduce((s, x) => s + x.qty, 0);

function pruneCart() {
  const gone = getCart().filter((x) => !findAvailable(x.id)).map((x) => x.id);
  if (gone.length) { removeFromCart(...gone); toast(t("pruned")); }
}

function cartLines(items = getCart()) {
  return items.map((x) => {
    const o = findAvailable(x.id);
    if (!o) return null;
    const tt = calcTotals(o.products);
    return { id: o.id, qty: x.qty, offer: o, unitPrice: tt.totalOffer, unitPublic: tt.totalPublic, freeShipping: o.freeShipping === true };
  }).filter(Boolean);
}

// ---------- بيانات العميل ----------
function getCustomer() {
  const c = readJSON(K.customer, null) || {};
  if (!c.id || !/^[A-Za-z0-9]{24,64}$/.test(c.id)) { c.id = randomId(32); writeJSON(K.customer, c); }
  return { id: c.id, name: str(c.name), phone: str(c.phone), governorate: str(c.governorate), address: str(c.address) };
}
function saveCustomer(c) {
  const old = getCustomer();
  writeJSON(K.customer, { id: old.id, name: c.name, phone: c.phone, governorate: c.governorate, address: c.address });
}

// ---------- أجزاء مشتركة ----------
function lazyImg(src, cls = "", alt = "", size = 200) {
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="${size}" height="${size}">`;
}

function badges(o) {
  const s = offerStatus(o);
  const out = [];
  if (o.freeShipping) out.push(`<span class="badge badge-free">🚚 ${t("freeShipping")}</span>`);
  if (s.isNew) out.push(`<span class="badge badge-new">${t("badgeNew")}</span>`);
  if (s.endingSoon) out.push(`<span class="badge badge-ending">⏳ ${esc(s.daysLeft === 0 ? t("lastDay") : t("endsIn", { n: s.daysLeft }))}</span>`);
  return out.length ? `<div class="badges">${out.join("")}</div>` : "";
}

function thumbs(o) {
  const imgs = (o.products || []).map(itemImage).filter(Boolean);
  if (!imgs.length) return "";
  return `<div class="thumbs">${imgs.slice(0, 4).map((src) => lazyImg(src, "", "", 58)).join("")}${imgs.length > 4 ? `<span class="more">+${imgs.length - 4}</span>` : ""}</div>`;
}

const offerKind = (o) => (distinctProducts(o.products) >= 2 ? "bundle" : "single");

function haystack(o) {
  return normTitle([
    o.name, o.titleEn, o.company, companyName(o.company), o.category, state.names.categories[o.category],
    ...(o.products || []).flatMap((it) => [it.name, it.nameEn, productFor(it)?.nameEn])
  ].filter(Boolean).join(" | "));
}
function matches(h, q) {
  const words = normTitle(q).split(" ").filter(Boolean);
  return !words.length || words.every((w) => h.includes(w));
}

function companyChips(companies, current, attr) {
  if (companies.length < 1) return "";
  return [["", t("allCompanies")], ...companies.map((c) => [c, companyName(c)])].map(([c, label]) => {
    const logo = c ? companyLogo(c) : "";
    return `<button type="button" class="chip co-chip${c === current ? " active" : ""}" ${attr}="${esc(c)}" role="tab" aria-selected="${c === current}">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy">` : ""}${esc(label)}</button>`;
  }).join("");
}
const sortCompanies = (list) => [...new Set(list.filter(Boolean))].sort((a, b) =>
  (num(companyDoc(state.cidx, a)?.order) - num(companyDoc(state.cidx, b)?.order)) || companyName(a).localeCompare(companyName(b), isEn() ? "en" : "ar"));

// ---------- الرئيسية ----------
function offerCard(o) {
  const tt = calcTotals(o.products);
  const names = (o.products || []).map(itemName).filter(Boolean);
  const short = names.slice(0, 3).join(isEn() ? ", " : "، ") + (names.length > 3 ? t("more", { n: names.length - 3 }) : "");
  const img = safeUrl(o.imageUrl);
  return `
  <article class="offer-card">
    ${img ? `<img class="img" src="${esc(img)}" alt="" loading="lazy">` : ""}
    ${tt.discount > 0 ? `<span class="discount-badge">${t("discount", { n: tt.discount })}</span>` : ""}
    <div class="body">
      ${badges(o)}
      ${companyBadge(o.company)}
      <div class="meta">${esc(categoryName(o.category))}${o.category ? " · " : ""}${t("items", { n: tt.items })}</div>
      <h2 class="offer-name">${esc(offerTitle(o))}</h2>
      <p class="products-short">${esc(short)}</p>
      ${thumbs(o)}
      <div class="price-row">
        <span class="price-new">${money(tt.totalOffer)}</span>
        ${tt.totalPublic > tt.totalOffer ? `<span class="price-old">${money(tt.totalPublic)}</span>` : ""}
      </div>
      <div class="card-actions">
        <a class="btn btn-purple" href="#/offer/${encodeURIComponent(o.id)}">${t("details")}</a>
        <button type="button" class="btn btn-yellow" data-add="${esc(o.id)}" aria-label="${esc(t("addToCart"))}"><svg><use href="#i-cart"/></svg>${t("add")}</button>
        <button type="button" class="btn btn-ghost icon-only" data-share="${esc(o.id)}" aria-label="${esc(t("share"))}" title="${esc(t("share"))}"><svg><use href="#i-share"/></svg></button>
      </div>
    </div>
  </article>`;
}

function renderHome() {
  const offers = visibleOffers();
  const companies = sortCompanies(offers.map((o) => o.company));
  if (state.company && !companies.includes(state.company)) state.company = "";
  $("#company-chips").innerHTML = companies.length > 1 ? companyChips(companies, state.company, "data-company") : "";
  $("#company-chips").hidden = companies.length <= 1;

  const byCompany = offers.filter((o) => !state.company || o.company === state.company);
  const cats = [...new Set(byCompany.map((o) => o.category).filter(Boolean))].sort((a, b) => categoryName(a).localeCompare(categoryName(b), isEn() ? "en" : "ar"));
  if (state.category !== ALL && !cats.includes(state.category)) state.category = ALL;
  $("#category-chips").innerHTML = cats.length > 1 ? [ALL, ...cats].map((c) =>
    `<button type="button" class="chip${c === state.category ? " active" : ""}" data-cat="${esc(c)}" role="tab" aria-selected="${c === state.category}">${esc(c === ALL ? t("all") : categoryName(c))}</button>`).join("") : "";
  $("#category-chips").hidden = cats.length <= 1;

  if (!state.kind) {
    const saved = store.get(K.kind);
    if (saved === "single" || saved === "bundle") state.kind = saved;
    else if (state.loaded) state.kind = offers.some((o) => offerKind(o) === "single") ? "single" : "bundle";
  }
  const filtered = byCompany.filter((o) => (state.category === ALL || o.category === state.category) && matches(haystack(o), state.search));
  const counts = { single: 0, bundle: 0 };
  filtered.forEach((o) => counts[offerKind(o)]++);
  if (state.search.trim() && state.kind && !counts[state.kind]) {
    const other = state.kind === "single" ? "bundle" : "single";
    if (counts[other]) state.kind = other;
  }
  $("#kind-tabs").setAttribute("aria-label", t("kindTabs"));
  $("#kind-tabs").innerHTML = [["single", "tabSingle"], ["bundle", "tabBundles"]].map(([k, key]) =>
    `<button type="button" role="tab" data-kind="${k}" class="${state.kind === k ? "active" : ""}" aria-selected="${state.kind === k}">${t(key)}<span class="count">${counts[k]}</span></button>`).join("");

  const list = $("#offers-list");
  if (!state.loaded) {
    if (state.error) list.innerHTML = `<p class="state-msg">${esc(t(state.error))}</p>`;
    return;
  }
  const items = filtered.filter((o) => offerKind(o) === (state.kind || "single"));
  list.innerHTML = items.length ? items.map(offerCard).join("")
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
  $("#d-company").textContent = [companyName(o.company), categoryName(o.category)].filter(Boolean).join(" · ");
  const rows = (o.products || []).map((p) => {
    const q = lineQty(p);
    const pr = productFor(p);
    const name = pr && companyVisible(state.cidx, pr.company, "showStore")
      ? `<a href="#/product/${encodeURIComponent(pr.id)}">${esc(itemName(p))}</a>` : esc(itemName(p));
    return `<tr>
      <td><div class="item-cell">${itemImage(p) ? lazyImg(itemImage(p), "", "", 44) : ""}<span>${name}</span></div></td>
      <td class="num">${q}</td>
      <td class="num old">${money(linePublic(p))}</td>
      <td class="num new">${money(lineOffer(p))}</td>
    </tr>`;
  }).join("");
  const prevQty = body.dataset.offerId === o.id ? Number(body.dataset.qty) || 1 : 1;
  body.dataset.offerId = o.id;
  body.innerHTML = `
    ${img ? `<img src="${esc(img)}" alt="" class="offer-hero">` : ""}
    <div class="panel">
      ${badges(o)}
      <div class="price-row" style="justify-content:space-between">
        ${companyBadge(o.company)}
        ${tt.discount > 0 ? `<span class="discount-badge" style="position:static">${t("discount", { n: tt.discount })}</span>` : ""}
      </div>
      <div class="table-wrap">
        <table class="items">
          <thead><tr><th>${t("thProduct")}</th><th>${t("thQty")}</th><th>${t("thPublic")}</th><th>${t("thOffer")}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>${t("total")}</td><td class="num">${tt.items}</td><td class="num old">${money(tt.totalPublic)}</td><td class="num new">${money(tt.totalOffer)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="stepper-row">
        <b>${t("qtyLabel")}</b>
        <div class="stepper">
          <button type="button" data-step="1" aria-label="${esc(t("increase"))}">+</button>
          <output id="qty" aria-live="polite">1</output>
          <button type="button" data-step="-1" aria-label="${esc(t("decrease"))}">−</button>
        </div>
      </div>
      <div class="summary">
        <div><span>${t("publicPrice")}</span><span class="price-old" id="s-public"></span></div>
        <div class="total"><span>${t("offerPrice")}</span><span id="s-total"></span></div>
      </div>
      ${o.freeShipping ? `<p class="ship-note free">🚚 ${t("offerFreeShip")}</p>` : `<p class="ship-note">🚚 ${esc(t("shipRule", { fee: money(state.settings.shippingFee), min: money(state.settings.freeThreshold) }))}</p>`}
    </div>
    <div class="form-grid" style="margin-top:16px">
      <button type="button" id="add-cart-btn" class="btn btn-yellow btn-block"><svg><use href="#i-cart"/></svg>${t("addToCart")}</button>
      <button type="button" id="buy-btn" class="btn btn-green btn-block"><svg><use href="#i-wa"/></svg>${t("orderNow")}</button>
      <button type="button" class="btn btn-ghost btn-block" data-share="${esc(o.id)}"><svg><use href="#i-share"/></svg>${t("share")}</button>
    </div>`;
  let qty = prevQty;
  const update = () => {
    body.dataset.qty = qty;
    $("#qty").textContent = qty;
    $("#s-public").textContent = money(tt.totalPublic * qty);
    $("#s-total").textContent = money(tt.totalOffer * qty);
  };
  $$("[data-step]", body).forEach((b) => b.addEventListener("click", () => { qty = clampQty(qty + Number(b.dataset.step)); update(); }));
  $("#add-cart-btn").addEventListener("click", () => { addToCart(o.id, qty); toast(t("addedQty", { n: qty })); });
  $("#buy-btn").addEventListener("click", () => { addToCart(o.id, qty); location.hash = "#/cart"; });
  update();
}

// ---------- المنتجات ----------
function productCard(p) {
  const img = safeImage(p.image);
  return `
  <a class="product-card" href="#/product/${encodeURIComponent(p.id)}">
    <div class="pimg">${img ? lazyImg(img, "", productName(p), 200) : `<svg width="40" height="40"><use href="#i-box"/></svg>`}</div>
    <div class="pbody">
      <b>${esc(productName(p))}</b>
      <span class="meta">${esc(companyName(p.company))}</span>
      ${num(p.publicPrice) ? `<span class="pprice">${money(p.publicPrice)}</span>` : ""}
      ${offersWithProduct(p).length ? `<span class="badge badge-free" style="align-self:flex-start">${t("hasOffer")}</span>` : ""}
    </div>
  </a>`;
}

function renderCatalog() {
  const body = $("#catalog-body");
  if (!state.productsLoaded) { body.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`; return; }
  const all = visibleProducts();
  const companies = sortCompanies(all.map((p) => p.company));
  if (state.company && !companies.includes(state.company)) state.company = "";
  $("#products-company-chips").innerHTML = companies.length > 1 ? companyChips(companies, state.company, "data-company") : "";
  $("#products-company-chips").hidden = companies.length <= 1;
  const list = all.filter((p) => (!state.company || p.company === state.company) &&
    matches(normTitle([p.name, p.nameEn, p.company, companyName(p.company), p.category, state.names.categories[p.category]].filter(Boolean).join(" | ")), state.productSearch));
  if (!list.length) {
    body.innerHTML = `<p class="state-msg">${state.productSearch.trim() ? t("noResults") : t("noProducts")}</p>`;
    return;
  }
  const groups = new Map();
  for (const p of list) { const c = p.category || ""; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(p); }
  const sections = [...groups.entries()].sort((a, b) => (!a[0]) - (!b[0]) || categoryName(a[0]).localeCompare(categoryName(b[0]), isEn() ? "en" : "ar"));
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

const INFO_ORDER = ["usage", "warnings", "notFor", "dietTips"];
function renderProduct(id) {
  const body = $("#product-body");
  const p = state.productById.get(id);
  if (!p || !companyVisible(state.cidx, p.company, "showStore")) {
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
  const infos = INFO_ORDER.map((k) => PRODUCT_INFO.find((i) => i.key === k)).filter((i) => p[i.key]);
  body.innerHTML = `
    <div class="panel product-hero">
      ${img ? lazyImg(img, "big", productName(p), 400) : ""}
      <h2>${esc(productName(p))}</h2>
      ${isEn() && p.nameEn && p.name ? `<p class="meta" lang="ar" dir="rtl">${esc(p.name)}</p>` : ""}
      ${companyBadge(p.company, "company center")}
      ${num(p.publicPrice) ? `<p class="pprice big">${t("publicPrice")}: ${money(p.publicPrice)}</p>` : ""}
    </div>
    ${infos.length ? `
    <div class="panel info-panel">
      ${infos.map((i) => `<div class="info-block info-${i.key}"><h3>${esc(isEn() ? i.labelEn : i.label)}</h3><p dir="auto">${nl2br(p[i.key])}</p></div>`).join("")}
      <p class="health-note">${t("healthNote")}</p>
    </div>` : ""}
    <button type="button" class="btn btn-ghost btn-block" style="margin-top:12px" data-ask-product="${esc(p.id)}"><svg><use href="#i-chat"/></svg>${t("askAbout")}</button>
    <h2 class="section-title" style="margin-top:18px">${t("productOffers")} <span class="meta">(${offers.length})</span></h2>
    ${offers.length ? `<div class="offers-list">${offers.map(offerCard).join("")}</div>` : `<p class="state-msg">${t("noProductOffers")}</p>`}`;
}

const nl2br = (s) => esc(s).replace(/\n/g, "<br>");

// ---------- السلة والطلب ----------
const draft = { name: null, phone: null, governorate: null, address: null, notes: "" };
function readCartForm() {
  const box = $("#cart-body");
  if (!$("#c-name", box)) return;
  draft.name = $("#c-name", box).value;
  draft.phone = $("#c-phone", box).value;
  draft.governorate = $("#c-gov", box).value;
  draft.address = $("#c-address", box).value;
  draft.notes = $("#c-notes", box).value;
}

function shipBox(ship) {
  const s = state.settings;
  let hint = "";
  if (ship.free) hint = `<p class="ship-note free">🎉 ${t(ship.allFree && !ship.byTotal ? "freeByOffer" : "freeByTotal")}</p>`;
  else if (ship.remaining > 0) {
    const pct = Math.round(Math.min(1, ship.subtotal / s.freeThreshold) * 100);
    hint = `<p class="ship-note">🚚 ${esc(t("freeRemaining", { x: money(ship.remaining) }))}</p>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;
  }
  return `
    <div class="panel">
      <div class="sum-row"><span>${t("subtotal")}</span><b>${money(ship.subtotal)}</b></div>
      <div class="sum-row"><span>${t("shipping")}</span><b>${ship.shipping > 0 ? money(ship.shipping) : `<span class="free-text">${t("free")}</span>`}</b></div>
      <div class="grand"><span>${t("total")}</span><span>${money(ship.total)}</span></div>
      ${hint}
      <p class="cod-note"><svg><use href="#i-cash"/></svg>${t("cod")}</p>
    </div>`;
}

function renderCart() {
  const body = $("#cart-body");
  readCartForm();
  if (!state.loaded) { body.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`; return; }
  const lines = cartLines();
  if (!lines.length) {
    body.innerHTML = `
      <div class="panel state-msg">
        <svg width="56" height="56" style="color:var(--purple)"><use href="#i-cart"/></svg>
        <p style="margin:8px 0 14px">${t("cartEmpty")}</p>
        <a class="btn btn-purple btn-block" href="#/">${t("seeOffers")}</a>
      </div>`;
    return;
  }
  const c = getCustomer();
  const v = (k) => draft[k] ?? c[k] ?? "";
  const gov = v("governorate");
  const ship = calcShipping(lines, state.settings);
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
              <div class="meta">${esc(companyName(l.offer.company))} · ${esc(t("perUnit", { x: money(l.unitPrice) }))}${l.unitPublic > l.unitPrice ? ` <s>${money(l.unitPublic)}</s>` : ""}</div>
              ${l.freeShipping ? `<span class="badge badge-free">🚚 ${t("freeShipping")}</span>` : ""}
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
    ${shipBox(ship)}
    <form class="panel form-grid" id="order-form" novalidate>
      <h2 class="section-title" style="margin:0">${t("yourInfo")}</h2>
      <div class="field"><label for="c-name">${t("fName")} *</label><input id="c-name" class="input" maxlength="100" autocomplete="name" value="${esc(v("name"))}"></div>
      <div class="field"><label for="c-phone">${t("fPhone")} *</label><input id="c-phone" class="input" type="tel" inputmode="tel" dir="ltr" autocomplete="tel" placeholder="01xxxxxxxxx" value="${esc(v("phone"))}"></div>
      <div class="field"><label for="c-gov">${t("fGov")} *</label>
        <select id="c-gov" class="select">
          <option value="">${t("fGovPick")}</option>
          ${GOVERNORATES.map((g) => `<option value="${esc(g)}"${g === gov ? " selected" : ""}>${esc(govName(g))}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label for="c-address">${t("fAddress")} *</label><textarea id="c-address" class="textarea" rows="2" maxlength="300" autocomplete="street-address" placeholder="${esc(t("fAddressPh"))}">${esc(v("address"))}</textarea></div>
      <div class="field"><label for="c-notes">${t("fNotes")}</label><textarea id="c-notes" class="textarea" rows="2" maxlength="500" placeholder="${esc(t("fNotesPh"))}">${esc(draft.notes || "")}</textarea></div>
      <p class="error" id="order-error" hidden></p>
      <button type="submit" class="btn btn-green btn-block"><svg><use href="#i-wa"/></svg>${t("orderWa")}</button>
    </form>`;
}

function updateCartBadge() {
  const n = cartCount();
  const el = $("#cart-count");
  el.hidden = n === 0;
  el.textContent = n > 99 ? "99+" : n;
}

function openWhatsApp(text) {
  const a = document.createElement("a");
  a.href = `https://wa.me/${waNumber(state.settings.whatsapp)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
const waHref = (text) => `https://wa.me/${waNumber(state.settings.whatsapp)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

function submitOrder(form) {
  readCartForm();
  const err = $("#order-error", form);
  const fail = (key, field) => { err.hidden = false; err.textContent = t(key); if (field) $(field, form).focus(); };
  err.hidden = true;
  const lines = cartLines();
  if (!lines.length) { toast(t("unavailable")); renderCart(); return; }
  const customer = {
    name: String(draft.name || "").trim().replace(/\s+/g, " ").slice(0, 100),
    phone: cleanEgPhone(draft.phone),
    governorate: String(draft.governorate || ""),
    address: String(draft.address || "").trim().slice(0, 300),
    notes: String(draft.notes || "").trim().slice(0, 500)
  };
  if (!customer.name) return fail("errName", "#c-name");
  if (!EG_PHONE_RE.test(customer.phone)) return fail("errPhone", "#c-phone");
  if (!GOVERNORATES.includes(customer.governorate)) return fail("errGov", "#c-gov");
  if (customer.address.length < 5) return fail("errAddress", "#c-address");

  const ship = calcShipping(lines, state.settings);
  const orderId = randomId(20);
  const code = orderId.slice(0, 6).toUpperCase();
  const msgLines = lines.map((l) => ({ name: l.offer.name, company: l.offer.company, qty: l.qty, unitPrice: l.unitPrice }));
  // واتساب الأول (لازم في نفس الضغطة)، وبعدين نسجّل الطلب
  openWhatsApp(buildStoreMessage(customer, msgLines, ship, code));
  saveCustomer(customer);
  saveOrder(orderId, customer, lines, ship);
  writeJSON(K.last, { orderId, items: lines.map((l) => ({ id: l.id, qty: l.qty })), at: Date.now() });
  saveCart([]);
  draft.notes = "";
  renderCart();
  openModal(`
    <div class="thanks">
      <div class="heart">🛍️</div>
      <p>${t("thanks")}</p>
      <p class="meta">${esc(t("orderCode", { code }))}</p>
      <button type="button" class="btn btn-purple btn-block" data-close>${t("ok")}</button>
    </div>`);
}

function saveOrder(orderId, customer, lines, ship) {
  const cid = getCustomer().id;
  firestore().then(({ db, doc, setDoc, serverTimestamp }) => setDoc(doc(db, "consumerOrders", orderId), {
    customerId: cid,
    name: customer.name, phone: customer.phone, governorate: customer.governorate,
    address: customer.address, notes: customer.notes,
    items: lines.slice(0, 50).map((l) => ({
      offerId: l.id, name: l.offer.name, company: l.offer.company, qty: l.qty,
      unitPrice: l.unitPrice, unitPublic: l.unitPublic, freeShipping: l.freeShipping
    })),
    companies: [...new Set(lines.map((l) => l.offer.company).filter(Boolean))].slice(0, 20),
    itemsCount: lines.reduce((s, l) => s + l.qty, 0),
    subtotal: ship.subtotal, shipping: ship.shipping, total: ship.total,
    status: "جديد", createdAt: serverTimestamp(), lang: isEn() ? "en" : "ar"
  })).catch((e) => console.warn("order not saved", e));
}

// ---------- المتابعة الشهرية ----------
// الأدمن لما تخلّي الطلب «اتسلّم» بتكتب storeFollowups/{customerId}، وبعد 30 يوم بنسأل العميل
async function checkFollowup() {
  const cid = getCustomer().id;
  try {
    const { db, doc, getDoc } = await firestore();
    const snap = await getDoc(doc(db, "storeFollowups", cid));
    if (!snap.exists() || snap.metadata.fromCache) return;
    const d = snap.data();
    const at = toMillis(d.deliveredAt);
    if (!at || Date.now() - at < FOLLOWUP_DAYS * DAY || store.get(K.followSeen) === d.orderId) return;
    state.followup = { orderId: String(d.orderId || ""), items: Array.isArray(d.items) ? d.items : [] };
    showFollowup();
  } catch (e) { console.warn("followup", e.message || e); }
}

function showFollowup() {
  const f = state.followup;
  if (!f || $(".followup-modal")) return;
  const names = f.items.map((it) => { const o = findAvailable(it.offerId); return o ? offerTitle(o) : it.name; }).filter(Boolean);
  const m = openModal(`
    <div class="thanks followup-modal">
      <div class="heart">💚</div>
      <h2>${t("followTitle")}</h2>
      ${names.length ? `<p class="meta">${esc(names.join(isEn() ? ", " : "، "))}</p>` : ""}
      <button type="button" class="btn btn-green btn-block" data-follow-reorder>🔁 ${t("followReorder")}</button>
      <button type="button" class="btn btn-ghost btn-block" data-close style="margin-top:8px">${t("followNo")}</button>
    </div>`);
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) store.set(K.followSeen, f.orderId);
  });
}

function followupReorder() {
  const f = state.followup;
  if (!f) return;
  store.set(K.followSeen, f.orderId);
  $(".followup-modal")?.closest(".modal")?.remove();
  let added = 0;
  for (const it of f.items) {
    if (it && typeof it.offerId === "string" && findAvailable(it.offerId)) { addToCart(it.offerId, clampQty(it.qty)); added++; }
  }
  if (!added) { toast(t("reorderNone")); return; }
  toast(added < f.items.length ? t("reorderPartial") : t("reorderAdded"));
  location.hash = "#/cart";
}

// ---------- المساعد ----------
function assistantFaqs() {
  const list = state.faqs && state.faqs.length ? state.faqs : STARTER_FAQ.map((f, i) => ({ ...f, id: "s" + i, product: "عام", company: "" }));
  return list.filter((f) => !f.company || companyVisible(state.cidx, f.company, "showStore"));
}

function botGreeting() {
  return { from: "bot", html: esc(t("chatHello")) };
}

function renderChat() {
  if (!state.chat.length) {
    state.chat.push(botGreeting());
    state.chatSuggestions = askAssistant("", assistantFaqs(), []).suggestions;
  }
  const log = $("#chat-log");
  log.innerHTML = state.chat.map((m) => `<div class="msg ${m.from}"><div class="bubble" dir="auto">${m.html}</div></div>`).join("");
  $("#chat-suggestions").innerHTML = state.chatSuggestions.map((q) =>
    `<button type="button" class="chip suggest-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
  requestAnimationFrame(() => { log.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }); });
}

function ask(text) {
  const q = String(text || "").trim().slice(0, 300);
  if (!q) return;
  state.chat.push({ from: "user", html: esc(q) });
  const res = askAssistant(q, assistantFaqs(), visibleProducts());
  if (res.answer) {
    const a = res.answer;
    const tags = [a.company && companyName(a.company), a.product].filter(Boolean);
    state.chat.push({
      from: "bot",
      html: `${a.title ? `<b>${esc(a.title)}</b><br>` : ""}${nl2br(fillAnswer(a.text, state.settings))}${tags.length ? `<div class="msg-tags">${tags.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}`
    });
  } else {
    state.chat.push({
      from: "bot",
      html: `${esc(t("chatNoMatch"))}<a class="btn btn-green btn-sm chat-wa" target="_blank" rel="noopener" href="${esc(waHref(t("chatWaMsg", { q })))}"><svg><use href="#i-wa"/></svg>${t("chatWaBtn")}</a>`
    });
  }
  if (state.chat.length > 60) state.chat.splice(1, state.chat.length - 60);
  state.chatSuggestions = res.suggestions;
  renderChat();
}

// ---------- من نحن ----------
const CHECK_RE = /^(✔️|✔|✅|☑️)\s*/;
function textBlocks(text) {
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

function renderAbout() {
  const s = state.settings;
  const text = (isEn() && str(s.aboutEn)) || s.about;
  $("#about-body").innerHTML = `
    <div class="panel about-hero">
      <div class="about-logo"><svg><use href="#i-bag"/></svg></div>
      <h2>${t("appTitle")}</h2>
      <p class="about-title">${t("tagline")}</p>
    </div>
    <div class="panel about-text">${textBlocks(text)}</div>
    <div class="trust-row">
      <div><svg><use href="#i-shield"/></svg><span>${t("feat1")}</span></div>
      <div><svg><use href="#i-cash"/></svg><span>${t("feat2")}</span></div>
      <div><svg><use href="#i-truck"/></svg><span>${t("feat3")}</span></div>
    </div>
    <a class="btn btn-green btn-block" style="margin-top:16px" target="_blank" rel="noopener" href="${esc(waHref(t("contactMsg")))}"><svg><use href="#i-wa"/></svg>${t("contactWa")}</a>
    <a class="btn btn-ghost btn-block" style="margin-top:10px" href="#/assistant"><svg><use href="#i-chat"/></svg>${t("navAssistant")}</a>
    ${canInstall() ? `<button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" data-install>${t("install")}</button>` : ""}`;
}

// ---------- مشاركة ----------
async function shareOffer(id) {
  const o = findAvailable(id);
  if (!o) return;
  const tt = calcTotals(o.products);
  const url = `${STORE_URL}/#/offer/${encodeURIComponent(o.id)}`;
  const text = t("shareText", { title: offerTitle(o), price: money(tt.totalOffer), old: money(tt.totalPublic) });
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
    rerender();
    return;
  }
  openModal(`
    <h2>${t("installIosTitle")}</h2>
    <ol class="steps"><li>${t("installIos1")}</li><li>${t("installIos2")}</li><li>${t("installIos3")}</li></ol>
    <button type="button" class="btn btn-purple btn-block" data-close>${t("ok")}</button>`);
}

function renderHomeAlerts() {
  $("#home-alerts").innerHTML = canInstall()
    ? `<button type="button" class="btn btn-ghost btn-block install-btn" data-install>${t("install")}</button>` : "";
}

// ---------- نوافذ / رسائل ----------
function openModal(html) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); });
  document.body.appendChild(m);
  return m;
}
let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

// ---------- الإشعارات ----------
function renderNotif(status = getStatus()) {
  const banner = $("#notif-banner");
  banner.hidden = !["default", "ios-install"].includes(status) || !store.get(K.welcome);
  banner.querySelector("span").textContent = status === "ios-install" ? t("bannerIos") : t("bannerText");
  banner.querySelector("button").hidden = status === "ios-install";
  const map = {
    "ios-install": [t("nIosT"), t("iosNote"), ""],
    granted: [t("nGrantedT"), t("nGranted"), ""],
    default: [t("nDefaultT"), t("nDefault"), `<button class="btn btn-yellow btn-block" data-enable-notif>${t("enableNotif")}</button>`],
    denied: [t("nDeniedT"), t("nDenied"), ""],
    unsupported: [t("nUnsupT"), t("nUnsup"), ""]
  };
  const [title, text, action] = map[status] || map.default;
  $("#notif-status").innerHTML = `<svg class="big-icon"><use href="#i-bell"/></svg><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}`;
}

// ---------- التنقل ----------
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("offer/")) return { name: "offer", id: decodeURIComponent(h.slice(6)) };
  if (h.startsWith("product/")) return { name: "product", id: decodeURIComponent(h.slice(8)) };
  if (["cart", "products", "assistant", "about", "notifications"].includes(h)) return { name: h };
  return { name: "home" };
}

function renderRoute(r = currentRoute()) {
  if (r.name === "home") renderHome();
  if (r.name === "offer") renderOffer(r.id);
  if (r.name === "products") renderCatalog();
  if (r.name === "product") renderProduct(r.id);
  if (r.name === "cart") renderCart();
  if (r.name === "assistant") renderChat();
  if (r.name === "about") renderAbout();
  if (r.name === "notifications") renderNotif();
}

function rerender() {
  renderRoute();
  if (currentRoute().name !== "home") renderHome();
  renderHomeAlerts();
  updateCartBadge();
  renderNotif();
}

function route() {
  const r = currentRoute();
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${r.name}`).classList.add("active");
  $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === r.name ||
    (r.name === "offer" && a.dataset.nav === "home") || (r.name === "product" && a.dataset.nav === "products")));
  renderRoute(r);
  if (r.name === "assistant" && state.pendingAsk) { const q = state.pendingAsk; state.pendingAsk = ""; ask(q); }
  window.scrollTo(0, 0);
}

// ---------- الأحداث ----------
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-lang-toggle]")) { toggleLang(); rerender(); return; }
  const back = e.target.closest("[data-back]");
  if (back) { if (history.length > 1) history.back(); else location.hash = back.dataset.back; return; }
  const shareBtn = e.target.closest("[data-share]");
  if (shareBtn) { shareOffer(shareBtn.dataset.share); return; }
  if (e.target.closest("[data-install]")) { installApp(); return; }
  if (e.target.closest("[data-follow-reorder]")) { followupReorder(); return; }

  const kindBtn = e.target.closest("[data-kind]");
  if (kindBtn) { state.kind = kindBtn.dataset.kind; store.set(K.kind, state.kind); renderHome(); return; }
  const co = e.target.closest("[data-company]");
  if (co) { state.company = co.dataset.company; renderRoute(); return; }
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

  const askBtn = e.target.closest("[data-ask]");
  if (askBtn) { ask(askBtn.dataset.ask); return; }
  const askProduct = e.target.closest("[data-ask-product]");
  if (askProduct) {
    const p = state.productById.get(askProduct.dataset.askProduct);
    if (p) { state.pendingAsk = p.name; location.hash = "#/assistant"; }
    return;
  }

  if (e.target.closest("[data-enable-notif]")) {
    const s = await enableNotifications();
    if (s === "granted") toast(t("toastGranted"));
    else if (s === "denied") toast(t("toastDenied"));
  }
});

$("#cart-body").addEventListener("submit", (e) => { e.preventDefault(); submitOrder(e.target); });
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  ask(input.value);
  input.value = "";
});
$("#search").addEventListener("input", (e) => { state.search = e.target.value; renderHome(); });
$("#products-search").addEventListener("input", (e) => { state.productSearch = e.target.value; renderCatalog(); });
setupVoiceSearch($("#search"), toast);
setupVoiceSearch($("#products-search"), toast);
setupVoiceSearch($("#chat-input"), toast);

$("#welcome-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  await enableNotifications(); // طلب الإذن لازم يبدأ في نفس الضغطة
  store.set(K.welcome, "1");
  $("#welcome").hidden = true;
  btn.disabled = false;
  location.hash = "#/";
  route();
  renderNotif();
  showFollowup();
});

window.addEventListener("hashchange", route);
window.addEventListener("storage", (e) => { if (e.key === K.cart) rerender(); });
document.addEventListener("langchange", () => { $("#welcome-ios").textContent = t("iosNote"); });
onNotifChange(renderNotif);

// ---------- البداية ----------
reloadOnNewServiceWorker();
applyStatic();
$("#welcome-ios").textContent = t("iosNote");
if (getStatus() === "granted") store.set(K.welcome, "1");
if (!store.get(K.welcome)) {
  $("#welcome").hidden = false;
  $("#welcome-ios").hidden = !needsIOSInstall();
}
route();
updateCartBadge();
loadAll();
initNotifications();

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installPrompt = e; renderHomeAlerts(); if (currentRoute().name === "about") renderAbout(); });
window.addEventListener("appinstalled", () => { state.installPrompt = null; rerender(); toast(t("installDone")); });
window.addEventListener("load", registerAppServiceWorker);
