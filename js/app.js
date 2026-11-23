import { isFirebaseConfigured, WHATSAPP_NUMBER } from "./firebase-config.js";
import { allCategories, esc, safeUrl, safeImage, money, num, calcTotals } from "./utils.js";
import {
  initNotifications, enableNotifications, getStatus, onNotifChange, needsIOSInstall, registerAppServiceWorker
} from "./notifications.js";

const $ = (s, el = document) => el.querySelector(s);
const WELCOME_KEY = "vip_welcomed";
const CACHE_KEY = "vip_offers_cache";

const state = { offers: [], loaded: false, company: "", category: "الكل", about: null, productImages: new Map() };
const IMAGES_KEY = "vip_product_images";

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
async function loadOffers() {
  const cached = store.get(CACHE_KEY);
  if (cached) {
    try { state.offers = JSON.parse(cached); state.loaded = true; renderHome(); } catch {}
  }
  try {
    const { db, collection, getDocs, query, orderBy } = await firestore();
    const snap = await getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc")));
    state.offers = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: data.createdAt?.toMillis?.() || 0 };
    });
    state.loaded = true;
    store.set(CACHE_KEY, JSON.stringify(state.offers));
  } catch (e) {
    console.error(e);
    if (!state.loaded) {
      state.error = e.message === "not-configured"
        ? "لسه إعدادات Firebase متحطتش في js/firebase-config.js"
        : "مش قادرين نحمّل العروض دلوقتي، اتأكد من النت وجرّب تاني";
    }
  }
  renderHome();
  if (currentRoute().name === "offer") renderOffer(currentRoute().id);
  loadProductImages();
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
  const ids = [...new Set(state.offers.flatMap((o) => (o.products || [])
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
  if (currentRoute().name === "offer") renderOffer(currentRoute().id);
}

function renderFilters() {
  const sel = $("#company-filter");
  const companies = [...new Set(state.offers.map((o) => o.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  sel.innerHTML = `<option value="">كل الشركات</option>` +
    companies.map((c) => `<option value="${esc(c)}"${c === state.company ? " selected" : ""}>${esc(c)}</option>`).join("");

  $("#category-chips").innerHTML = ["الكل", ...allCategories(state.offers)].map((c) =>
    `<button type="button" class="chip${c === state.category ? " active" : ""}" data-cat="${esc(c)}" role="tab" aria-selected="${c === state.category}">${esc(c)}</button>`
  ).join("");
}

function thumbs(o) {
  const imgs = (o.products || []).map(itemImage).filter(Boolean);
  if (!imgs.length) return "";
  const shown = imgs.slice(0, 4);
  return `<div class="thumbs">${shown.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join("")}${imgs.length > 4 ? `<span class="more">+${imgs.length - 4}</span>` : ""}</div>`;
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
      <div class="company"><svg><use href="#i-check"/></svg>${esc(o.company)}</div>
      <div class="meta">${esc(o.category)} · ${t.items} صنف</div>
      <h2 class="offer-name">${esc(o.name)}</h2>
      <p class="products-short">${esc(short)}</p>
      ${thumbs(o)}
      <div class="price-row">
        <span class="price-new">${money(t.totalOffer)}</span>
        <span class="price-old">${money(t.totalPublic)}</span>
      </div>
      <a class="btn btn-purple btn-block" href="#/offer/${encodeURIComponent(o.id)}">التفاصيل</a>
    </div>
  </article>`;
}

function renderHome() {
  renderFilters();
  const list = $("#offers-list");
  if (!state.loaded) {
    if (state.error) list.innerHTML = `<p class="state-msg">${esc(state.error)}</p>`;
    return;
  }
  const items = state.offers.filter((o) =>
    (!state.company || o.company === state.company) &&
    (state.category === "الكل" || o.category === state.category)
  );
  list.innerHTML = items.length
    ? items.map(offerCard).join("")
    : `<p class="state-msg">مفيش عروض هنا دلوقتي، فعّل الإشعارات وهنبلغك أول ما ينزل عرض جديد</p>`;
}

// ---------- تفاصيل العرض ----------
function whatsappLink(text) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function renderOffer(id) {
  const body = $("#d-body");
  const o = state.offers.find((x) => x.id === id);
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

  body.innerHTML = `
    ${img ? `<img src="${esc(img)}" alt="" style="margin-top:16px;border-radius:16px;width:100%">` : ""}
    <div class="panel">
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
        <div class="save"><span>هتوفّر</span><span id="s-save"></span></div>
      </div>
    </div>
    <a id="wa-btn" class="btn btn-green btn-block" style="margin-top:16px" target="_blank" rel="noopener">
      <svg><use href="#i-wa"/></svg>اطلب على واتساب
    </a>`;

  let qty = 1;
  const update = () => {
    $("#qty").textContent = qty;
    $("#s-public").textContent = money(t.totalPublic * qty);
    $("#s-total").textContent = money(t.totalOffer * qty);
    $("#s-save").textContent = money((t.totalPublic - t.totalOffer) * qty);
    const msg =
      `أهلاً، عايز أطلب العرض ده:\n` +
      `العرض: ${o.name}\n` +
      `الشركة: ${o.company}\n` +
      `الكمية: ${qty} كورس\n` +
      `الإجمالي: ${money(t.totalOffer * qty)}`;
    $("#wa-btn").href = whatsappLink(msg);
  };
  body.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    qty = Math.min(999, Math.max(1, qty + Number(b.dataset.step)));
    update();
  }));
  update();
}

// ---------- مانجر مروة ----------
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
  if (h === "notifications") return { name: "notifications" };
  if (h === "about") return { name: "about" };
  return { name: "home" };
}

function route() {
  const r = currentRoute();
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${r.name}`).classList.add("active");
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === r.name || (r.name === "offer" && a.dataset.nav === "home")));
  if (r.name === "offer") renderOffer(r.id);
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
loadOffers();
initNotifications();
window.addEventListener("load", registerAppServiceWorker);
