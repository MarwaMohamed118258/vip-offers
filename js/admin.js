import { isFirebaseConfigured } from "./firebase-config.js";
import { CATEGORIES, SAMPLE_OFFER, esc, money, num, calcTotals, safeUrl } from "./utils.js";

const $ = (s, el = document) => el.querySelector(s);

if (!isFirebaseConfigured()) {
  $("main").innerHTML = `<p class="state-msg">لسه إعدادات Firebase متحطتش في <code>js/firebase-config.js</code></p>`;
  throw new Error("Firebase not configured");
}

const { db, auth } = await import("./firebase.js");
const {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, query, orderBy, serverTimestamp
} = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
const { signInWithEmailAndPassword, onAuthStateChanged, signOut } =
  await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");

let offers = [];
let editingId = null;

function showMsg(el, text, ok = false) {
  el.hidden = !text;
  el.textContent = text || "";
  el.style.color = ok ? "var(--green)" : "var(--red)";
}

function errText(e) {
  if (e?.code === "permission-denied") return "مفيش صلاحية. اتأكدي إن حسابك متضاف في مجموعة admins في Firestore.";
  if (e?.code?.startsWith("auth/")) return "الإيميل أو الباسورد غلط";
  return "حصلت مشكلة، جرّبي تاني";
}

// ---------- تسجيل الدخول ----------
onAuthStateChanged(auth, (user) => {
  $("#login-view").hidden = !!user;
  $("#admin-view").hidden = !user;
  $("#logout").hidden = !user;
  $("#who").textContent = user ? user.email : "سجّلي دخول الأول";
  if (user) { loadOffers(); loadAbout(); }
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
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.className = "btn " + (x === b ? "btn-purple" : "btn-ghost"));
  $("#tab-offers").hidden = b.dataset.tab !== "offers";
  $("#tab-about").hidden = b.dataset.tab !== "about";
}));

// ---------- فورم العرض ----------
$("#o-category").innerHTML = CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");

function addProductRow(p = {}) {
  const node = $("#product-tpl").content.firstElementChild.cloneNode(true);
  for (const f of ["name", "qty", "publicPrice", "offerPrice"]) {
    if (p[f] !== undefined) node.querySelector(`[data-f="${f}"]`).value = p[f];
  }
  node.querySelector("[data-remove]").addEventListener("click", () => {
    if ($("#products").children.length > 1) node.remove();
    updateCalc();
  });
  $("#products").appendChild(node);
}

function readProducts() {
  return [...$("#products").children].map((row) => ({
    name: row.querySelector('[data-f="name"]').value.trim(),
    qty: Math.max(1, num(row.querySelector('[data-f="qty"]').value) || 1),
    publicPrice: num(row.querySelector('[data-f="publicPrice"]').value),
    offerPrice: num(row.querySelector('[data-f="offerPrice"]').value)
  })).filter((p) => p.name);
}

function updateCalc() {
  const t = calcTotals(readProducts());
  $("#calc").innerHTML = `
    <div>إجمالي سعر الجمهور: ${money(t.totalPublic)}</div>
    <div>إجمالي سعر العرض: <span style="color:var(--red)">${money(t.totalOffer)}</span></div>
    <div>نسبة الخصم: ${t.discount}%</div>`;
}
$("#products").addEventListener("input", updateCalc);
$("#add-product").addEventListener("click", () => { addProductRow(); updateCalc(); });

function resetForm() {
  editingId = null;
  $("#offer-form").reset();
  $("#products").innerHTML = "";
  addProductRow();
  updateCalc();
  $("#form-title").textContent = "عرض جديد";
  $("#save-btn").textContent = "حفظ العرض";
  $("#cancel-edit").hidden = true;
}
$("#cancel-edit").addEventListener("click", resetForm);

function offerPayload(o) {
  const products = o.products.map((p) => ({
    name: String(p.name), qty: Math.max(1, num(p.qty) || 1),
    publicPrice: num(p.publicPrice), offerPrice: num(p.offerPrice)
  }));
  const t = calcTotals(products);
  return {
    company: o.company.trim(), category: o.category, name: o.name.trim(),
    imageUrl: safeUrl(o.imageUrl), products,
    totalPublic: t.totalPublic, totalOffer: t.totalOffer, discount: t.discount, itemsCount: t.items,
    updatedAt: serverTimestamp()
  };
}

$("#offer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#offer-msg");
  const products = readProducts();
  if (!products.length) return showMsg(msg, "ضيفي منتج واحد على الأقل");
  const data = offerPayload({
    company: $("#o-company").value, category: $("#o-category").value,
    name: $("#o-name").value, imageUrl: $("#o-image").value, products
  });
  const btn = $("#save-btn"); btn.disabled = true;
  try {
    if (editingId) await updateDoc(doc(db, "offers", editingId), data);
    else await addDoc(collection(db, "offers"), { ...data, createdAt: serverTimestamp() });
    showMsg(msg, editingId ? "اتعدّل العرض ✅" : "اتضاف العرض ✅", true);
    resetForm();
    loadOffers();
  } catch (err) {
    console.error(err); showMsg(msg, errText(err));
  } finally { btn.disabled = false; }
});

// ---------- قائمة العروض ----------
async function loadOffers() {
  const box = $("#admin-offers");
  try {
    const snap = await getDocs(query(collection(db, "offers"), orderBy("createdAt", "desc")));
    offers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err); box.innerHTML = `<p class="error">${esc(errText(err))}</p>`; return;
  }
  const names = [...new Set(offers.map((o) => o.company).filter(Boolean))];
  $("#companies").innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
  box.innerHTML = offers.length ? offers.map((o) => {
    const t = calcTotals(o.products);
    return `<div class="admin-item">
      <div class="info"><b>${esc(o.name)}</b><small>${esc(o.company)} · ${esc(o.category)} · ${money(t.totalOffer)} (خصم ${t.discount}%)</small></div>
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
    $("#o-category").value = o.category || CATEGORIES[0];
    $("#o-name").value = o.name || "";
    $("#o-image").value = o.imageUrl || "";
    $("#products").innerHTML = "";
    (o.products?.length ? o.products : [{}]).forEach(addProductRow);
    updateCalc();
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
    await addDoc(collection(db, "offers"), { ...offerPayload(SAMPLE_OFFER), createdAt: serverTimestamp() });
    loadOffers();
  } catch (err) { alert(errText(err)); }
  finally { btn.disabled = false; }
});

// ---------- مانجر مروة ----------
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

resetForm();
