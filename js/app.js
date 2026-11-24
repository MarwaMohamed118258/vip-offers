import { isFirebaseConfigured, WHATSAPP_NUMBER } from "./firebase-config.js";
import {
  allCategories, esc, safeUrl, safeImage, money, num, calcTotals, offerStatus, endLabel
} from "./utils.js";
import {
  getCart, addToCart, setQty, removeFromCart, clearCart, cartCount,
  getPharmacy, savePharmacy, getLastOrder, saveLastOrder, buildOrderMessage
} from "./cart.js";
import {
  initNotifications, enableNotifications, getStatus, onNotifChange, needsIOSInstall, registerAppServiceWorker
} from "./notifications.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const WELCOME_KEY = "vip_welcomed";
const CACHE_KEY = "vip_offers_cache";
const IMAGES_KEY = "vip_product_images";
const CATS_KEY = "vip_categories";
const THANKS = "هيتم تسجيل طلبك ونشكر سيادتكم على ثقتك ونسعد باستمرار التعاون المثمر معك ❤️";

const state = {
  offers: [], loaded: false, fresh: false, company: "", category: "الكل",
  about: null, productImages: new Map(), savedCategories: []
};

// ---------- تخزين محلي آمن ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

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

// ---------- العروض ----------
// العروض المنتهية بتستخبى من العملاء تلقائياً
const visibleOffers = () => state.offers.filter((o) => !offerStatus(o).expired);
const findAvailable = (id) => visibleOffers().find((o) => o.id === id) || null;

async function loadOffers() {
  const cached = store.get(CACHE_KEY);
  if (cached) {
    try { state.offers = JSON.parse(cached); state.loaded = true; rerender(); } catch {}
  }
  try {
    const { db, collection, getDocs, query, orderBy } = await firestore();
    const snap = await getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc")));
    state.offers = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: data.createdAt?.toMillis?.() || 0, updatedAt: undefined };
    });
    state.loaded = true;
    state.fresh = true;
    store.set(CACHE_KEY, JSON.stringify(state.offers));
    pruneCart();
  } catch (e) {
    console.error(e);
    if (!state.loaded) {
      state.error = e.message === "not-configured"
        ? "لسه إعدادات Firebase متحطتش في js/firebase-config.js"
        : "مش قادرين نحمّل العروض دلوقتي، اتأكد من النت وجرّب تاني";
    }
  }
  rerender();
  loadProductImages();
  loadCategories();
}

// الأقسام اللي الأدمن ضافها (settings/categories) بتظهر في الفلتر حتى لو لسه مفيش عروض فيها
async function loadCategories() {
  try { state.savedCategories = JSON.parse(store.get(CATS_KEY) || "[]"); } catch {}
  try {
    const { db, doc, getDoc } = await firestore();
    const snap = await getDoc(doc(db, "settings", "categories"));
    const list = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list.filter((c) => typeof c === "string") : [];
    state.savedCategories = list;
    store.set(CATS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("categories", e);
  }
  renderHome();
}

// بعد ما العروض تتحمّل من النت: نشيل من السلة أي عرض اتمسح أو خلص
function pruneCart() {
  const gone = getCart().filter((x) => !findAvailable(x.id)).map((x) => x.id);
  if (gone.length) {
    removeFromCart(...gone);
    toast(gone.length === 1 ? "اتشال عرض من السلة لأنه خلص" : `اتشال ${gone.length} عروض من السلة لأنها خلصت`);
  }
}

// ---------- صور المنتجات ----------
// الصور المرفوعة محفوظة في مستند المنتج (products/{id})، فبنجيبها للمنتجات اللي في العروض بس
function itemImage(it) {
  return safeImage(it.image) || safeImage(state.productImages.get(it.productId));
}

async function loadProductImages() {
  if (!state.productImages.size) {
    try { state.productImages = new Map(JSON.parse(store.get(IMAGES_KEY) || "[]")); } catch {}
    if (state.productImages.size) rerender();
  }
  const ids = [...new Set(visibleOffers().flatMap((o) => (o.products || [])
    .filter((it) => it.productId && !safeImage(it.image)).map((it) => it.productId)))];
  if (!ids.length) return;
  try {
    const { db, collection, getDocs, query, where, documentId } = await firestore();
    const fresh = new Map();
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await getDocs(query(collection(db, "products"), where(documentId(), "in", ids.slice(i, i + 30))));
      snap.forEach((d) => { const img = safeImage(d.data().image); if (img) fresh.set(d.id, img); });
    }
    state.productImages = fresh;
    const json = JSON.stringify([...fresh]);
    if (json.length < 2_000_000) store.set(IMAGES_KEY, json); // نحفظها عشان تظهر بسرعة ومن غير نت
    rerender();
  } catch (e) {
    console.warn("product images", e);
  }
}

function rerender() {
  renderHome();
  const r = currentRoute();
  if (r.name === "offer") renderOffer(r.id);
  if (r.name === "cart") renderCart();
  updateCartBadge();
  updateReorder();
}

// ---------- أجزاء مشتركة ----------
function badges(o) {
  const s = offerStatus(o);
  const out = [];
  if (s.isNew) out.push(`<span class="badge badge-new">جديد</span>`);
  if (s.endingSoon) out.push(`<span class="badge badge-ending">⏳ ${endLabel(s.daysLeft)}</span>`);
  return out.length ? `<div class="badges">${out.join("")}</div>` : "";
}

const profitText = (amount) => `مكسبك لو بعت بسعر الجمهور: ${money(amount)}`;

function thumbs(o) {
  const imgs = (o.products || []).map(itemImage).filter(Boolean);
  if (!imgs.length) return "";
  const shown = imgs.slice(0, 4);
  return `<div class="thumbs">${shown.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join("")}${imgs.length > 4 ? `<span class="more">+${imgs.length - 4}</span>` : ""}</div>`;
}

// ---------- الصفحة الرئيسية ----------
function renderFilters(offers) {
  const sel = $("#company-filter");
  const companies = [...new Set(offers.map((o) => o.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  sel.innerHTML = `<option value="">كل الشركات</option>` +
    companies.map((c) => `<option value="${esc(c)}"${c === state.company ? " selected" : ""}>${esc(c)}</option>`).join("");

  $("#category-chips").innerHTML = ["الكل", ...allCategories(offers, state.savedCategories)].map((c) =>
    `<button type="button" class="chip${c === state.category ? " active" : ""}" data-cat="${esc(c)}" role="tab" aria-selected="${c === state.category}">${esc(c)}</button>`
  ).join("");
}

function offerCard(o) {
  const t = calcTotals(o.products);
  const products = (o.products || []).map((p) => p.name).filter(Boolean);
  const short = products.slice(0, 3).join("، ") + (products.length > 3 ? ` و${products.length - 3} كمان` : "");
  const img = safeUrl(o.imageUrl);
  return `
  <article class="offer-card">
    ${img ? `<img class="img" src="${esc(img)}" alt="" loading="lazy">` : ""}
    ${t.discount > 0 ? `<span class="discount-badge">خصم ${t.discount}%</span>` : ""}
    <div class="body">
      ${badges(o)}
      <div class="company"><svg><use href="#i-check"/></svg>${esc(o.company)}</div>
      <div class="meta">${esc(o.category)} · ${t.items} صنف</div>
      <h2 class="offer-name">${esc(o.name)}</h2>
      <p class="products-short">${esc(short)}</p>
      ${thumbs(o)}
      <div class="price-row">
        <span class="price-new">${money(t.totalOffer)}</span>
        <span class="price-old">${money(t.totalPublic)}</span>
      </div>
      ${t.totalPublic > t.totalOffer ? `<p class="profit">${profitText(t.totalPublic - t.totalOffer)}</p>` : ""}
      <div class="card-actions">
        <a class="btn btn-purple" href="#/offer/${encodeURIComponent(o.id)}">التفاصيل</a>
        <button type="button" class="btn btn-yellow" data-add="${esc(o.id)}" aria-label="أضف للسلة"><svg><use href="#i-cart"/></svg>أضف</button>
      </div>
    </div>
  </article>`;
}

function renderHome() {
  const offers = visibleOffers();
  renderFilters(offers);
  const list = $("#offers-list");
  if (!state.loaded) {
    if (state.error) list.innerHTML = `<p class="state-msg">${esc(state.error)}</p>`;
    return;
  }
  const items = offers.filter((o) =>
    (!state.company || o.company === state.company) &&
    (state.category === "الكل" || o.category === state.category)
  );
  list.innerHTML = items.length
    ? items.map(offerCard).join("")
    : `<p class="state-msg">مفيش عروض هنا دلوقتي، فعّل الإشعارات وهنبلغك أول ما ينزل عرض جديد</p>`;
}

// ---------- تفاصيل العرض ----------
function renderOffer(id) {
  const body = $("#d-body");
  const o = findAvailable(id);
  if (!o) {
    $("#d-name").textContent = "تفاصيل العرض";
    $("#d-company").textContent = "";
    body.innerHTML = state.loaded
      ? `<p class="state-msg">العرض ده مش موجود أو خلص</p><a class="btn btn-purple btn-block" href="#/">ارجع للعروض</a>`
      : `<div class="skeleton" style="margin-top:16px"></div>`;
    return;
  }
  const t = calcTotals(o.products);
  const img = safeUrl(o.imageUrl);
  $("#d-name").textContent = o.name || "تفاصيل العرض";
  $("#d-company").textContent = `${o.company || ""} · ${o.category || ""}`;

  const rows = (o.products || []).map((p) => {
    const q = Math.max(1, num(p.qty) || 1);
    return `<tr>
      <td><div class="item-cell">${itemImage(p) ? `<img src="${esc(itemImage(p))}" alt="" loading="lazy">` : ""}<span>${esc(p.name)}</span></div></td>
      <td class="num">${q}</td>
      <td class="num old">${money(num(p.publicPrice) * q)}</td>
      <td class="num new">${money(num(p.offerPrice) * q)}</td>
    </tr>`;
  }).join("");

  // نحافظ على الكمية لو الصفحة اترسمت تاني (مثلاً بعد ما الصور تتحمّل)
  const prevQty = body.dataset.offerId === o.id ? Number(body.dataset.qty) || 1 : 1;
  body.dataset.offerId = o.id;

  body.innerHTML = `
    ${img ? `<img src="${esc(img)}" alt="" style="margin-top:16px;border-radius:16px;width:100%">` : ""}
    <div class="panel">
      ${badges(o)}
      <div class="price-row" style="justify-content:space-between">
        <div class="company"><svg><use href="#i-check"/></svg>${esc(o.company)}</div>
        ${t.discount > 0 ? `<span class="discount-badge" style="position:static">خصم ${t.discount}%</span>` : ""}
      </div>
      <div class="table-wrap">
        <table class="items">
          <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الجمهور</th><th>سعر العرض</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td>الإجمالي</td><td class="num">${t.items}</td>
            <td class="num old">${money(t.totalPublic)}</td>
            <td class="num new">${money(t.totalOffer)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="stepper-row">
        <b>عدد الكورسات</b>
        <div class="stepper">
          <button type="button" data-step="1" aria-label="زوّد">+</button>
          <output id="qty" aria-live="polite">1</output>
          <button type="button" data-step="-1" aria-label="قلّل">−</button>
        </div>
      </div>
      <div class="summary">
        <div><span>سعر الجمهور</span><span class="price-old" id="s-public"></span></div>
        <div class="total"><span>الإجمالي</span><span id="s-total"></span></div>
      </div>
      <p class="profit" id="s-profit" style="margin:12px 0 0"></p>
    </div>
    <div class="form-grid" style="margin-top:16px">
      <button type="button" id="add-cart-btn" class="btn btn-yellow btn-block"><svg><use href="#i-cart"/></svg>أضف للسلة</button>
      <button type="button" id="wa-btn" class="btn btn-green btn-block"><svg><use href="#i-wa"/></svg>اطلب على واتساب</button>
    </div>`;

  let qty = prevQty;
  const update = () => {
    body.dataset.qty = qty;
    $("#qty").textContent = qty;
    $("#s-public").textContent = money(t.totalPublic * qty);
    $("#s-total").textContent = money(t.totalOffer * qty);
    $("#s-profit").textContent = profitText((t.totalPublic - t.totalOffer) * qty);
  };
  $$("[data-step]", body).forEach((b) => b.addEventListener("click", () => {
    qty = Math.min(999, Math.max(1, qty + Number(b.dataset.step)));
    update();
  }));
  $("#add-cart-btn").addEventListener("click", () => {
    addToCart(o.id, qty);
    toast(`اتضاف للسلة (${qty}) ✅`);
  });
  $("#wa-btn").addEventListener("click", () => startOrder([{ id: o.id, qty }], false));
  update();
}

// ---------- السلة ----------
function cartLines() {
  return getCart().map((x) => {
    const o = findAvailable(x.id);
    if (!o) return null;
    const t = calcTotals(o.products);
    return { id: o.id, qty: x.qty, offer: o, unitPrice: t.totalOffer, unitPublic: t.totalPublic };
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
          : `<b>بيانات الصيدلية / المخزن</b><div class="meta">هنسألك عنها أول مرة تبعت فيها طلب</div>`}
      </div>
      <button type="button" class="btn btn-sm btn-ghost" data-edit-pharm>${pharm ? "تعديل" : "ضيف البيانات"}</button>
    </div>`;
  const reorderBtn = `<button type="button" class="btn btn-ghost btn-block" data-reorder hidden style="margin-top:16px">🔁 اطلب نفس طلبك اللي فات</button>`;

  if (!state.loaded) { body.innerHTML = `<div class="skeleton" style="margin-top:16px"></div>`; return; }
  const lines = cartLines();
  if (!lines.length) {
    body.innerHTML = `
      ${reorderBtn}
      <div class="panel state-msg">
        <svg width="56" height="56" style="color:var(--purple)"><use href="#i-cart"/></svg>
        <p style="margin:8px 0 14px">السلة فاضية</p>
        <a class="btn btn-purple btn-block" href="#/">شوف العروض</a>
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
            ${img ? `<img class="thumb" src="${esc(img)}" alt="">` : ""}
            <div class="info">
              <b>${esc(l.offer.name)}</b>
              <div class="meta">${esc(l.offer.company)} · ${money(l.unitPrice)} للكورس</div>
            </div>
            <button type="button" class="remove-btn" data-remove="${esc(l.id)}">شيل</button>
          </div>
          <div class="line">
            <div class="stepper sm">
              <button type="button" data-cart-step="1" data-id="${esc(l.id)}" aria-label="زوّد">+</button>
              <output>${l.qty}</output>
              <button type="button" data-cart-step="-1" data-id="${esc(l.id)}" aria-label="قلّل">−</button>
            </div>
            <span class="price-new" style="font-size:20px">${money(l.qty * l.unitPrice)}</span>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="panel">
      <div class="grand"><span>الإجمالي</span><span>${money(total)}</span></div>
      ${profit > 0 ? `<p class="profit" style="margin:10px 0 0">${profitText(profit)}</p>` : ""}
    </div>
    ${pharmBox}
    <button type="button" id="send-order" class="btn btn-green btn-block" style="margin-top:16px"><svg><use href="#i-wa"/></svg>ابعت الطلب</button>
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
  if (!available.length) { toast("العروض دي مبقتش متاحة"); return; }
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
    <h2>بيانات الصيدلية / المخزن</h2>
    <p>بنسجّلها مرة واحدة على جهازك وبتتبعت مع كل طلب.</p>
    <form class="form-grid">
      <div class="field"><label for="ph-name">اسم الصيدلية / المخزن</label><input id="ph-name" class="input" required value="${esc(p.name)}" autocomplete="organization"></div>
      <div class="field"><label for="ph-area">المنطقة</label><input id="ph-area" class="input" required value="${esc(p.area)}"></div>
      <button type="submit" class="btn ${sending ? "btn-green" : "btn-purple"} btn-block">${sending ? `<svg><use href="#i-wa"/></svg>احفظ وابعت الطلب` : "حفظ"}</button>
      <button type="button" class="btn btn-ghost btn-block" data-close>إلغاء</button>
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
    else { renderCart(); toast("اتحفظت البيانات ✅"); }
  });
}

function showThanks() {
  openModal(`
    <div class="thanks">
      <p>${THANKS}</p>
      <button type="button" class="btn btn-purple btn-block" data-close>تمام</button>
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
  toast(missing > 0
    ? `اتضاف ${items.length} عرض للسلة، و${missing} مبقاش متاح`
    : "اتضاف طلبك اللي فات للسلة ✅");
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
    body.innerHTML = `<p class="state-msg">مش قادرين نحمّل الصفحة دلوقتي، جرّب تاني</p>`;
    return;
  }
  renderAbout();
}

function renderAbout() {
  const a = state.about || {};
  const photo = safeUrl(a.photoUrl);
  const courses = (a.courses || []).filter(Boolean);
  const reviews = (a.reviews || []).map(safeUrl).filter(Boolean);
  $("#about-body").innerHTML = `
    <div class="panel about-hero">
      ${photo ? `<img class="avatar" src="${esc(photo)}" alt="مانجر مروة">` : `<div class="avatar" style="display:grid;place-items:center;color:var(--purple)"><svg width="64" height="64"><use href="#i-user"/></svg></div>`}
      <h2>${esc(a.name || "مانجر مروة")}</h2>
      ${num(a.years) ? `<span class="years-pill">خبرة ${num(a.years)} سنين</span>` : ""}
      ${a.bio ? `<p style="margin:12px 0 0">${esc(a.bio)}</p>` : ""}
    </div>
    ${courses.length ? `<div class="panel"><h3 class="section-title">الكورسات</h3><ul class="courses">${courses.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    ${reviews.length ? `<div class="panel"><h3 class="section-title">آراء العملاء</h3><div class="reviews">${reviews.map((r) => `<img src="${esc(r)}" alt="رأي عميل" loading="lazy" data-zoom>`).join("")}</div></div>` : ""}
    <a class="btn btn-green btn-block" style="margin-top:16px" target="_blank" rel="noopener"
       href="${whatsappLink("أهلاً، عايز أستفسر عن العروض")}"><svg><use href="#i-wa"/></svg>كلّمني على واتساب</a>`;
}

// ---------- الإشعارات ----------
const IOS_NOTE = "على الآيفون: ضيف التطبيق للشاشة الرئيسية الأول (زرار المشاركة ← «إضافة إلى الشاشة الرئيسية»)، وبعدين افتحه من الأيقونة وفعّل الإشعارات.";

function renderNotif(status = getStatus()) {
  const banner = $("#notif-banner");
  banner.hidden = !["default", "denied", "ios-install"].includes(status) || !store.get(WELCOME_KEY);
  banner.querySelector("span").textContent = status === "ios-install"
    ? "على الآيفون: ضيف التطبيق للشاشة الرئيسية الأول عشان الإشعارات"
    : "فعّل الإشعارات عشان ميفوتكش أي عرض";
  banner.querySelector("button").hidden = status === "ios-install";
  const box = $("#notif-status");
  const map = {
    "ios-install": ["ضيف التطبيق للشاشة الرئيسية الأول", IOS_NOTE, ""],
    granted: ["الإشعارات شغّالة ✅", "هيوصلك إشعار مع كل عرض جديد بس، ومن غير إزعاج.", ""],
    default: ["الإشعارات مش متفعّلة", "فعّلها عشان ميفوتكش أي عرض جديد.", `<button class="btn btn-yellow btn-block" data-enable-notif>فعّل الإشعارات</button>`],
    denied: ["الإشعارات مقفولة من المتصفح", "افتح إعدادات الموقع في المتصفح (علامة القفل جنب الرابط) وخلّي الإشعارات «سماح»، وبعدين ارجع هنا.", ""],
    unsupported: ["المتصفح ده مش بيدعم الإشعارات", "على الآيفون: اضغط زرار المشاركة واختار «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الأيقونة وفعّل الإشعارات.", ""]
  };
  const [title, text, action] = map[status] || map.default;
  box.innerHTML = `<svg class="big-icon"><use href="#i-bell"/></svg><h2>${title}</h2><p>${text}</p>${action}`;
}

// ---------- التنقل ----------
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("offer/")) return { name: "offer", id: decodeURIComponent(h.slice(6)) };
  if (["notifications", "about", "cart"].includes(h)) return { name: h };
  return { name: "home" };
}

function route() {
  const r = currentRoute();
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${r.name}`).classList.add("active");
  $$("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === r.name || (r.name === "offer" && a.dataset.nav === "home")));
  if (r.name === "offer") renderOffer(r.id);
  if (r.name === "cart") renderCart();
  if (r.name === "about" && !state.about) loadAbout();
  if (r.name === "notifications") renderNotif();
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

// ---------- الأحداث ----------
document.addEventListener("click", async (e) => {
  const chip = e.target.closest("[data-cat]");
  if (chip) { state.category = chip.dataset.cat; renderHome(); return; }

  const add = e.target.closest("[data-add]");
  if (add) { addToCart(add.dataset.add, 1); toast("اتضاف للسلة ✅"); return; }

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
    if (s === "granted") toast("تمام! هيوصلك إشعار مع كل عرض جديد");
    else if (s === "denied") toast("الإشعارات مقفولة، تقدر تفتحها من إعدادات المتصفح");
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
