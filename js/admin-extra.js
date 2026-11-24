// لوحة الأدمن: الطلبات + برنامج المكافآت + الإحصائيات + مراجعة التقييمات
import { db } from "./firebase.js";
import {
  collection, getDocs, doc, getDoc, setDoc, writeBatch, query, orderBy, limit,
  serverTimestamp, increment, arrayUnion, arrayRemove, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  esc, money, num, normTitle, toMillis, monthKey, orderProducts, sortLevels, levelInfo, topOffers,
  ORDER_STATUSES, DELIVERED, SUGGESTION_TYPES, SUGGESTION_STATUSES
} from "./utils.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let ctx = null;            // { getOffers, getProducts }
let orders = [];
let ordersLoaded = false;
let statusFilter = "الكل";
let levels = [];

function errText(e) {
  if (e?.code === "permission-denied") return "مفيش صلاحية. لازم تكوني داخلة بحساب الأدمن.";
  return "حصلت مشكلة، جرّبي تاني";
}
const fmtDate = (ms) => ms ? new Date(ms).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const statusClass = (s) => ({ "جديد": "st-new", "تم التواصل": "st-contacted", [DELIVERED]: "st-done", "ملغي": "st-cancel" }[s] || "");
// رقم موبايل مصري → صيغة واتساب الدولية
function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "20" + d.slice(1);
  return d;
}

// =====================================================================
// الطلبات
// =====================================================================
async function loadOrders() {
  const box = $("#orders-list");
  try {
    const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(1000)));
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toMillis(d.data().createdAt) }));
    ordersLoaded = true;
  } catch (e) {
    console.error(e);
    box.innerHTML = `<p class="error">${esc(errText(e))}</p>`;
    return false;
  }
  renderOrders();
  maybeRefreshBestsellers();
  return true;
}

function renderOrders() {
  const q = normTitle($("#orders-search").value);
  const counts = Object.fromEntries(["الكل", ...ORDER_STATUSES].map((s) => [s, s === "الكل" ? orders.length : orders.filter((o) => o.status === s).length]));
  $("#orders-filters").innerHTML = ["الكل", ...ORDER_STATUSES].map((s) =>
    `<button type="button" class="chip${s === statusFilter ? " active" : ""}" data-ofilter="${esc(s)}">${esc(s)} <span class="meta">${counts[s]}</span></button>`).join("");
  const list = orders.filter((o) =>
    (statusFilter === "الكل" || o.status === statusFilter) &&
    (!q || normTitle(`${o.name} ${o.area} ${o.phone}`).includes(q)));
  $("#orders-list").innerHTML = list.length ? list.map(orderCard).join("") :
    `<p class="state-msg">${orders.length ? "مفيش طلبات بالفلتر ده" : "مفيش طلبات لسه. أول ما عميل يبعت طلب هيظهر هنا."}</p>`;
}

function orderCard(o) {
  const items = (o.items || []).map((it) =>
    `<li>${esc(it.name)} <span class="meta">× ${num(it.qty)} = ${money(num(it.qty) * num(it.unitPrice))}</span></li>`).join("");
  const wa = waNumber(o.phone);
  return `
  <div class="order-card ${statusClass(o.status)}">
    <div class="order-head">
      <div class="grow">
        <b>${esc(o.name)}</b>
        <div class="meta">📍 ${esc(o.area)} · 🕒 ${esc(fmtDate(o.createdAt))} · 🆔 ${esc(String(o.customerId || "").slice(0, 8))}</div>
      </div>
      <span class="status-pill">${esc(o.status)}</span>
    </div>
    <ul class="order-items">${items}</ul>
    <div class="order-foot">
      <b class="price-new" style="font-size:18px">${money(o.total)}</b>
      <span class="row-gap">
        <a class="btn btn-sm btn-ghost" href="tel:${esc(String(o.phone || "").replace(/[^+0-9]/g, ""))}" dir="ltr">📞 ${esc(o.phone)}</a>
        ${wa.length >= 10 ? `<a class="btn btn-sm btn-green" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ""}
      </span>
    </div>
    <div class="status-btns">${ORDER_STATUSES.map((s) =>
      `<button type="button" class="btn btn-sm ${s === o.status ? "btn-purple" : "btn-ghost"}" data-status="${esc(s)}" data-order="${esc(o.id)}"${s === o.status ? " disabled" : ""}>${esc(s)}</button>`).join("")}
    </div>
  </div>`;
}

// تغيير الحالة: لو بقى «اتسلّم» بنزوّد مجموع الشهر في loyalty ونفتح التقييم للمنتجات،
// ولو اترجع من «اتسلّم» بنعكس ده. كله في batch واحد.
async function setStatus(order, status) {
  const was = order.status === DELIVERED, will = status === DELIVERED;
  const batch = writeBatch(db);
  const month = order.countedMonth || monthKey(order.createdAt || Date.now());
  const total = num(order.total);
  const patch = { status, statusAt: serverTimestamp() };
  if (!was && will) patch.countedMonth = month;
  batch.update(doc(db, "orders", order.id), patch);

  const cid = String(order.customerId || "");
  if (/^[A-Za-z0-9]{24,64}$/.test(cid) && was !== will) {
    const entries = orderProducts(order).map((p) => ({ orderId: order.id, key: p.key, name: p.name, productId: p.productId }));
    const loyaltyRef = doc(db, "loyalty", cid);
    const change = { months: { [month]: increment(will ? total : -total) }, updatedAt: serverTimestamp() };
    if (entries.length) change.toRate = will ? arrayUnion(...entries) : arrayRemove(...entries);
    batch.set(loyaltyRef, change, { merge: true });
    for (const e of entries) {
      const ref = doc(db, "rateable", `${order.id}_${e.key}`);
      if (will) batch.set(ref, { orderId: order.id, productKey: e.key, createdAt: serverTimestamp() });
      else batch.delete(ref);
    }
  }
  await batch.commit();
  order.status = status;
  if (patch.countedMonth) order.countedMonth = patch.countedMonth;
  renderOrders();
  if (was !== will) await refreshBestsellers();
}

// «الأكثر طلباً»: أكتر 5 عروض في الطلبات اللي اتسلّمت آخر 30 يوم → settings/bestsellers (العملاء بيقروه)
async function refreshBestsellers() {
  const ids = topOffers(orders);
  await setDoc(doc(db, "settings", "bestsellers"), { offerIds: ids, updatedAt: serverTimestamp() });
}
// بنحدّثها كمان كل ما الأدمن تفتح الطلبات لو آخر تحديث من أكتر من 12 ساعة (عشان نافذة الـ 30 يوم بتتحرّك)
async function maybeRefreshBestsellers() {
  try {
    const snap = await getDoc(doc(db, "settings", "bestsellers"));
    const last = snap.exists() ? toMillis(snap.data().updatedAt) : 0;
    if (Date.now() - last > 12 * 3600000) await refreshBestsellers();
  } catch (e) { console.warn("bestsellers", e); }
}

// =====================================================================
// برنامج المكافآت (المستويات)
// =====================================================================
async function loadLevels() {
  try {
    const snap = await getDoc(doc(db, "settings", "loyalty"));
    levels = sortLevels(snap.exists() ? snap.data().levels : []);
  } catch (e) { console.error(e); }
  if (!levels.length) levels = [{ name: "", target: "", reward: "" }];
  renderLevels();
}

function renderLevels() {
  $("#levels-list").innerHTML = levels.map((l, i) => `
    <div class="level-row" data-i="${i}">
      <div class="field"><label>اسم المستوى</label><input class="input" data-l="name" value="${esc(l.name)}" placeholder="مثلاً: فضي"></div>
      <div class="field"><label>الهدف الشهري (ج)</label><input class="input" data-l="target" type="number" min="1" inputmode="numeric" value="${esc(l.target)}" placeholder="5000"></div>
      <div class="field"><label>المكافأة</label><input class="input" data-l="reward" value="${esc(l.reward)}" placeholder="مثلاً: كاش باك 2% أو علبة هدية"></div>
      <button type="button" class="icon-btn" data-l-remove="${i}" aria-label="امسحي المستوى">×</button>
    </div>`).join("");
}

function readLevels() {
  return $$("#levels-list .level-row").map((row) => ({
    name: $('[data-l="name"]', row).value.trim(),
    target: num($('[data-l="target"]', row).value),
    reward: $('[data-l="reward"]', row).value.trim()
  }));
}

async function saveLevels() {
  const msg = $("#levels-msg");
  const raw = readLevels().filter((l) => l.name || l.target || l.reward);
  if (raw.some((l) => !l.name || !(l.target > 0))) {
    msg.hidden = false; msg.style.color = "var(--red)"; msg.textContent = "كل مستوى لازم يكون له اسم وهدف أكبر من صفر";
    return;
  }
  const clean = sortLevels(raw);
  try {
    await setDoc(doc(db, "settings", "loyalty"), { levels: clean, updatedAt: serverTimestamp() });
    levels = clean.length ? clean : [{ name: "", target: "", reward: "" }];
    renderLevels();
    msg.hidden = false; msg.style.color = "var(--green)"; msg.textContent = "اتحفظت المستويات ✅ (بتظهر للعملاء على طول)";
    renderMonthCustomers();
  } catch (e) {
    msg.hidden = false; msg.style.color = "var(--red)"; msg.textContent = errText(e);
  }
}

// العملاء الشهر ده: المجموع المؤكد (اتسلّم) والمستوى
function renderMonthCustomers() {
  const box = $("#month-customers");
  if (!ordersLoaded) { box.innerHTML = `<p class="meta">افتحي تبويب «الطلبات» مرة عشان تظهر الأرقام هنا.</p>`; return; }
  const cur = monthKey();
  const by = new Map();
  for (const o of orders) {
    if (o.status !== DELIVERED || (o.countedMonth || monthKey(o.createdAt)) !== cur) continue;
    const k = o.customerId || o.phone;
    const e = by.get(k) || { name: o.name, area: o.area, total: 0 };
    e.total += num(o.total); by.set(k, e);
  }
  const ls = sortLevels(levels);
  const rows = [...by.values()].sort((a, b) => b.total - a.total);
  box.innerHTML = rows.length ? rows.map((r) => {
    const info = levelInfo(r.total, ls);
    return `<div class="admin-item"><div class="info"><b>${esc(r.name)}</b><small>${esc(r.area)} · ${money(r.total)}</small></div>
      <span class="status-pill">${info.current ? "🏆 " + esc(info.current.name) : "—"}</span></div>`;
  }).join("") : `<p class="meta">مفيش طلبات اتسلّمت الشهر ده لسه.</p>`;
}

// =====================================================================
// الإحصائيات
// =====================================================================
async function loadStats() {
  const box = $("#stats-body");
  box.innerHTML = `<p class="state-msg">جاري التحميل…</p>`;
  if (!ordersLoaded && !(await loadOrders())) { box.innerHTML = `<p class="error">مقدرناش نحمّل الطلبات</p>`; return; }
  let views = [];
  try {
    const snap = await getDocs(collection(db, "views"));
    views = snap.docs.map((d) => ({ id: d.id, count: num(d.data().count) }));
  } catch (e) { console.error(e); }

  const offers = ctx.getOffers();
  const offerName = (id) => offers.find((o) => o.id === id)?.name || "(عرض اتمسح)";
  const active = orders.filter((o) => o.status !== "ملغي");
  const delivered = orders.filter((o) => o.status === DELIVERED);
  const cur = monthKey();

  // الأرقام السريعة
  const customers = new Set(orders.map((o) => o.customerId || o.phone)).size;
  const monthOrders = active.filter((o) => monthKey(o.createdAt) === cur);
  const monthSales = delivered.filter((o) => (o.countedMonth || monthKey(o.createdAt)) === cur).reduce((s, o) => s + num(o.total), 0);

  // الأكثر مشاهدة
  const topViewed = views.filter((v) => v.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);
  // الأكثر طلباً (كل الطلبات غير الملغية، بالكمية)
  const qty = new Map();
  for (const o of active) for (const it of o.items || []) {
    const k = it.offerId || it.name;
    const e = qty.get(k) || { name: offerName(it.offerId) !== "(عرض اتمسح)" ? offerName(it.offerId) : it.name, qty: 0, total: 0 };
    e.qty += Math.max(1, num(it.qty)); e.total += num(it.qty) * num(it.unitPrice); qty.set(k, e);
  }
  const topOrdered = [...qty.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  // الطلبات في الشهور (آخر 12 شهر)
  const months = new Map();
  for (const o of active) {
    const k = monthKey(o.createdAt);
    const e = months.get(k) || { count: 0, delivered: 0 };
    e.count++; if (o.status === DELIVERED) e.delivered += num(o.total);
    months.set(k, e);
  }
  const monthRows = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);
  const maxCount = Math.max(1, ...monthRows.map(([, e]) => e.count));
  // أفضل العملاء (بالمشتريات اللي اتسلّمت)
  const cust = new Map();
  for (const o of delivered) {
    const k = o.customerId || o.phone;
    const e = cust.get(k) || { name: o.name, area: o.area, total: 0, count: 0 };
    e.total += num(o.total); e.count++; cust.set(k, e);
  }
  const topCustomers = [...cust.values()].sort((a, b) => b.total - a.total).slice(0, 10);

  const list = (rows, render, empty) => rows.length ? `<ol class="stat-list">${rows.map(render).join("")}</ol>` : `<p class="meta">${empty}</p>`;
  const monthName = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("ar-EG", { month: "long", year: "numeric" }); };

  box.innerHTML = `
    <div class="stat-tiles">
      <div class="stat-tile"><span>عدد العملاء</span><b>${customers}</b></div>
      <div class="stat-tile"><span>طلبات الشهر ده</span><b>${monthOrders.length}</b></div>
      <div class="stat-tile"><span>مبيعات الشهر ده (اتسلّمت)</span><b>${money(monthSales)}</b></div>
      <div class="stat-tile"><span>كل الطلبات</span><b>${orders.length}</b></div>
    </div>
    <div class="panel"><h2 class="section-title">👀 الأكثر مشاهدة</h2>
      ${list(topViewed, (v) => `<li><span>${esc(offerName(v.id))}</span><b>${v.count} مشاهدة</b></li>`, "لسه مفيش مشاهدات متسجّلة.")}</div>
    <div class="panel"><h2 class="section-title">🛒 الأكثر طلباً</h2>
      ${list(topOrdered, (r) => `<li><span>${esc(r.name)}</span><b>${r.qty} كورس · ${money(r.total)}</b></li>`, "لسه مفيش طلبات.")}</div>
    <div class="panel"><h2 class="section-title">📅 الطلبات في الشهور</h2>
      ${monthRows.length ? `<div class="bars">${monthRows.map(([k, e]) => `
        <div class="bar-row"><span class="bar-label">${esc(monthName(k))}</span>
          <span class="bar"><span style="width:${Math.round((e.count / maxCount) * 100)}%"></span></span>
          <span class="bar-val">${e.count} طلب · ${money(e.delivered)}</span></div>`).join("")}</div>
        <p class="meta" style="margin:8px 0 0">العدد = كل الطلبات غير الملغية، والمبلغ = اللي اتسلّم بس.</p>` : `<p class="meta">لسه مفيش طلبات.</p>`}</div>
    <div class="panel"><h2 class="section-title">⭐ أفضل العملاء</h2>
      ${list(topCustomers, (c) => `<li><span>${esc(c.name)} <small class="meta">${esc(c.area)}</small></span><b>${money(c.total)} · ${c.count} طلب</b></li>`, "لسه مفيش طلبات اتسلّمت.")}</div>`;
}

// =====================================================================
// مراجعة التقييمات (إخفاء التعليق)
// =====================================================================
async function loadRatingsAdmin() {
  const box = $("#ratings-admin");
  try {
    const snap = await getDocs(query(collection(db, "ratings"), orderBy("createdAt", "desc"), limit(200)));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    box.innerHTML = rows.length ? rows.map((r) => `
      <div class="admin-item${r.commentHidden ? " muted" : ""}">
        <div class="info">
          <b>${esc(r.productName || r.productKey)} <span class="stars">${"★".repeat(num(r.stars))}<span class="off">${"★".repeat(5 - num(r.stars))}</span></span></b>
          <small>${r.comment ? esc(r.comment) : "— من غير تعليق —"}${r.commentHidden ? " · (التعليق مخفي)" : ""}</small>
        </div>
        ${r.comment ? `<button class="btn btn-sm ${r.commentHidden ? "btn-ghost" : "btn-red"}" data-hide-rating="${esc(r.id)}" data-hidden="${r.commentHidden ? 1 : 0}">${r.commentHidden ? "اظهري التعليق" : "خبّي التعليق"}</button>` : ""}
      </div>`).join("") : `<p class="meta">لسه مفيش تقييمات. التقييم بيتفتح للعميل بس بعد ما الطلب يبقى «اتسلّم».</p>`;
  } catch (e) {
    box.innerHTML = `<p class="error">${esc(errText(e))}</p>`;
  }
}

// =====================================================================
// الاقتراحات
// =====================================================================
let suggestions = [];
let sgType = "الكل", sgStatus = "الكل";
const sgStatusClass = (s) => ({ "جديد": "st-new", "اتبعت للأونر": "st-contacted", "اتنفّذ": "st-done", "مؤجل": "st-cancel" }[s] || "");
const sgCopyText = (s) => `💡 ${s.type}${s.company ? " – " + s.company : ""}\n${s.text}`;

async function loadSuggestions() {
  const box = $("#sg-list");
  try {
    const snap = await getDocs(query(collection(db, "suggestions"), orderBy("createdAt", "desc"), limit(1000)));
    suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toMillis(d.data().createdAt) }));
  } catch (e) {
    console.error(e);
    box.innerHTML = `<p class="error">${esc(errText(e))}</p>`;
    return;
  }
  renderSuggestions();
}

function chipRow(values, current, attr, count) {
  return ["الكل", ...values].map((v) =>
    `<button type="button" class="chip${v === current ? " active" : ""}" ${attr}="${esc(v)}">${esc(v)} <span class="meta">${count(v)}</span></button>`).join("");
}

function renderSuggestions() {
  const byType = (s) => sgType === "الكل" || s.type === sgType;
  const byStatus = (s) => sgStatus === "الكل" || s.status === sgStatus;
  $("#sg-type-filters").innerHTML = chipRow(SUGGESTION_TYPES, sgType, "data-sgtype",
    (v) => suggestions.filter((s) => byStatus(s) && (v === "الكل" || s.type === v)).length);
  $("#sg-status-filters").innerHTML = chipRow(SUGGESTION_STATUSES, sgStatus, "data-sgstatus",
    (v) => suggestions.filter((s) => byType(s) && (v === "الكل" || s.status === v)).length);
  const list = suggestions.filter((s) => byType(s) && byStatus(s));
  $("#sg-list").innerHTML = list.length ? list.map(suggestionCard).join("") :
    `<p class="state-msg">${suggestions.length ? "مفيش اقتراحات بالفلتر ده" : "مفيش اقتراحات لسه. أول ما عميل يبعت اقتراح هيظهر هنا."}</p>`;
}

function suggestionCard(s) {
  const wa = waNumber(s.phone);
  const who = [s.name && `🏪 ${esc(s.name)}`, s.area && `📍 ${esc(s.area)}`, `🕒 ${esc(fmtDate(s.createdAt))}`,
    s.customerId && `🆔 ${esc(String(s.customerId).slice(0, 8))}`].filter(Boolean).join(" · ");
  return `
  <div class="order-card sg-card ${sgStatusClass(s.status)}">
    <div class="order-head">
      <div class="grow">
        <b>${esc(s.type)}</b>${s.company ? ` <span class="meta">– ${esc(s.company)}</span>` : ""}
        <div class="meta">${who}</div>
      </div>
      <span class="status-pill">${esc(s.status)}</span>
    </div>
    <p class="sg-text" dir="auto">${esc(s.text)}</p>
    <div class="order-foot">
      <button type="button" class="btn btn-sm btn-purple" data-sg-copy="${esc(s.id)}">📋 انسخي الاقتراح</button>
      <span class="row-gap">
        ${s.phone ? `<a class="btn btn-sm btn-ghost" href="tel:${esc(String(s.phone).replace(/[^+0-9]/g, ""))}" dir="ltr">📞 ${esc(s.phone)}</a>` : ""}
        ${wa.length >= 10 ? `<a class="btn btn-sm btn-green" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ""}
      </span>
    </div>
    <div class="status-btns sg-st">${SUGGESTION_STATUSES.map((st) =>
      `<button type="button" class="btn btn-sm ${st === s.status ? "btn-purple" : "btn-ghost"}" data-sg-status="${esc(st)}" data-sg="${esc(s.id)}"${st === s.status ? " disabled" : ""}>${esc(st)}</button>`).join("")}
    </div>
  </div>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  return ok;
}

function initSuggestions() {
  $("#sg-refresh").addEventListener("click", loadSuggestions);
  $("#sg-type-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sgtype]");
    if (b) { sgType = b.dataset.sgtype; renderSuggestions(); }
  });
  $("#sg-status-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sgstatus]");
    if (b) { sgStatus = b.dataset.sgstatus; renderSuggestions(); }
  });
  $("#sg-list").addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-sg-copy]");
    if (copy) {
      const s = suggestions.find((x) => x.id === copy.dataset.sgCopy);
      if (!s) return;
      const ok = await copyText(sgCopyText(s));
      copy.textContent = ok ? "✅ اتنسخ" : "مقدرتش أنسخ";
      setTimeout(() => { copy.textContent = "📋 انسخي الاقتراح"; }, 2000);
      return;
    }
    const b = e.target.closest("[data-sg-status]");
    if (!b) return;
    const s = suggestions.find((x) => x.id === b.dataset.sg);
    if (!s) return;
    $$("[data-sg]", b.closest(".sg-card")).forEach((x) => { x.disabled = true; });
    try {
      await updateDoc(doc(db, "suggestions", s.id), { status: b.dataset.sgStatus, statusAt: serverTimestamp() });
      s.status = b.dataset.sgStatus;
    } catch (err) { console.error(err); alert(errText(err)); }
    renderSuggestions();
  });
}

// =====================================================================
// التشغيل
// =====================================================================
export function initAdminExtras(context) {
  ctx = context;
  initSuggestions();

  $("#orders-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ofilter]");
    if (b) { statusFilter = b.dataset.ofilter; renderOrders(); }
  });
  $("#orders-search").addEventListener("input", renderOrders);
  $("#orders-refresh").addEventListener("click", loadOrders);
  $("#orders-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-status]");
    if (!b) return;
    const order = orders.find((o) => o.id === b.dataset.order);
    if (!order) return;
    const to = b.dataset.status;
    if (order.status === DELIVERED && to !== DELIVERED &&
        !confirm("الطلب ده متحسوب في مكافآت العميل. لو غيّرتي حالته هيتشال من مجموع الشهر. تكمّلي؟")) return;
    $$("[data-order]", b.closest(".order-card")).forEach((x) => { x.disabled = true; });
    try { await setStatus(order, to); }
    catch (err) { console.error(err); alert(errText(err)); renderOrders(); }
  });

  $("#levels-add").addEventListener("click", () => { levels = [...readLevels(), { name: "", target: "", reward: "" }]; renderLevels(); });
  $("#levels-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-l-remove]");
    if (!b) return;
    levels = readLevels().filter((_, i) => i !== Number(b.dataset.lRemove));
    if (!levels.length) levels = [{ name: "", target: "", reward: "" }];
    renderLevels();
  });
  $("#levels-save").addEventListener("click", saveLevels);
  $("#stats-refresh").addEventListener("click", loadStats);

  $("#ratings-admin").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-hide-rating]");
    if (!b) return;
    b.disabled = true;
    try { await updateDoc(doc(db, "ratings", b.dataset.hideRating), { commentHidden: b.dataset.hidden !== "1" }); }
    catch (err) { alert(errText(err)); }
    loadRatingsAdmin();
  });
}

// بتتنادي لما التبويب يتفتح (تحميل كسول)
export function onAdminTab(tab) {
  if (tab === "orders") loadOrders();
  if (tab === "rewards") { loadLevels(); if (!ordersLoaded) loadOrders().then(renderMonthCustomers); else renderMonthCustomers(); }
  if (tab === "stats") loadStats();
  if (tab === "suggestions") loadSuggestions();
  if (tab === "products") loadRatingsAdmin();
}
