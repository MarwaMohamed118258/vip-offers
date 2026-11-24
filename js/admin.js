import { isFirebaseConfigured } from "./firebase-config.js";
import {
  allCategories, normTitle, mapImportedOffer, mapImportedProduct, splitOfferTotal, offerItem,
  SAMPLE_OFFER, esc, money, num, calcTotals, safeUrl, safeImage, offerStatus, endLabel, isDateStr, matchCategory, planEnglishNames
} from "./utils.js";
import { compressImage, imageKB } from "./image.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

if (!isFirebaseConfigured()) {
  $("main").innerHTML = `<p class="state-msg">لسه إعدادات Firebase متحطتش في <code>js/firebase-config.js</code></p>`;
  throw new Error("Firebase not configured");
}

const { db, auth } = await import("./firebase.js");
const {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, query, orderBy, serverTimestamp,
  writeBatch, Timestamp, arrayUnion, deleteField
} = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
const { signInWithEmailAndPassword, onAuthStateChanged, signOut } =
  await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");

let offers = [];
let products = [];
let productsById = new Map();
let editingId = null;          // العرض اللي بيتعدّل
let editingProductId = null;   // المنتج اللي بيتعدّل
let pendingImage = "";         // صورة المنتج في الفورم (data URL أو رابط)

function showMsg(el, text, ok = false) {
  el.hidden = !text;
  el.textContent = text || "";
  el.style.color = ok ? "var(--green)" : "var(--red)";
}

function errText(e) {
  if (e?.code === "permission-denied") return "مفيش صلاحية. اتأكدي إن حسابك متضاف في مجموعة admins وإن قواعد Firestore متحدّثة.";
  if (e?.code?.startsWith("auth/")) return "الإيميل أو الباسورد غلط";
  if (e?.code === "invalid-argument") return "البيانات كبيرة أو فيها مشكلة، جرّبي صورة أصغر";
  return "حصلت مشكلة، جرّبي تاني";
}

// صندوق نتيجة (للاستيراد)
function resultBox(el) {
  return (html, ok = true) => {
    el.hidden = false; el.innerHTML = html;
    el.style.background = ok ? "" : "#fde8ec";
  };
}

async function readJsonList(file, key) {
  const text = (await file.text()).replace(/^﻿/, "");
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.[key]) ? parsed[key] : null;
  if (!list) throw new Error("not-array");
  return list;
}

// كتابة مستندات كتير على دفعات (حد Firestore: 500 عملية و ~10MB للدفعة)
async function writeInBatches(col, docs, extra) {
  let batch = writeBatch(db), count = 0, bytes = 0;
  for (let i = 0; i < docs.length; i++) {
    const size = JSON.stringify(docs[i]).length;
    if (count && (count >= 400 || bytes + size > 8_000_000)) {
      await batch.commit();
      batch = writeBatch(db); count = 0; bytes = 0;
    }
    batch.set(doc(collection(db, col)), { ...docs[i], ...extra(i) });
    count++; bytes += size;
  }
  if (count) await batch.commit();
}

// ---------- تسجيل الدخول ----------
onAuthStateChanged(auth, async (user) => {
  $("#login-view").hidden = !!user;
  $("#admin-view").hidden = !user;
  $("#logout").hidden = !user;
  $("#who").textContent = user ? user.email : "سجّلي دخول الأول";
  if (user) {
    await loadCategories();
    await loadProducts();
    await loadOffers();
    loadAbout();
  }
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  showMsg($("#login-error"), "");
  try {
    await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#password").value);
  } catch (err) {
    showMsg($("#login-error"), errText(err));
  } finally { btn.disabled = false; }
});
$("#logout").addEventListener("click", () => signOut(auth));

// ---------- التبويبات ----------
$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  $$("[data-tab]").forEach((x) => x.className = "btn " + (x === b ? "btn-purple" : "btn-ghost"));
  for (const t of ["offers", "products", "about"]) $(`#tab-${t}`).hidden = b.dataset.tab !== t;
}));

// ---------- قوائم مشتركة (الشركات والأقسام) ----------
// الأقسام: قايمة منسدلة فيها الأقسام الموجودة + «+ قسم جديد» بيظهر خانة نكتب فيها الاسم
const NEW_CAT = "__new";
let savedCategories = []; // الأقسام اللي اتضافت من هنا (settings/categories)
const categoryList = () => allCategories([...offers, ...products], savedCategories);

let namesEn = { categories: {}, companies: {} }; // الأسماء الإنجليزي (settings/names)

async function loadCategories() {
  try {
    const [snap, names] = await Promise.all([
      getDoc(doc(db, "settings", "categories")),
      getDoc(doc(db, "settings", "names"))
    ]);
    savedCategories = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
    const n = names.exists() ? names.data() : {};
    namesEn = { categories: { ...(n.categories || {}) }, companies: { ...(n.companies || {}) } };
  } catch (err) { console.error(err); }
  fillLists();
}

// لما تختاري شركة أو قسم: الاسم الإنجليزي بيتملا من اللي محفوظ
function prefillCompanyEn(prefix) {
  $(`#${prefix}-company-en`).value = namesEn.companies[$(`#${prefix}-company`).value.trim()] || "";
}
function prefillCategoryEn(prefix) {
  const sel = $(`#${prefix}-category`);
  $(`#${prefix}-category-en`).value = sel.value && sel.value !== NEW_CAT ? namesEn.categories[sel.value] || "" : "";
}
for (const prefix of ["o", "p"]) {
  $(`#${prefix}-company`).addEventListener("change", () => prefillCompanyEn(prefix));
  $(`#${prefix}-category`).addEventListener("change", () => prefillCategoryEn(prefix));
}

// نحفظ الاسم الإنجليزي للشركة والقسم لو اتغيّر (فاضي = نمسحه)
async function saveNamesEn(prefix, company, category) {
  const patch = {};
  const check = (kind, ar, en) => {
    if (!ar) return;
    const cur = namesEn[kind][ar] || "";
    if (en === cur) return;
    (patch[kind] ||= {})[ar] = en ? en : deleteField();
    if (en) namesEn[kind][ar] = en; else delete namesEn[kind][ar];
  };
  check("companies", company, $(`#${prefix}-company-en`).value.trim());
  check("categories", category, $(`#${prefix}-category-en`).value.trim());
  if (Object.keys(patch).length) {
    await setDoc(doc(db, "settings", "names"), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  }
}

function fillCategorySelect(sel, keep = sel.value) {
  const cats = categoryList();
  const optional = sel.hasAttribute("data-optional");
  const current = keep && keep !== NEW_CAT && !cats.includes(keep) ? [...cats, keep] : cats;
  sel.innerHTML =
    `<option value="">${optional ? "— من غير قسم —" : "— اختاري القسم —"}</option>` +
    current.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") +
    `<option value="${NEW_CAT}">+ قسم جديد</option>`;
  sel.value = keep || "";
  toggleNewCategory(sel);
}

function newCatInput(sel) { return $(`#${sel.id}-new`); }
function toggleNewCategory(sel) {
  const input = newCatInput(sel);
  const isNew = sel.value === NEW_CAT;
  input.hidden = !isNew;
  input.required = isNew;
  if (!isNew) input.value = "";
}
$$("[data-cat-select]").forEach((sel) => sel.addEventListener("change", () => {
  toggleNewCategory(sel);
  if (sel.value === NEW_CAT) newCatInput(sel).focus();
}));

function setCategoryValue(sel, c) { fillCategorySelect(sel, c || ""); }

// القسم المختار (ولو جديد: الاسم المكتوب، أو الموجود لو نفس الاسم تقريباً)
function readCategory(sel) {
  if (sel.value !== NEW_CAT) return sel.value;
  return matchCategory(newCatInput(sel).value, categoryList());
}

// نحفظ القسم الجديد في settings/categories عشان يظهر للعملاء على طول
async function rememberCategory(c) {
  if (!c || categoryList().includes(c)) return;
  await setDoc(doc(db, "settings", "categories"), { list: arrayUnion(c), updatedAt: serverTimestamp() }, { merge: true });
  savedCategories = [...savedCategories, c];
}

function fillLists() {
  $$("[data-cat-select]").forEach((sel) => fillCategorySelect(sel));
  const companies = [...new Set([...offers, ...products].map((o) => o.company).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ar"));
  $("#companies").innerHTML = companies.map((n) => `<option value="${esc(n)}">`).join("");
}

// =====================================================================
// المنتجات
// =====================================================================
async function loadProducts() {
  try {
    const snap = await getDocs(query(collection(db, "products"), orderBy("name")));
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    $("#admin-products").innerHTML = `<p class="error">${esc(errText(err))}</p>`;
    return false;
  }
  productsById = new Map(products.map((p) => [p.id, p]));
  renderProducts();
  fillLists();
  refreshItemSelects();
  return true;
}

function renderProducts() {
  const q = normTitle($("#products-search").value);
  const list = q ? products.filter((p) => normTitle(`${p.name} ${p.company}`).includes(q)) : products;
  $("#products-count").textContent = products.length;
  $("#admin-products").innerHTML = list.length ? list.map((p) => `
    <div class="admin-item">
      ${safeImage(p.image) ? `<img class="thumb" src="${esc(safeImage(p.image))}" alt="" loading="lazy">` : `<div class="thumb"></div>`}
      <div class="info"><b>${esc(p.name)}</b><small>${esc(p.company)}${p.category ? " · " + esc(p.category) : ""} · ${money(p.publicPrice)}</small></div>
      <button class="btn btn-sm btn-ghost" data-pedit="${esc(p.id)}">تعديل</button>
      <button class="btn btn-sm btn-red" data-pdel="${esc(p.id)}">مسح</button>
    </div>`).join("") : `<p class="state-msg">${products.length ? "مفيش نتايج" : "مفيش منتجات لسه"}</p>`;
}
$("#products-search").addEventListener("input", renderProducts);

function setPendingImage(src, info = "") {
  pendingImage = safeImage(src);
  $("#p-preview").hidden = !pendingImage;
  if (pendingImage) $("#p-preview").src = pendingImage; else $("#p-preview").removeAttribute("src");
  $("#p-clear-img").hidden = !pendingImage;
  showMsg($("#p-img-info"), info, true);
  $("#p-img-info").style.color = "";
}

$("#p-pick").addEventListener("click", () => $("#p-file").click());
$("#p-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const btn = $("#p-pick");
  btn.disabled = true; btn.textContent = "جاري تجهيز الصورة…";
  try {
    const url = await compressImage(file);
    $("#p-image-url").value = "";
    setPendingImage(url, `الصورة اتصغّرت: ${imageKB(url)} KB`);
  } catch (err) {
    console.error(err);
    showMsg($("#p-img-info"), err.message === "not-image" ? "الملف ده مش صورة" : "مقدرناش نجهّز الصورة، جرّبي صورة تانية");
  } finally {
    btn.disabled = false; btn.textContent = "📷 اختاري أو صوّري صورة";
  }
});
$("#p-image-url").addEventListener("input", (e) => {
  const v = e.target.value.trim();
  setPendingImage(safeUrl(v));
  if (v && !safeUrl(v)) showMsg($("#p-img-info"), "الرابط لازم يبدأ بـ https://");
});
$("#p-clear-img").addEventListener("click", () => { $("#p-image-url").value = ""; setPendingImage(""); });

function resetProductForm() {
  editingProductId = null;
  $("#product-form").reset();
  fillCategorySelect($("#p-category"), "");
  setPendingImage("");
  $("#p-form-title").textContent = "منتج جديد";
  $("#p-save-btn").textContent = "حفظ المنتج";
  $("#p-cancel-edit").hidden = true;
}
$("#p-cancel-edit").addEventListener("click", resetProductForm);

$("#product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#product-msg");
  const data = {
    company: $("#p-company").value.trim(),
    category: readCategory($("#p-category")),
    name: $("#p-name").value.trim().replace(/\s+/g, " "),
    nameEn: $("#p-name-en").value.trim(),
    publicPrice: num($("#p-price").value),
    image: pendingImage,
    updatedAt: serverTimestamp()
  };
  const dup = products.find((p) => normTitle(p.name) === normTitle(data.name) && p.id !== editingProductId);
  if (dup) return showMsg(msg, `فيه منتج بنفس الاسم: «${dup.name}»`);
  const btn = $("#p-save-btn"); btn.disabled = true;
  try {
    await rememberCategory(data.category);
    await saveNamesEn("p", data.company, data.category);
    if (editingProductId) await updateDoc(doc(db, "products", editingProductId), data);
    else await addDoc(collection(db, "products"), { ...data, createdAt: serverTimestamp() });
    showMsg(msg, editingProductId ? "اتعدّل المنتج ✅" : "اتضاف المنتج ✅", true);
    resetProductForm();
    await loadProducts();
  } catch (err) {
    console.error(err); showMsg(msg, errText(err));
  } finally { btn.disabled = false; }
});

$("#admin-products").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-pedit]");
  const del = e.target.closest("[data-pdel]");
  if (edit) {
    const p = productsById.get(edit.dataset.pedit);
    if (!p) return;
    editingProductId = p.id;
    $("#p-company").value = p.company || "";
    setCategoryValue($("#p-category"), p.category);
    $("#p-name").value = p.name || "";
    $("#p-name-en").value = p.nameEn || "";
    prefillCompanyEn("p");
    prefillCategoryEn("p");
    $("#p-price").value = p.publicPrice ?? "";
    const img = safeImage(p.image);
    $("#p-image-url").value = img && !img.startsWith("data:") ? img : "";
    setPendingImage(img, img.startsWith("data:") ? `صورة مرفوعة: ${imageKB(img)} KB` : "");
    $("#p-form-title").textContent = "تعديل المنتج";
    $("#p-save-btn").textContent = "حفظ التعديل";
    $("#p-cancel-edit").hidden = false;
    $("#product-form").scrollIntoView({ behavior: "smooth" });
  }
  if (del) {
    const p = productsById.get(del.dataset.pdel);
    if (!p) return;
    const used = offers.filter((o) => (o.products || []).some((it) => it.productId === p.id)).length;
    const warn = used ? `\nالمنتج ده موجود في ${used} عرض، والعروض هتفضل زي ما هي بس من غير صورته.` : "";
    if (!confirm(`متأكدة إنك عايزة تمسحي «${p.name}»؟${warn}`)) return;
    try {
      await deleteDoc(doc(db, "products", p.id));
      if (editingProductId === p.id) resetProductForm();
      await loadProducts();
    } catch (err) { alert(errText(err)); }
  }
});

// ---------- استيراد منتجات من ملف ----------
$("#import-products-btn").addEventListener("click", () => $("#import-products-file").click());
$("#import-products-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const show = resultBox($("#import-products-result"));
  const btn = $("#import-products-btn");
  let list;
  try { list = await readJsonList(file, "products"); }
  catch { return show("الملف مش مظبوط: لازم يكون JSON فيه قائمة منتجات [ ... ]", false); }

  btn.disabled = true;
  show("جاري الاستيراد…");
  try {
    if (!(await loadProducts())) return show("مقدرناش نحمّل المنتجات الحالية، جرّبي تاني", false);
    const seen = new Set(products.map((p) => normTitle(p.name)));
    const toAdd = [], dup = [], bad = [];
    let noImage = 0;
    for (const raw of list) {
      const r = mapImportedProduct(raw);
      if (!r.product) { bad.push(r.name ? `${r.name} (${r.reason})` : r.reason); continue; }
      const key = normTitle(r.product.name);
      if (seen.has(key)) { dup.push(r.product.name); continue; }
      seen.add(key);
      if (!r.product.image) noImage++;
      toAdd.push(r.product);
    }
    await writeInBatches("products", toAdd, () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await loadProducts();
    show(`
      <div style="color:var(--green)">✅ اتضاف: ${toAdd.length} منتج</div>
      <div>⏭️ اتخطّى: ${dup.length + bad.length} منتج</div>
      ${dup.length ? `<div class="meta">موجودين قبل كده: ${dup.map(esc).join("، ")}</div>` : ""}
      ${bad.length ? `<div class="meta" style="color:var(--red)">بيانات ناقصة: ${bad.map(esc).join("، ")}</div>` : ""}
      ${noImage ? `<div class="meta">${noImage} منتج من غير صورة (أو الصورة مش رابط صالح)</div>` : ""}`);
  } catch (err) {
    console.error(err); show(esc(errText(err)), false);
  } finally { btn.disabled = false; }
});

// ---------- استيراد صور المنتجات (images.json) ----------
$("#import-images-btn").addEventListener("click", () => $("#import-images-file").click());
$("#import-images-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const show = resultBox($("#import-images-result"));
  const btn = $("#import-images-btn");
  const overwrite = $("#images-overwrite").checked;
  let map;
  try {
    map = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("shape");
  } catch {
    return show(esc('الملف مش مظبوط: لازم يكون JSON بالشكل ده {"اسم المنتج": "https://…"}'), false);
  }

  btn.disabled = true;
  show("جاري الاستيراد…");
  try {
    if (!(await loadProducts())) return show("مقدرناش نحمّل المنتجات الحالية، جرّبي تاني", false);
    const byName = new Map(products.map((p) => [normTitle(p.name), p]));
    const updates = [], notFound = [], invalid = [];
    let skipped = 0, same = 0;
    const seen = new Set();
    for (const [name, value] of Object.entries(map)) {
      const url = safeUrl(value); // روابط صور بس (https)، مش data URLs
      if (!url) { invalid.push(name); continue; }
      const p = byName.get(normTitle(name));
      if (!p) { notFound.push(name); continue; }
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.image === url) { same++; continue; }
      if (p.image && !overwrite) { skipped++; continue; }
      updates.push([p.id, url]);
    }
    for (let i = 0; i < updates.length; i += 400) {
      const batch = writeBatch(db);
      updates.slice(i, i + 400).forEach(([id, url]) =>
        batch.update(doc(db, "products", id), { image: url, updatedAt: serverTimestamp() }));
      await batch.commit();
    }
    await loadProducts();
    const withoutImage = products.filter((p) => !p.image).length;
    const list = (arr) => esc(arr.slice(0, 15).join("، ")) + (arr.length > 15 ? ` و${arr.length - 15} كمان` : "");
    show(`
      <div style="color:var(--green)">✅ اتحطّت صور لـ ${updates.length} منتج</div>
      ${skipped ? `<div>⏭️ ${skipped} منتج عنده صورة بالفعل (علّمي «استبدلي الصور الموجودة» لو عايزة تغيّريها)</div>` : ""}
      ${same ? `<div>✔️ ${same} منتج صورته نفس اللي في الملف</div>` : ""}
      ${notFound.length ? `<div class="meta" style="color:var(--red)">أسماء ملقيناش منتج بيها (${notFound.length}): ${list(notFound)}</div>` : ""}
      ${invalid.length ? `<div class="meta" style="color:var(--red)">روابط مش صالحة (${invalid.length}): ${list(invalid)}</div>` : ""}
      <div class="meta">المنتجات اللي لسه من غير صورة: ${withoutImage}</div>`);
  } catch (err) {
    console.error(err); show(esc(errText(err)), false);
  } finally { btn.disabled = false; }
});

// =====================================================================
// فورم العرض
// =====================================================================
const CUSTOM = "__custom";

function productOptions() {
  const company = $("#o-company").value.trim();
  const groups = new Map();
  for (const p of products) {
    const c = p.company || "بدون شركة";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(p);
  }
  // منتجات شركة العرض الأول
  const names = [...groups.keys()].sort((a, b) =>
    (b === company) - (a === company) || a.localeCompare(b, "ar"));
  return `<option value="">— اختاري منتج —</option>` +
    names.map((c) => `<optgroup label="${esc(c)}">${groups.get(c).map((p) =>
      `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.publicPrice)}</option>`).join("")}</optgroup>`).join("") +
    `<option value="${CUSTOM}">✏️ منتج مش في الكتالوج (اكتبي الاسم)</option>`;
}

function rowEls(row) {
  return {
    select: $('[data-f="productId"]', row),
    name: $('[data-f="name"]', row),
    qty: $('[data-f="qty"]', row),
    publicPrice: $('[data-f="publicPrice"]', row),
    offerPrice: $('[data-f="offerPrice"]', row),
    thumb: $("[data-thumb]", row)
  };
}

function showThumb(row, src) {
  const t = rowEls(row).thumb;
  const s = safeImage(src);
  t.hidden = !s;
  if (s) t.src = s; else t.removeAttribute("src");
}

// لما تختاري منتج: الاسم والسعر والصورة بيتملوا لوحدهم
function applySelection(row, fillPrice = true) {
  const r = rowEls(row);
  const v = r.select.value;
  r.name.hidden = v !== CUSTOM;
  r.name.required = v === CUSTOM;
  if (v && v !== CUSTOM) {
    const p = productsById.get(v);
    r.name.value = p.name;
    if (fillPrice) r.publicPrice.value = num(p.publicPrice);
    showThumb(row, p.image || row.dataset.image);
  } else {
    showThumb(row, v === CUSTOM ? row.dataset.image : "");
  }
}

function addItemRow(item = {}) {
  const row = $("#product-tpl").content.firstElementChild.cloneNode(true);
  const r = rowEls(row);
  r.select.innerHTML = productOptions();
  row.dataset.image = item.image || "";
  row.dataset.nameEn = item.nameEn || "";
  if (item.productId && productsById.has(item.productId)) r.select.value = item.productId;
  else if (item.name) r.select.value = CUSTOM;
  r.name.value = item.name || "";
  if (item.qty !== undefined) r.qty.value = item.qty;
  if (item.publicPrice !== undefined) r.publicPrice.value = item.publicPrice;
  if (item.offerPrice !== undefined) r.offerPrice.value = item.offerPrice;
  applySelection(row, item.publicPrice === undefined);

  r.select.addEventListener("change", () => {
    row.dataset.image = "";
    applySelection(row);
    if (r.select.value === CUSTOM) r.name.focus(); else r.qty.focus();
    itemsChanged();
  });
  $("[data-remove]", row).addEventListener("click", () => {
    if ($("#products").children.length > 1) row.remove();
    itemsChanged();
  });
  $("#products").appendChild(row);
  return row;
}

// إعادة بناء قوائم المنتجات في الصفوف (بعد تحميل المنتجات أو تغيير الشركة) من غير ما نضيّع الاختيار
function refreshItemSelects() {
  for (const row of $("#products").children) {
    const s = rowEls(row).select;
    const v = s.value;
    s.innerHTML = productOptions();
    s.value = v && (v === CUSTOM || productsById.has(v)) ? v : (rowEls(row).name.value ? CUSTOM : "");
    applySelection(row, false);
  }
}
$("#o-company").addEventListener("change", refreshItemSelects);

function readItems() {
  return [...$("#products").children].map((row) => {
    const r = rowEls(row);
    const id = r.select.value && r.select.value !== CUSTOM ? r.select.value : "";
    const p = id ? productsById.get(id) : null;
    return {
      productId: id,
      name: p ? p.name : r.name.value.trim(),
      qty: Math.max(1, num(r.qty.value) || 1),
      publicPrice: num(r.publicPrice.value),
      offerPrice: num(r.offerPrice.value),
      image: p ? p.image : row.dataset.image,
      nameEn: p ? p.nameEn || "" : row.dataset.nameEn || ""
    };
  }).filter((it) => it.name);
}

function updateCalc() {
  const t = calcTotals(readItems());
  $("#calc").innerHTML = `
    <div>إجمالي سعر الجمهور: ${money(t.totalPublic)}</div>
    <div>إجمالي سعر العرض: <span style="color:var(--red)">${money(t.totalOffer)}</span></div>
    <div>نسبة الخصم: ${t.discount}%</div>`;
  return t;
}

// أي تعديل في المنتجات أو الأسعار بإيدك: نحدّث الحساب و«سعر العرض الكلي»
function itemsChanged() {
  const t = updateCalc();
  $("#o-total").value = t.totalOffer > 0 ? Math.round(t.totalOffer * 100) / 100 : "";
}
$("#products").addEventListener("input", (e) => { if (e.target.matches("input")) itemsChanged(); });

// كتابة سعر العرض الكلي: يتوزّع على المنتجات بنسبة سعر الجمهور
$("#o-total").addEventListener("input", () => {
  const rows = [...$("#products").children].filter((row) => {
    const r = rowEls(row);
    return r.select.value && (r.select.value !== CUSTOM || r.name.value.trim());
  });
  const items = rows.map((row) => ({ qty: rowEls(row).qty.value, publicPrice: rowEls(row).publicPrice.value }));
  const units = splitOfferTotal($("#o-total").value, items);
  rows.forEach((row, i) => { rowEls(row).offerPrice.value = units[i] || ""; });
  updateCalc();
});

$("#add-product").addEventListener("click", () => { addItemRow(); updateCalc(); });

function resetForm() {
  editingId = null;
  $("#offer-form").reset();
  fillCategorySelect($("#o-category"), "");
  $("#products").innerHTML = "";
  addItemRow();
  updateCalc();
  $("#form-title").textContent = "عرض جديد";
  $("#save-btn").textContent = "حفظ العرض";
  $("#cancel-edit").hidden = true;
}
$("#cancel-edit").addEventListener("click", resetForm);

function offerPayload(o) {
  const items = o.products.map(offerItem);
  const t = calcTotals(items);
  return {
    company: o.company.trim(), category: o.category, name: o.name.trim(),
    titleEn: String(o.titleEn || "").trim(),
    imageUrl: safeUrl(o.imageUrl), products: items,
    endDate: isDateStr(o.endDate) ? o.endDate : "",
    totalPublic: t.totalPublic, totalOffer: t.totalOffer, discount: t.discount, itemsCount: t.items,
    updatedAt: serverTimestamp()
  };
}

// ربط عناصر العرض بالمنتجات اللي بنفس الاسم (عشان تاخد الصورة)
function linkItems(items) {
  const byName = new Map(products.map((p) => [normTitle(p.name), p]));
  let linked = 0;
  const out = items.map((it) => {
    const p = it.productId ? productsById.get(it.productId) : byName.get(normTitle(it.name));
    if (!p) return it;
    linked++;
    return { ...it, productId: p.id, image: p.image, nameEn: p.nameEn || it.nameEn || "" };
  });
  return { items: out, linked };
}

$("#offer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#offer-msg");
  const items = readItems();
  if (!items.length) return showMsg(msg, "ضيفي منتج واحد على الأقل");
  const data = offerPayload({
    company: $("#o-company").value, category: readCategory($("#o-category")),
    name: $("#o-name").value, titleEn: $("#o-name-en").value, imageUrl: $("#o-image").value, endDate: $("#o-end").value, products: items
  });
  if (!data.category) return showMsg(msg, "اختاري القسم");
  const btn = $("#save-btn"); btn.disabled = true;
  try {
    await rememberCategory(data.category);
    await saveNamesEn("o", data.company, data.category);
    if (editingId) await updateDoc(doc(db, "offers", editingId), data);
    else {
      await addDoc(collection(db, "offers"), { ...data, createdAt: serverTimestamp() });
      showPushPanel(data);
    }
    showMsg(msg, editingId ? "اتعدّل العرض ✅" : "اتضاف العرض ✅", true);
    resetForm();
    loadOffers();
  } catch (err) {
    console.error(err); showMsg(msg, errText(err));
  } finally { btn.disabled = false; }
});

// ---------- استيراد الأسماء الإنجليزي ----------
$("#import-en-btn").addEventListener("click", () => $("#import-en-file").click());
$("#import-en-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const show = resultBox($("#import-en-result"));
  const btn = $("#import-en-btn");
  let json;
  try {
    json = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("shape");
  } catch {
    return show(esc('الملف مش مظبوط: لازم يكون JSON بالشكل ده {"products":{…}, "offers":{…}, "categories":{…}, "companies":{…}}'), false);
  }

  btn.disabled = true;
  show("جاري الاستيراد…");
  try {
    if (!(await loadProducts()) || !(await loadOffers())) return show("مقدرناش نحمّل البيانات الحالية، جرّبي تاني", false);
    const companies = [...new Set([...offers, ...products].map((o) => o.company).filter(Boolean))];
    const plan = planEnglishNames(json, products, offers, categoryList(), companies);

    // تحديث المنتجات والعروض على دفعات
    const updates = [
      ...plan.productUpdates.map((u) => ["products", u.id, { nameEn: u.nameEn }]),
      ...plan.offerUpdates.map(({ id, ...rest }) => ["offers", id, rest])
    ];
    for (let i = 0; i < updates.length; i += 400) {
      const batch = writeBatch(db);
      updates.slice(i, i + 400).forEach(([col, id, data]) =>
        batch.update(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }));
      await batch.commit();
    }
    if (plan.stats.categories || plan.stats.companies) {
      await setDoc(doc(db, "settings", "names"),
        { categories: plan.categories, companies: plan.companies, updatedAt: serverTimestamp() }, { merge: true });
      Object.assign(namesEn.categories, plan.categories);
      Object.assign(namesEn.companies, plan.companies);
    }
    await loadProducts();
    await loadOffers();

    const st = plan.stats;
    const list = (arr) => esc(arr.slice(0, 15).join("، ")) + (arr.length > 15 ? ` و${arr.length - 15} كمان` : "");
    show(`
      <div style="color:var(--green)">✅ المنتجات: اتحدّث ${st.productsUpdated}${st.productsSame ? ` (و${st.productsSame} كانوا متحدّثين)` : ""}</div>
      <div style="color:var(--green)">✅ العروض: اتحدّث ${st.offersUpdated}${st.offersSame ? ` (و${st.offersSame} كانوا متحدّثين)` : ""}</div>
      ${st.itemsUpdated ? `<div>🔤 أسماء منتجات جوّه العروض: ${st.itemsUpdated}</div>` : ""}
      <div>🏷️ الأقسام: ${st.categories} · 🏢 الشركات: ${st.companies}</div>
      ${st.productsNotFound.length ? `<div class="meta" style="color:var(--red)">منتجات ملقيناش بنفس الاسم (${st.productsNotFound.length}): ${list(st.productsNotFound)}</div>` : ""}
      ${st.offersNotFound.length ? `<div class="meta" style="color:var(--red)">عروض ملقيناش بنفس الاسم (${st.offersNotFound.length}): ${list(st.offersNotFound)}</div>` : ""}`);
  } catch (err) {
    console.error(err); show(esc(errText(err)), false);
  } finally { btn.disabled = false; }
});

// ---------- إشعار العملاء (الإرسال من لوحة OneSignal، مفتاح الـ REST API مش في الموقع) ----------
const ONESIGNAL_NEW_PUSH = "https://dashboard.onesignal.com/apps/90e985ef-d6b2-4ad1-a419-b18a10142bec/push/new";
let pushText = null;

function showPushPanel(offer) {
  const price = Math.round(num(offer.totalOffer)).toLocaleString("en-US");
  pushText = {
    title: offer.name,
    message: `${offer.company} — السعر بعد الخصم ${price} جنيه`
  };
  $("#push-title").textContent = pushText.title;
  $("#push-message").textContent = pushText.message;
  showMsg($("#push-msg"), "");
  $("#push-panel").hidden = false;
  $("#push-panel").scrollIntoView({ behavior: "smooth" });
}

function copyFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  return ok;
}

$("#push-btn").addEventListener("click", () => {
  if (!pushText) return;
  const text = `${pushText.title}\n${pushText.message}`;
  // ننسخ الأول (لسه الصفحة عليها الفوكس) وبعدين نفتح OneSignal
  const copied = copyFallback(text);
  if (!copied && navigator.clipboard) navigator.clipboard.writeText(text).then(() => {}, () => {});
  window.open(ONESIGNAL_NEW_PUSH, "_blank", "noopener");
  showMsg($("#push-msg"), copied
    ? "اتنسخ النص ✅ الصقيه في OneSignal"
    : "مقدرناش ننسخ تلقائي، انسخي العنوان والرسالة من فوق", copied);
});

// ---------- قائمة العروض ----------
async function loadOffers() {
  try {
    const snap = await getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc")));
    offers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    $("#admin-offers").innerHTML = `<p class="error">${esc(errText(err))}</p>`;
    return false;
  }
  renderAdminList();
  return true;
}

function renderAdminList() {
  fillLists();
  $("#admin-offers").innerHTML = offers.length ? offers.map((o) => {
    const t = calcTotals(o.products);
    const st = offerStatus(o);
    const tag = st.expired ? `<span class="badge badge-expired">منتهي</span>`
      : st.endingSoon ? `<span class="badge badge-ending">${endLabel(st.daysLeft)}</span>`
      : st.isNew ? `<span class="badge badge-new">جديد</span>` : "";
    return `<div class="admin-item"${st.expired ? ' style="opacity:.6"' : ""}>
      <div class="info"><b>${esc(o.name)} ${tag}</b><small>${esc(o.company)} · ${esc(o.category)} · ${money(t.totalOffer)} (خصم ${t.discount}%)</small></div>
      <button class="btn btn-sm btn-ghost" data-edit="${esc(o.id)}">تعديل</button>
      <button class="btn btn-sm btn-red" data-del="${esc(o.id)}">مسح</button>
    </div>`;
  }).join("") : `<p class="state-msg">مفيش عروض لسه</p>`;
}

$("#admin-offers").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-del]");
  if (edit) {
    const o = offers.find((x) => x.id === edit.dataset.edit);
    if (!o) return;
    editingId = o.id;
    $("#o-company").value = o.company || "";
    setCategoryValue($("#o-category"), o.category);
    $("#o-name").value = o.name || "";
    $("#o-name-en").value = o.titleEn || "";
    prefillCompanyEn("o");
    prefillCategoryEn("o");
    $("#o-image").value = o.imageUrl || "";
    $("#o-end").value = isDateStr(o.endDate) ? o.endDate : "";
    $("#products").innerHTML = "";
    (o.products?.length ? o.products : [{}]).forEach(addItemRow);
    itemsChanged();
    $("#form-title").textContent = "تعديل العرض";
    $("#save-btn").textContent = "حفظ التعديل";
    $("#cancel-edit").hidden = false;
    $("#offer-form").scrollIntoView({ behavior: "smooth" });
  }
  if (del) {
    const o = offers.find((x) => x.id === del.dataset.del);
    if (!o || !confirm(`متأكدة إنك عايزة تمسحي «${o.name}»؟`)) return;
    try { await deleteDoc(doc(db, "offers", o.id)); if (editingId === o.id) resetForm(); loadOffers(); }
    catch (err) { alert(errText(err)); }
  }
});

$("#sample-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  try {
    const data = offerPayload({ ...SAMPLE_OFFER, products: linkItems(SAMPLE_OFFER.products).items });
    await addDoc(collection(db, "offers"), { ...data, createdAt: serverTimestamp() });
    showPushPanel(data);
    loadOffers();
  } catch (err) { alert(errText(err)); }
  finally { btn.disabled = false; }
});

// ---------- استيراد عروض من ملف ----------
$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // عشان نقدر نختار نفس الملف تاني
  if (!file) return;
  const show = resultBox($("#import-result"));
  const btn = $("#import-btn");
  let list;
  try { list = await readJsonList(file, "offers"); }
  catch { return show("الملف مش مظبوط: لازم يكون JSON فيه قائمة عروض [ ... ]", false); }

  btn.disabled = true;
  show("جاري الاستيراد…");
  try {
    // نتأكد إن القوائم محدّثة قبل ما نقارن الأسامي، ولو فشلت منكمّلش عشان منكرّرش عروض
    if (!(await loadProducts()) || !(await loadOffers())) {
      return show("مقدرناش نحمّل البيانات الحالية، جرّبي تاني", false);
    }
    const seen = new Set(offers.map((o) => normTitle(o.name)));
    const toAdd = [], dup = [], bad = [];
    let mismatch = 0, linked = 0, totalItems = 0;
    for (const raw of list) {
      const r = mapImportedOffer(raw);
      if (!r.offer) { bad.push(r.name ? `${r.name} (${r.reason})` : r.reason); continue; }
      const key = normTitle(r.offer.name);
      if (seen.has(key)) { dup.push(r.offer.name); continue; }
      seen.add(key);
      if (r.mismatch) mismatch++;
      const l = linkItems(r.offer.products);
      linked += l.linked; totalItems += l.items.length;
      toAdd.push({ ...r.offer, products: l.items.map(offerItem) });
    }

    // أول عرض في الملف يظهر الأول (الأحدث)
    const now = Date.now();
    await writeInBatches("offers", toAdd, (i) => ({
      createdAt: Timestamp.fromMillis(now - i),
      updatedAt: serverTimestamp()
    }));
    await loadOffers();

    const newCats = [...new Set(toAdd.map((o) => o.category))];
    show(`
      <div style="color:var(--green)">✅ اتضاف: ${toAdd.length} عرض</div>
      <div>⏭️ اتخطّى: ${dup.length + bad.length} عرض</div>
      ${totalItems ? `<div class="meta">🔗 اتربط ${linked} من ${totalItems} منتج بالكتالوج (وخدوا الصور)</div>` : ""}
      ${dup.length ? `<div class="meta">موجودين قبل كده: ${dup.map(esc).join("، ")}</div>` : ""}
      ${bad.length ? `<div class="meta" style="color:var(--red)">بيانات ناقصة: ${bad.map(esc).join("، ")}</div>` : ""}
      ${newCats.length ? `<div class="meta">الأقسام: ${newCats.map(esc).join("، ")}</div>` : ""}
      ${mismatch ? `<div class="meta">ملاحظة: ${mismatch} عرض الإجمالي اللي في الملف مختلف عن مجموع المنتجات، واتحسب من المنتجات.</div>` : ""}`);
  } catch (err) {
    console.error(err);
    show(esc(errText(err)), false);
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
// مانجر مروة
// =====================================================================
const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);

async function loadAbout() {
  try {
    const snap = await getDoc(doc(db, "settings", "about"));
    const a = snap.exists() ? snap.data() : {};
    $("#a-name").value = a.name || "";
    $("#a-photo").value = a.photoUrl || "";
    $("#a-bio").value = a.bio || "";
    $("#a-years").value = a.years ?? "";
    $("#a-courses").value = (a.courses || []).join("\n");
    $("#a-reviews").value = (a.reviews || []).join("\n");
  } catch (err) { console.error(err); }
}

$("#about-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#about-msg");
  const btn = e.submitter; btn.disabled = true;
  try {
    await setDoc(doc(db, "settings", "about"), {
      name: $("#a-name").value.trim(),
      photoUrl: safeUrl($("#a-photo").value),
      bio: $("#a-bio").value.trim(),
      years: num($("#a-years").value),
      courses: lines($("#a-courses").value),
      reviews: lines($("#a-reviews").value).map(safeUrl).filter(Boolean),
      updatedAt: serverTimestamp()
    });
    showMsg(msg, "اتحفظت الصفحة ✅", true);
  } catch (err) { console.error(err); showMsg(msg, errText(err)); }
  finally { btn.disabled = false; }
});

fillLists();
resetForm();
