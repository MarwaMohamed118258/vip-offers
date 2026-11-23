// سلة الطلبات وبيانات الصيدلية وآخر طلب — كله محفوظ في localStorage على جهاز العميل بس
import { money } from "./utils.js";

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

// ---------- بيانات الصيدلية ----------
export function getPharmacy() {
  const p = read(PHARM_KEY, null);
  return p && p.name && p.area ? { name: String(p.name), area: String(p.area) } : null;
}
export function savePharmacy(name, area) {
  write(PHARM_KEY, { name: String(name).trim(), area: String(area).trim() });
}

// ---------- آخر طلب ----------
export function getLastOrder() {
  const o = read(LAST_KEY, null);
  return o && Array.isArray(o.items) ? o : null;
}
export function saveLastOrder(items) {
  write(LAST_KEY, { items: items.map(({ id, qty }) => ({ id, qty: clampQty(qty) })), at: Date.now() });
}

// ---------- رسالة واتساب ----------
// lines: [{ name, company, qty, unitPrice }]
export function buildOrderMessage(pharmacy, lines) {
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const body = lines.map((l, i) =>
    `${i + 1}) ${l.name}${l.company ? ` — ${l.company}` : ""}\n` +
    `   الكمية: ${l.qty} × ${money(l.unitPrice)} = ${money(l.qty * l.unitPrice)}`
  ).join("\n\n");
  return [
    "طلب جديد من عروض VIP 🛒",
    "",
    `🏪 الصيدلية / المخزن: ${pharmacy.name}`,
    `📍 المنطقة: ${pharmacy.area}`,
    "",
    body,
    "",
    "━━━━━━━━━━",
    `💰 الإجمالي: ${money(total)}`
  ].join("\n");
}
