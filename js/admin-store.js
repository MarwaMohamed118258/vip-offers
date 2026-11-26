// لوحة الأدمن: Offers Store (الطلبات، المتابعة الشهرية، الأسئلة والإجابات، الشركات، الإعدادات)
import { db } from "./firebase.js";
import {
  collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, query, orderBy, limit,
  serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, money, num, normTitle, toMillis, safeUrl, safeImage } from "./core.js";
import {
  STORE_STATUSES, STORE_DELIVERED, FOLLOWUP_DAYS, FOLLOWUP_TEXT, STARTER_FAQ, GENERAL,
  storeSettings, waNumber, cleanEgPhone, EG_PHONE_RE, normAr, askAssistant, fillAnswer, isGeneral, splitKeywords
} from "./store-shared.js";
import { compressImage, imageKB } from "./image.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DAY = 86400000;

let ctx = null; // { getOffers, getProducts, getNamesEn, companiesFromData }
let companies = [], companiesLoaded = false;
let sorders = [], sordersLoaded = false, soStatus = "الكل";
let faqs = [];
let settings = storeSettings(null);

function errText(e) {
  if (e?.code === "permission-denied") return "مفيش صلاحية. لازم تكوني داخلة بحساب الأدمن.";
  if (e?.code === "invalid-argument") return "البيانات كبيرة أو فيها مشكلة، جرّبي صورة أصغر";
  return "حصلت مشكلة، جرّبي تاني";
}
function showMsg(el, text, ok = false) {
  el.hidden = !text;
  el.textContent = text || "";
  el.style.color = ok ? "var(--green)" : "var(--red)";
}
const fmtDate = (ms) => ms ? new Date(ms).toLocaleString("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const orderCode = (id) => String(id || "").slice(0, 6).toUpperCase();
const statusClass = (s) => ({ "جديد": "st-new", "تم التأكيد": "st-contacted", "اتشحن": "st-contacted", [STORE_DELIVERED]: "st-done", "ملغي": "st-cancel" }[s] || "");
const telHref = (p) => "tel:" + String(p || "").replace(/[^+0-9]/g, "");

// كل أسامي الشركات: المتسجّلة + اللي في العروض والمنتجات
function allCompanyNames() {
  const seen = new Map();
  for (const n of [...companies.map((c) => c.name), ...ctx.companiesFromData()]) if (n && !seen.has(normTitle(n))) seen.set(normTitle(n), n);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ar"));
}

// =====================================================================
// الشركات
// =====================================================================
let editingCompany = null;
let pendingLogo = "";

async function loadCompanies() {
  try {
    const snap = await getDocs(collection(db, "companies"));
    companies = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => num(a.order) - num(b.order) || String(a.name).localeCompare(String(b.name), "ar"));
    companiesLoaded = true;
  } catch (e) {
    console.error(e);
    $("#co-list").innerHTML = `<p class="error">${esc(errText(e))}</p>`;
    return;
  }
  renderCompanies();
}

function renderCompanies() {
  const registered = new Set(companies.map((c) => normTitle(c.name)));
  const missing = ctx.companiesFromData().filter((n) => !registered.has(normTitle(n)));
  const count = (name) => {
    const k = normTitle(name);
    return { offers: ctx.getOffers().filter((o) => normTitle(o.company) === k).length, products: ctx.getProducts().filter((p) => normTitle(p.company) === k).length };
  };
  $("#co-list").innerHTML = [
    ...companies.map((c) => {
      const n = count(c.name);
      const logo = safeImage(c.logo);
      return `<div class="admin-item">
        ${logo ? `<img class="thumb" src="${esc(logo)}" alt="">` : `<div class="thumb"></div>`}
        <div class="info"><b>${esc(c.name)}${c.nameEn ? ` <span class="meta" dir="ltr">${esc(c.nameEn)}</span>` : ""}</b>
          <small>${n.offers} عرض · ${n.products} منتج</small>
          <div><span class="tag-mini${c.showVip === false ? " off" : ""}">VIP</span><span class="tag-mini${c.showStore === false ? " off" : ""}">Store</span></div></div>
        <button class="btn btn-sm btn-ghost" data-co-edit="${esc(c.id)}">تعديل</button>
        <button class="btn btn-sm btn-red" data-co-del="${esc(c.id)}">مسح</button>
      </div>`;
    }),
    ...missing.map((name) => {
      const n = count(name);
      return `<div class="admin-item muted">
        <div class="thumb"></div>
        <div class="info"><b>${esc(name)}</b><small>مش متسجّلة (بتظهر في الاتنين) · ${n.offers} عرض · ${n.products} منتج</small></div>
        <button class="btn btn-sm btn-purple" data-co-add="${esc(name)}">سجّليها</button>
      </div>`;
    })
  ].join("") || `<p class="state-msg">مفيش شركات لسه</p>`;
}

function setLogo(src, info = "") {
  pendingLogo = safeImage(src);
  $("#co-preview").hidden = !pendingLogo;
  if (pendingLogo) $("#co-preview").src = pendingLogo; else $("#co-preview").removeAttribute("src");
  $("#co-clear").hidden = !pendingLogo;
  if (info) showMsg($("#co-msg"), info, true);
}

function resetCompanyForm() {
  editingCompany = null;
  $("#co-form").reset();
  $("#co-name").readOnly = false;
  setLogo("");
  $("#co-form-title").textContent = "شركة جديدة";
  $("#co-save").textContent = "حفظ الشركة";
  $("#co-cancel").hidden = true;
}

function fillCompanyForm(c) {
  editingCompany = c.id || null;
  $("#co-name").value = c.name || "";
  $("#co-name").readOnly = !!c.id; // الاسم هو الرابط بالعروض والمنتجات، فمبيتغيّرش بعد التسجيل
  $("#co-name-en").value = c.nameEn || ctx.getNamesEn().companies[c.name] || "";
  const logo = safeImage(c.logo);
  $("#co-logo-url").value = logo && !logo.startsWith("data:") ? logo : "";
  setLogo(logo);
  $("#co-vip").checked = c.showVip !== false;
  $("#co-store").checked = c.showStore !== false;
  $("#co-order").value = c.order ?? 100;
  $("#co-form-title").textContent = c.id ? "تعديل الشركة" : "تسجيل شركة";
  $("#co-save").textContent = c.id ? "حفظ التعديل" : "حفظ الشركة";
  $("#co-cancel").hidden = false;
  $("#co-form").scrollIntoView({ behavior: "smooth" });
}

function initCompanies() {
  $("#co-pick").addEventListener("click", () => $("#co-file").click());
  $("#co-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await compressImage(file, { maxSide: 256, maxBytes: 40 * 1024 });
      $("#co-logo-url").value = "";
      setLogo(url, `اللوجو اتصغّر: ${imageKB(url)} KB`);
    } catch (err) { showMsg($("#co-msg"), err.message === "not-image" ? "الملف ده مش صورة" : "مقدرناش نجهّز الصورة"); }
  });
  $("#co-logo-url").addEventListener("input", (e) => setLogo(safeUrl(e.target.value.trim())));
  $("#co-clear").addEventListener("click", () => { $("#co-logo-url").value = ""; setLogo(""); });
  $("#co-cancel").addEventListener("click", resetCompanyForm);

  $("#co-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#co-msg");
    const name = $("#co-name").value.trim().replace(/\s+/g, " ");
    const nameEn = $("#co-name-en").value.trim();
    if (!name) return;
    const dup = companies.find((c) => normTitle(c.name) === normTitle(name) && c.id !== editingCompany);
    if (dup) return showMsg(msg, `الشركة «${dup.name}» متسجّلة قبل كده — اضغطي «تعديل» عليها`);
    // لو الاسم قريب من اسم موجود في العروض (أ/ا، ة/ه…) نستخدم المكتوب في العروض عشان الربط
    const exact = ctx.companiesFromData().find((n) => normTitle(n) === normTitle(name)) || name;
    const data = {
      name: exact, nameEn, logo: pendingLogo,
      showVip: $("#co-vip").checked, showStore: $("#co-store").checked,
      order: num($("#co-order").value), updatedAt: serverTimestamp()
    };
    const btn = $("#co-save"); btn.disabled = true;
    try {
      if (editingCompany) await updateDoc(doc(db, "companies", editingCompany), data);
      else await addDoc(collection(db, "companies"), { ...data, createdAt: serverTimestamp() });
      // الاسم الإنجليزي بيتحفظ كمان في settings/names (اللي بيستخدمه تطبيق VIP)
      const namesEn = ctx.getNamesEn();
      if ((namesEn.companies[exact] || "") !== nameEn) {
        await setDoc(doc(db, "settings", "names"), { companies: { [exact]: nameEn || deleteField() }, updatedAt: serverTimestamp() }, { merge: true });
        if (nameEn) namesEn.companies[exact] = nameEn; else delete namesEn.companies[exact];
      }
      showMsg(msg, editingCompany ? "اتعدّلت الشركة ✅" : "اتسجّلت الشركة ✅", true);
      resetCompanyForm();
      await loadCompanies();
    } catch (err) { console.error(err); showMsg(msg, errText(err)); }
    finally { btn.disabled = false; }
  });

  $("#co-list").addEventListener("click", async (e) => {
    const add = e.target.closest("[data-co-add]");
    if (add) { resetCompanyForm(); fillCompanyForm({ name: add.dataset.coAdd }); return; }
    const edit = e.target.closest("[data-co-edit]");
    if (edit) { const c = companies.find((x) => x.id === edit.dataset.coEdit); if (c) fillCompanyForm(c); return; }
    const del = e.target.closest("[data-co-del]");
    if (del) {
      const c = companies.find((x) => x.id === del.dataset.coDel);
      if (!c || !confirm(`تمسحي تسجيل «${c.name}»؟ العروض والمنتجات مش هتتمسح، والشركة هترجع تظهر في التطبيقين من غير لوجو.`)) return;
      try { await deleteDoc(doc(db, "companies", c.id)); if (editingCompany === c.id) resetCompanyForm(); await loadCompanies(); }
      catch (err) { alert(errText(err)); }
    }
  });
}

// =====================================================================
// طلبات Offers Store
// =====================================================================
async function loadStoreOrders() {
  const box = $("#so-list");
  try {
    const snap = await getDocs(query(collection(db, "consumerOrders"), orderBy("createdAt", "desc"), limit(1000)));
    sorders = snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, ...x, createdAt: toMillis(x.createdAt), deliveredAt: toMillis(x.deliveredAt), followedUpAt: toMillis(x.followedUpAt) };
    });
    sordersLoaded = true;
  } catch (e) {
    console.error(e);
    box.innerHTML = `<p class="error">${esc(errText(e))}</p>`;
    $("#fu-list").innerHTML = `<p class="error">${esc(errText(e))}</p>`;
    return false;
  }
  renderStoreOrders();
  renderFollowups();
  return true;
}

const orderCompanies = (o) => (Array.isArray(o.companies) && o.companies.length ? o.companies : (o.items || []).map((it) => it.company)).filter(Boolean);

function renderStoreOrders() {
  const sel = $("#so-company");
  const cur = sel.value;
  const cos = [...new Set(sorders.flatMap(orderCompanies))].sort((a, b) => a.localeCompare(b, "ar"));
  sel.innerHTML = `<option value="">كل الشركات</option>` + cos.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = cos.includes(cur) ? cur : "";

  const q = normTitle($("#so-search").value);
  const qDigits = $("#so-search").value.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "");
  const byCompany = (o) => !sel.value || orderCompanies(o).includes(sel.value);
  const bySearch = (o) => !q || normTitle(`${o.name} ${o.phone} ${orderCode(o.id)}`).includes(q) || (qDigits.length >= 3 && String(o.phone || "").includes(qDigits));
  const base = sorders.filter((o) => byCompany(o) && bySearch(o));
  $("#so-filters").innerHTML = ["الكل", ...STORE_STATUSES].map((s) => {
    const n = s === "الكل" ? base.length : base.filter((o) => o.status === s).length;
    return `<button type="button" class="chip${s === soStatus ? " active" : ""}" data-sofilter="${esc(s)}">${esc(s)} <span class="meta">${n}</span></button>`;
  }).join("");
  const list = base.filter((o) => soStatus === "الكل" || o.status === soStatus);
  $("#so-list").innerHTML = list.length ? list.map(storeOrderCard).join("") :
    `<p class="state-msg">${sorders.length ? "مفيش طلبات بالفلتر ده" : "مفيش طلبات لسه. أول ما عميل يطلب من Offers Store هيظهر هنا."}</p>`;
}

function storeOrderCard(o) {
  const items = (o.items || []).map((it) =>
    `<li>${esc(it.name)}${it.company ? ` <span class="meta">(${esc(it.company)})</span>` : ""} <span class="meta">× ${num(it.qty)} = ${money(num(it.qty) * num(it.unitPrice))}</span></li>`).join("");
  const wa = waNumber(o.phone);
  return `
  <div class="order-card ${statusClass(o.status)}">
    <div class="order-head">
      <div class="grow">
        <b>${esc(o.name)}</b> <span class="meta">#${esc(orderCode(o.id))}</span>
        <div class="meta">📍 ${esc(o.governorate)} · 🕒 ${esc(fmtDate(o.createdAt))}</div>
      </div>
      <span class="status-pill">${esc(o.status)}</span>
    </div>
    <p class="addr">🏠 ${esc(o.address)}</p>
    ${o.notes ? `<p class="addr">📝 ${esc(o.notes)}</p>` : ""}
    <ul class="order-items">${items}</ul>
    <div class="order-sums"><span>المجموع: ${money(o.subtotal)}</span><span>الشحن: ${num(o.shipping) > 0 ? money(o.shipping) : "مجاني"}</span></div>
    <div class="order-foot">
      <b class="price-new" style="font-size:18px">${money(o.total)}</b>
      <span class="row-gap">
        <a class="btn btn-sm btn-ghost" href="${esc(telHref(o.phone))}" dir="ltr">📞 ${esc(o.phone)}</a>
        ${wa.length >= 12 ? `<a class="btn btn-sm btn-green" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ""}
      </span>
    </div>
    <div class="status-btns">${STORE_STATUSES.map((s) =>
      `<button type="button" class="btn btn-sm ${s === o.status ? "btn-purple" : "btn-ghost"}" data-sostatus="${esc(s)}" data-soorder="${esc(o.id)}"${s === o.status ? " disabled" : ""}>${esc(s)}</button>`).join("")}
    </div>
  </div>`;
}

// «اتسلّم» → storeFollowups/{customerId} (العميل بيقراه بالكود بتاعه بس) عشان رسالة المتابعة بعد 30 يوم
async function setStoreStatus(order, status) {
  const was = order.status === STORE_DELIVERED, will = status === STORE_DELIVERED;
  const batch = writeBatch(db);
  const patch = { status, statusAt: serverTimestamp() };
  if (will && !was) patch.deliveredAt = serverTimestamp();
  if (was && !will) { patch.deliveredAt = deleteField(); patch.followedUpAt = deleteField(); }
  batch.update(doc(db, "consumerOrders", order.id), patch);
  const cid = String(order.customerId || "");
  if (/^[A-Za-z0-9]{24,64}$/.test(cid)) {
    const ref = doc(db, "storeFollowups", cid);
    if (will && !was) {
      batch.set(ref, {
        orderId: order.id, deliveredAt: serverTimestamp(),
        items: (order.items || []).slice(0, 50).map((it) => ({ offerId: String(it.offerId || ""), qty: Math.max(1, num(it.qty)), name: String(it.name || "") }))
      });
    } else if (was && !will) {
      const cur = await getDoc(ref);
      if (cur.exists() && cur.data().orderId === order.id) batch.delete(ref);
    }
  }
  await batch.commit();
  order.status = status;
  if (will && !was) order.deliveredAt = Date.now();
  if (was && !will) { order.deliveredAt = 0; order.followedUpAt = 0; }
  renderStoreOrders();
  renderFollowups();
}

// =====================================================================
// المتابعة الشهرية
// =====================================================================
function dueFollowups(now = Date.now()) {
  const byPhone = new Map();
  for (const o of sorders) {
    if (o.status !== STORE_DELIVERED || !o.deliveredAt || o.followedUpAt || now - o.deliveredAt < FOLLOWUP_DAYS * DAY) continue;
    const k = String(o.phone || o.customerId);
    const e = byPhone.get(k) || { latest: o, orders: [] };
    e.orders.push(o);
    if (o.deliveredAt > e.latest.deliveredAt) e.latest = o;
    byPhone.set(k, e);
  }
  return [...byPhone.values()].sort((a, b) => a.latest.deliveredAt - b.latest.deliveredAt);
}

function renderFollowups() {
  const box = $("#fu-list");
  if (!sordersLoaded) return;
  const rows = dueFollowups();
  box.innerHTML = rows.length ? rows.map(({ latest: o, orders }) => {
    const days = Math.floor((Date.now() - o.deliveredAt) / DAY);
    const wa = waNumber(o.phone);
    const text = `أهلاً ${o.name} 🤍\n${FOLLOWUP_TEXT}`;
    return `<div class="order-card st-done">
      <div class="order-head">
        <div class="grow"><b>${esc(o.name)}</b>
          <div class="meta">📍 ${esc(o.governorate)} · اتسلّم من ${days} يوم (${esc(fmtDate(o.deliveredAt))})</div></div>
      </div>
      <ul class="order-items">${(o.items || []).map((it) => `<li>${esc(it.name)} <span class="meta">× ${num(it.qty)}</span></li>`).join("")}</ul>
      <div class="order-foot">
        <a class="btn btn-sm btn-ghost" href="${esc(telHref(o.phone))}" dir="ltr">📞 ${esc(o.phone)}</a>
        <span class="row-gap">
          ${wa.length >= 12 ? `<a class="btn btn-sm btn-green" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 ابعتي على واتساب</a>` : ""}
          <button type="button" class="btn btn-sm btn-purple" data-fu-done="${esc(orders.map((x) => x.id).join(","))}">✅ اتواصلت</button>
        </span>
      </div>
    </div>`;
  }).join("") : `<p class="state-msg">مفيش عملاء محتاجين متابعة دلوقتي 🌿</p>`;
}

// =====================================================================
// أسئلة وإجابات
// =====================================================================
let editingFaq = null;

async function loadFaq() {
  try {
    const snap = await getDocs(collection(db, "faq"));
    faqs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => num(a.order) - num(b.order) || String(a.question).localeCompare(String(b.question), "ar"));
  } catch (e) {
    console.error(e);
    $("#faq-list").innerHTML = `<p class="error">${esc(errText(e))}</p>`;
    return;
  }
  renderFaq();
  runFaqTest();
}

function fillFaqSelects(company = $("#faq-company").value, product = $("#faq-product").value) {
  const cos = allCompanyNames();
  $("#faq-company").innerHTML = `<option value="">كل الشركات (عام)</option>` + cos.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("#faq-company").value = cos.includes(company) ? company : "";
  const c = $("#faq-company").value;
  const prods = ctx.getProducts().filter((p) => !c || normTitle(p.company) === normTitle(c)).map((p) => p.name).sort((a, b) => a.localeCompare(b, "ar"));
  if (product && product !== GENERAL && !prods.includes(product)) prods.unshift(product);
  $("#faq-product").innerHTML = `<option value="${GENERAL}">عام (مش منتج معيّن)</option>` + prods.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  $("#faq-product").value = product && prods.includes(product) ? product : GENERAL;
}

function renderFaq() {
  const q = normAr($("#faq-search").value);
  const list = q ? faqs.filter((f) => normAr(`${f.question} ${f.keywords} ${f.answer} ${f.product} ${f.company}`).includes(q)) : faqs;
  $("#faq-count").textContent = faqs.length;
  $("#faq-list").innerHTML = list.length ? list.map((f) => `
    <div class="admin-item">
      <div class="info">
        <b>${esc(f.question)}</b>
        <small>${esc(isGeneral(f) ? "عام" : f.product)}${f.company ? " · " + esc(f.company) : ""} · ترتيب ${num(f.order)}</small>
        <small style="display:block">🔑 ${esc(splitKeywords(f.keywords).join("، ") || "—")}</small>
        <small style="display:block;white-space:pre-line">${esc(String(f.answer || "").slice(0, 160))}${String(f.answer || "").length > 160 ? "…" : ""}</small>
      </div>
      <button class="btn btn-sm btn-ghost" data-faq-edit="${esc(f.id)}">تعديل</button>
      <button class="btn btn-sm btn-red" data-faq-del="${esc(f.id)}">مسح</button>
    </div>`).join("") : `<p class="state-msg">${faqs.length ? "مفيش نتايج" : "مفيش أسئلة لسه. اضغطي «ضيفي الأسئلة العامة الأساسية» أو اكتبي سؤال جديد."}</p>`;
}

function resetFaqForm() {
  editingFaq = null;
  $("#faq-form").reset();
  fillFaqSelects("", GENERAL);
  $("#faq-form-title").textContent = "سؤال جديد";
  $("#faq-save").textContent = "حفظ السؤال";
  $("#faq-cancel").hidden = true;
}

function runFaqTest() {
  const box = $("#faq-test-result");
  const text = $("#faq-test").value.trim();
  if (!text) { box.hidden = true; return; }
  const r = askAssistant(text, faqs.filter((f) => f.active !== false), ctx.getProducts());
  box.hidden = false;
  box.innerHTML = r.answer
    ? `<div style="color:var(--green)">✅ هيرد بـ: ${esc(r.answer.question)}</div><div class="meta" style="white-space:pre-line">${esc(fillAnswer(r.answer.text, settings))}</div>`
    : `<div style="color:var(--red)">❌ ملقاش إجابة → هيقول «هتواصل معاك متخصصة على طول» + زرار واتساب</div>`;
  if (r.suggestions.length) box.innerHTML += `<div class="meta">اقتراحات: ${r.suggestions.map(esc).join(" · ")}</div>`;
}

function initFaq() {
  $("#faq-company").addEventListener("change", () => fillFaqSelects($("#faq-company").value, GENERAL));
  $("#faq-cancel").addEventListener("click", resetFaqForm);
  $("#faq-search").addEventListener("input", renderFaq);
  $("#faq-test").addEventListener("input", runFaqTest);

  $("#faq-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#faq-msg");
    const data = {
      company: $("#faq-company").value,
      product: $("#faq-product").value || GENERAL,
      question: $("#faq-question").value.trim(),
      keywords: splitKeywords($("#faq-keywords").value).join("، "),
      answer: $("#faq-answer").value.trim(),
      order: num($("#faq-order").value),
      active: true,
      updatedAt: serverTimestamp()
    };
    if (!data.question || !data.answer) return showMsg(msg, "اكتبي السؤال والإجابة");
    const dup = faqs.find((f) => normAr(f.question) === normAr(data.question) && f.id !== editingFaq);
    if (dup) return showMsg(msg, "فيه سؤال بنفس الصيغة دي قبل كده");
    const btn = $("#faq-save"); btn.disabled = true;
    try {
      if (editingFaq) await updateDoc(doc(db, "faq", editingFaq), data);
      else await addDoc(collection(db, "faq"), { ...data, createdAt: serverTimestamp() });
      showMsg(msg, editingFaq ? "اتعدّل السؤال ✅" : "اتضاف السؤال ✅", true);
      resetFaqForm();
      await loadFaq();
    } catch (err) { console.error(err); showMsg(msg, errText(err)); }
    finally { btn.disabled = false; }
  });

  $("#faq-list").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-faq-edit]");
    if (edit) {
      const f = faqs.find((x) => x.id === edit.dataset.faqEdit);
      if (!f) return;
      editingFaq = f.id;
      fillFaqSelects(f.company || "", isGeneral(f) ? GENERAL : f.product);
      $("#faq-question").value = f.question || "";
      $("#faq-keywords").value = splitKeywords(f.keywords).join("، ");
      $("#faq-answer").value = f.answer || "";
      $("#faq-order").value = num(f.order);
      $("#faq-form-title").textContent = "تعديل السؤال";
      $("#faq-save").textContent = "حفظ التعديل";
      $("#faq-cancel").hidden = false;
      $("#faq-form").scrollIntoView({ behavior: "smooth" });
      return;
    }
    const del = e.target.closest("[data-faq-del]");
    if (del) {
      const f = faqs.find((x) => x.id === del.dataset.faqDel);
      if (!f || !confirm(`تمسحي السؤال «${f.question}»؟`)) return;
      try { await deleteDoc(doc(db, "faq", f.id)); if (editingFaq === f.id) resetFaqForm(); await loadFaq(); }
      catch (err) { alert(errText(err)); }
    }
  });

  $("#faq-starters").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // نقرا القائمة من جديد الأول عشان منكرّرش لو الضغطة جت قبل ما التحميل يخلص
      const snap = await getDocs(collection(db, "faq"));
      const have = new Set(snap.docs.map((d) => normAr(d.data().question)));
      const missing = STARTER_FAQ.filter((f) => !have.has(normAr(f.question)));
      if (!missing.length) { alert("الأسئلة العامة الأساسية موجودة بالفعل ✅"); await loadFaq(); return; }
      const batch = writeBatch(db);
      missing.forEach((f) => batch.set(doc(collection(db, "faq")), {
        company: "", product: GENERAL, question: f.question, keywords: f.keywords, answer: f.answer,
        order: STARTER_FAQ.indexOf(f) + 1, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      }));
      await batch.commit();
      await loadFaq();
    } catch (err) { alert(errText(err)); }
    finally { btn.disabled = false; }
  });
}

// =====================================================================
// إعدادات Offers Store (settings/store)
// =====================================================================
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "store"));
    settings = storeSettings(snap.exists() ? snap.data() : null);
  } catch (e) { console.error(e); }
  $("#ss-wa").value = settings.whatsapp;
  $("#ss-fee").value = settings.shippingFee;
  $("#ss-threshold").value = settings.freeThreshold;
  $("#ss-about").value = settings.about;
  $("#ss-about-en").value = settings.aboutEn;
}

function initSettings() {
  $("#ss-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#ss-msg");
    const wa = cleanEgPhone($("#ss-wa").value);
    if (!EG_PHONE_RE.test(wa)) return showMsg(msg, "رقم الواتساب لازم يكون موبايل مصري (11 رقم يبدأ بـ 01)");
    const fee = Number($("#ss-fee").value), threshold = Number($("#ss-threshold").value);
    if (!(fee >= 0) || !(threshold >= 0)) return showMsg(msg, "مصاريف الشحن والحد لازم يكونوا أرقام 0 أو أكتر");
    const lines = (v) => v.split("\n").map((x) => x.trim()).filter(Boolean).join("\n");
    const btn = e.submitter; btn.disabled = true;
    try {
      const data = { whatsapp: wa, shippingFee: fee, freeThreshold: threshold, about: lines($("#ss-about").value), aboutEn: lines($("#ss-about-en").value) };
      await setDoc(doc(db, "settings", "store"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
      settings = storeSettings(data);
      $("#ss-wa").value = wa;
      showMsg(msg, "اتحفظت الإعدادات ✅ (بتظهر في Offers Store على طول)", true);
    } catch (err) { console.error(err); showMsg(msg, errText(err)); }
    finally { btn.disabled = false; }
  });
}

// =====================================================================
// التشغيل
// =====================================================================
export function initAdminStore(context) {
  ctx = context;
  initCompanies();
  initFaq();
  initSettings();

  $("#so-refresh").addEventListener("click", loadStoreOrders);
  $("#fu-refresh").addEventListener("click", loadStoreOrders);
  $("#so-search").addEventListener("input", renderStoreOrders);
  $("#so-company").addEventListener("change", renderStoreOrders);
  $("#so-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sofilter]");
    if (b) { soStatus = b.dataset.sofilter; renderStoreOrders(); }
  });
  $("#so-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sostatus]");
    if (!b) return;
    const order = sorders.find((o) => o.id === b.dataset.soorder);
    if (!order) return;
    $$("[data-soorder]", b.closest(".order-card")).forEach((x) => { x.disabled = true; });
    try { await setStoreStatus(order, b.dataset.sostatus); }
    catch (err) { console.error(err); alert(errText(err)); renderStoreOrders(); }
  });
  $("#fu-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-fu-done]");
    if (!b) return;
    b.disabled = true;
    try {
      const ids = b.dataset.fuDone.split(",").filter(Boolean);
      const batch = writeBatch(db);
      ids.forEach((id) => batch.update(doc(db, "consumerOrders", id), { followedUpAt: serverTimestamp() }));
      await batch.commit();
      sorders.forEach((o) => { if (ids.includes(o.id)) o.followedUpAt = Date.now(); });
      renderFollowups();
    } catch (err) { console.error(err); alert(errText(err)); b.disabled = false; }
  });
}

// تحميل كسول لما التبويب يتفتح
export function onStoreTab(tab) {
  if (tab === "sorders" || tab === "followup") loadStoreOrders();
  if (tab === "companies") loadCompanies();
  if (tab === "faq") { if (!companiesLoaded) loadCompanies().then(() => fillFaqSelects()); else fillFaqSelects(); loadSettings(); loadFaq(); resetFaqForm(); }
  if (tab === "ssettings") loadSettings();
}
