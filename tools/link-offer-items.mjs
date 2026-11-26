// التشغيل (من فولدر المشروع، بعد firebase login):
//   node tools/link-offer-items.mjs . --dry   (تقرير بس)
//   node tools/link-offer-items.mjs .         (تحديث Firestore)
//
// Links every offer item to its catalog product (productId + image + nameEn), matching by name
// with Arabic letter variants ignored. Only the products field (and updatedAt) is changed.
// Run with --dry to only report.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [repo, ...flags] = process.argv.slice(2);
const DRY = flags.includes("--dry");
const { offerItem, normTitle, lineOffer, linePublic } = await import(pathToFileURL(path.join(repo, "js/utils.js")));
const PROJECT = "vip-offers-961c8";
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;
const token = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/configstore/firebase-tools.json"), "utf8")).tokens.access_token;
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const val = (v) => v == null ? v : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue)
  : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null
  : "arrayValue" in v ? (v.arrayValue.values || []).map(val) : "mapValue" in v ? obj(v.mapValue.fields) : "timestampValue" in v ? v.timestampValue : null;
const obj = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));
const enc = (v) => typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };

async function list(col) {
  let all = [], tok = "";
  do {
    const r = await fetch(`${BASE}/${col}?pageSize=300${tok ? "&pageToken=" + tok : ""}`, { headers: H });
    const j = await r.json();
    if (j.error) throw new Error(`${col}: ${j.error.message}`);
    all.push(...(j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...obj(d.fields) })));
    tok = j.nextPageToken || "";
  } while (tok);
  return all;
}

// the app's normTitle plus a few more letter variants (tatweel, ؤ/ئ, Arabic-Indic digits)
const key = (s) => normTitle(String(s || "").replace(/ـ/g, "").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
  .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));

const products = await list("products");
const byId = new Map(products.map((p) => [p.id, p]));
const byKey = new Map(products.map((p) => [key(p.name), p]));
const offers = await list("offers");

const writes = [], unmatched = [];
let itemsChanged = 0;
for (const o of offers) {
  const before = o.products || [];
  const after = before.map((it) => {
    const p = byKey.get(key(it.name)) || (it.productId && byId.get(it.productId));
    if (!p) { unmatched.push(`${it.name}  ←  ${o.name}`); return offerItem(it); }
    return offerItem({ ...it, productId: p.id, image: p.image || it.image, nameEn: p.nameEn || it.nameEn || "" });
  });
  // sanity: prices and quantities must stay identical
  const tot = (l) => [l.reduce((s, p) => s + lineOffer(p), 0), l.reduce((s, p) => s + linePublic(p), 0), l.map((p) => p.qty).join()];
  if (JSON.stringify(tot(before)) !== JSON.stringify(tot(after))) throw new Error("totals changed in " + o.name);
  const changed = after.filter((a, i) => JSON.stringify(a) !== JSON.stringify(offerItem(before[i]))).length
    || JSON.stringify(after) !== JSON.stringify(before.map(offerItem));
  if (!changed) continue;
  itemsChanged += after.filter((a, i) => a.productId !== before[i].productId || a.image !== before[i].image || a.nameEn !== before[i].nameEn).length;
  writes.push({
    update: { name: `${ROOT}/offers/${o.id}`, fields: { products: enc(after) } },
    updateMask: { fieldPaths: ["products"] },
    currentDocument: { exists: true },
    updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }]
  });
}

console.log(`offers to update: ${writes.length}, items gaining link/image/English name: ${itemsChanged}, unmatched items: ${unmatched.length}`);
unmatched.forEach((u) => console.log("  unmatched:", u));
if (DRY) process.exit(0);

for (let i = 0; i < writes.length; i += 400) {
  const r = await fetch(`${BASE}:commit`, { method: "POST", headers: H, body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
  const j = await r.json();
  if (j.error) throw new Error("commit: " + j.error.message);
}
const check = await list("offers");
const items = check.flatMap((o) => o.products || []);
console.log(`done. offers: ${check.length}; items without productId: ${items.filter((p) => !p.productId).length}, without image: ${items.filter((p) => !p.image).length}, without nameEn: ${items.filter((p) => !p.nameEn).length}`);
