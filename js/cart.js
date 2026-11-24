// سلة الطلبات وبيانات الصيدلية وآخر طلب — كله محفوظ في localStorage على جهاز العميل بس
import { money, randomId } from "./utils.js";

const CART_KEY = "vip_cart";
const LAST_KEY = "vip_last_order";
const PHARM_KEY = "vip_pharmacy";
const MAX_QTY = 999;

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const clampQty = (q) => Math.min(MAX_QTY, Math.max(1, Math.round(Number(q) || 1)));

// ---------- السلة: [{ id, qty }] ----------
export function getCart() {
  const c = read(CART_KEY, []);
  return Array.isArray(c) ? c.filter((x) => x && typeof x.id === "string").map((x) => ({ id: x.id, qty: clampQty(x.qty) })) : [];
}
function saveCart(c) {
  write(CART_KEY, c);
  window.dispatchEvent(new Event("cart-change"));
}
export function addToCart(id, qty = 1) {
  const c = getCart();
  const it = c.find((x) => x.id === id);
  if (it) it.qty = clampQty(it.qty + qty); else c.push({ id, qty: clampQty(qty) });
  saveCart(c);
}
export function setQty(id, qty) {
  saveCart(getCart().map((x) => (x.id === id ? { ...x, qty: clampQty(qty) } : x)));
}
export function removeFromCart(...ids) {
  saveCart(getCart().filter((x) => !ids.includes(x.id)));
}
export function clearCart() { saveCart([]); }
export const cartCount = () => getCart().reduce((s, x) => s + x.qty, 0);

// ---------- بيانات العميل (الصيدلية / المخزن) ----------
// { id, name, area, phone } — الـ id كود عشوائي طويل بيتعمل مرة واحدة ويتبعت مع كل طلب
export const PHONE_RE = /^[+0-9 ]{8,20}$/;
export const cleanPhone = (v) => String(v || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^+0-9 ]/g, "").trim();

export function getCustomer() {
  const p = read(PHARM_KEY, null);
  if (!p || !p.name || !p.area) return null;
  // العملاء القدام (قبل الكود): نعملهم كود ونحفظه
  if (!p.id || !/^[A-Za-z0-9]{24,64}$/.test(p.id)) { p.id = randomId(); write(PHARM_KEY, p); }
  return { id: p.id, name: String(p.name), area: String(p.area), phone: String(p.phone || "") };
}
// بيانات كاملة = فيها الموبايل كمان
export const customerComplete = (c) => !!(c && c.name && c.area && PHONE_RE.test(c.phone));

export function saveCustomer(name, area, phone) {
  const old = read(PHARM_KEY, null) || {};
  const id = old.id && /^[A-Za-z0-9]{24,64}$/.test(old.id) ? old.id : randomId();
  write(PHARM_KEY, { id, name: String(name).trim(), area: String(area).trim(), phone: cleanPhone(phone) });
  return getCustomer();
}
export const customerId = () => getCustomer()?.id || "";

// ---------- آخر طلب ----------
export function getLastOrder() {
  const o = read(LAST_KEY, null);
  return o && Array.isArray(o.items) ? o : null;
}
export function saveLastOrder(items, orderId = "") {
  write(LAST_KEY, { items: items.map(({ id, qty }) => ({ id, qty: clampQty(qty) })), at: Date.now(), orderId });
}

// ---------- رسالة واتساب ----------
// lines: [{ name, company, qty, unitPrice }]
export function buildOrderMessage(customer, lines) {
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const body = lines.map((l, i) =>
    `${i + 1}) ${l.name}${l.company ? ` — ${l.company}` : ""}\n` +
    `   الكمية: ${l.qty} × ${money(l.unitPrice)} = ${money(l.qty * l.unitPrice)}`
  ).join("\n\n");
  return [
    "طلب جديد من عروض VIP 🛒",
    "",
    `🏪 الصيدلية / المخزن: ${customer.name}`,
    `📍 المنطقة: ${customer.area}`,
    ...(customer.phone ? [`📞 الموبايل: ${customer.phone}`] : []),
    ...(customer.id ? [`🆔 كود العميل: ${customer.id.slice(0, 8)}`] : []),
    "",
    body,
    "",
    "━━━━━━━━━━",
    `💰 الإجمالي: ${money(total)}`
  ].join("\n");
}
