// يجيب صورة كل منتج من صفحته على متجر Shopify ويحفظها في images.json
//
// التشغيل (من فولدر المشروع):
//   npm install --prefix tools          (مرة واحدة: بيثبّت puppeteer-core لتحليل الصور)
//   node tools/fetch-images.mjs "C:\Users\ell\Downloads\product-pages.json"
//
// المدخل: JSON بالشكل {"اسم المنتج بالعربي": "رابط صفحة المنتج"}
// المخرج:  tools/images.json        {"اسم المنتج بالعربي": "رابط الصورة (مقاس 400)"}
//          tools/images-report.json  تفاصيل كل منتج (عدد الصور، اللي اتختارت، ودرجة الثقة)
//
// اختيار الصورة: لو الصفحة فيها كذا صورة، بنختار اللي فيها العلبة بس على خلفية سادة/بيضا
// (مش البانرات ولا صور العروض): بنصغّر كل صورة ونقيس قد إيه أطرافها بيضا/سادة،
// والصور العريضة (بانرات) بتاخد درجة أقل. لو JSON المنتج فشل، بناخد og:image من صفحة الـ HTML.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = process.argv[2];
const OUT = process.argv[3] || path.join(HERE, "images.json");
const REPORT = OUT.replace(/\.json$/i, "-report.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DELAY_MS = 400; // نستنّى شوية بين الطلبات عشان منضغطش على المتجر

if (!INPUT) {
  console.error('الاستخدام: node tools/fetch-images.mjs "<product-pages.json>" [images.json]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shopify بيحدّد عدد الطلبات (429 / local_rate_limited): لو حصل بنستنّى وقت أطول ونحاول تاني
async function get(url, type = "text") {
  const MAX = 5;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: type === "json" ? "application/json" : "*/*" }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status === 430) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 4000 * 2 ** (attempt - 1);
        if (attempt === MAX) throw new Error(`rate limited (HTTP ${res.status})`);
        process.stdout.write(`   ⏳ المتجر طالب نستنّى ${Math.round(wait / 1000)} ثانية…\n`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (type === "bytes") return { buf: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") || "image/jpeg" };
      const text = await res.text();
      if (/^\s*local_rate_limited/.test(text)) {
        if (attempt === MAX) throw new Error("rate limited");
        await sleep(4000 * 2 ** (attempt - 1));
        continue;
      }
      return type === "json" ? JSON.parse(text) : text;
    } catch (e) {
      if (attempt === MAX || /HTTP 404/.test(e.message)) throw e;
      await sleep(1500 * attempt);
    }
  }
}

// رابط صفحة المنتج → رابط الـ JSON (بنشيل ?query و # والـ / في الآخر)
function productJsonUrl(pageUrl) {
  const u = new URL(pageUrl);
  u.search = ""; u.hash = "";
  u.pathname = u.pathname.replace(/\/+$/, "").replace(/\.json$/, "") + ".json";
  return u.href;
}

// مقاس متوسط: نضيف _400x قبل الامتداد (ونشيل أي مقاس قديم)
export function sized(src, size = "400x") {
  const u = new URL(src.startsWith("//") ? "https:" + src : src);
  u.protocol = "https:";
  const isShopifyCdn = u.hostname === "cdn.shopify.com" || u.pathname.startsWith("/cdn/shop/");
  if (isShopifyCdn) {
    for (const k of ["width", "height", "crop"]) u.searchParams.delete(k); // المقاس بييجي من _400x
    u.pathname = u.pathname.replace(/(_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master))?(@\dx)?(\.[a-z0-9]+)$/i, `_${size}$4`);
  }
  return u.href;
}

function ogImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

// ---------- تحليل الصور في متصفح headless (لو متاح) ----------
let browser = null, page = null;
async function startBrowser() {
  let puppeteer;
  try { puppeteer = (await import("puppeteer-core")).default; }
  catch { console.warn("⚠️ puppeteer-core مش متثبّت (npm install --prefix tools) — هنختار أول صورة مربّعة من غير تحليل للخلفية."); return; }
  const candidates = [process.env.BROWSER_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean);
  const exe = candidates.find((p) => fs.existsSync(p));
  if (!exe) { console.warn("⚠️ ملقيناش Edge أو Chrome — هنختار من غير تحليل للخلفية."); return; }
  browser = await puppeteer.launch({ executablePath: exe, headless: "new" });
  page = await browser.newPage();
  await page.setContent("<canvas id=c width=64 height=64></canvas>");
}

// درجة «علبة على خلفية سادة»: نسبة الأطراف البيضا/السادة، وتباين الوسط (عشان الصورة مش فاضية)
async function analyze(dataUrl) {
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.getElementById("c"), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 64, 64); ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const px = (x, y) => { const i = (y * 64 + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    let border = 0, plain = 0, white = 0;
    const corner = px(1, 1);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (x > 4 && x < 59 && y > 4 && y < 59) continue;
      const [r, g, b, a] = px(x, y); border++;
      if (a < 30 || (Math.min(r, g, b) > 225 && Math.max(r, g, b) - Math.min(r, g, b) < 25)) white++;
      if (Math.abs(r - corner[0]) + Math.abs(g - corner[1]) + Math.abs(b - corner[2]) < 45) plain++;
    }
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) { const [r, g, b] = px(x, y); const l = (r + g + b) / 3; sum += l; sum2 += l * l; n++; }
    const centerStd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
    let whiteAll = 0, red = 0, edges = 0;
    const lum = (x, y) => { const [r, g, b] = px(x, y); return (r + g + b) / 3; };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const [r, g, b] = px(x, y);
      if (Math.min(r, g, b) > 225) whiteAll++;
      if (r > 170 && g < 80 && b < 90) red++;                      // ملصقات السعر/العرض الحمرا
      if (x < 63 && y < 63 && Math.abs(lum(x, y) - lum(x + 1, y)) + Math.abs(lum(x, y) - lum(x, y + 1)) > 90) edges++; // نصوص كتير
    }
    const N = 64 * 64;
    return { whiteBorder: white / border, plainBorder: plain / border, centerStd, whiteAll: whiteAll / N, red: red / N, edges: edges / N, w: img.naturalWidth, h: img.naturalHeight };
  }, dataUrl);
}

// الدرجة: أطراف بيضا (+)، ملصقات حمرا (-)، نصوص كتير (-)، صورة فاضية (-)
export function scoreStats(st) {
  return st.whiteBorder + 0.4 * st.plainBorder
    - 6 * Math.max(0, st.red - 0.005)
    - 2.5 * Math.max(0, st.edges - 0.06)
    + (st.centerStd < 8 ? -0.5 : 0);
}

// النكهات/الأنواع: لو اسم المنتج فيه نكهة والصفحة فيها نسخة (variant) بالنكهة دي، بناخد صورتها
const FLAVORS = [
  [/فانيليا|فانيلا|vanilla/i, /vanilla|فانيليا|فانيلا/i],
  [/فراولة|فراوله|strawberry/i, /strawberry|فراول/i],
  [/شوكولاتة|شوكولاته|شيكولاتة|شيكولاته|chocolate/i, /chocolate|شوكولا|شيكولا/i],
  [/ليمون|لمون|lemon/i, /lemon|ليمون|لمون/i],
  [/تفاح|apple/i, /apple|تفاح/i],
  [/قهوة|قهوه|coffee/i, /coffee|قهو/i],
  [/سوبيا|sobia/i, /sobia|سوبيا/i],
  [/تمر هندي|tamarind/i, /tamarind|تمر/i]
];
function variantImages(name, product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length < 2) return null;
  for (const [inName, inVariant] of FLAVORS) {
    if (!inName.test(name)) continue;
    const v = variants.find((x) => inVariant.test(`${x.title} ${x.option1 || ""} ${x.option2 || ""}`));
    if (!v) continue;
    const imgs = (product.images || []).filter((im) => im.id === v.image_id || (im.variant_ids || []).includes(v.id));
    if (imgs.length) return { imgs, variant: v.title };
  }
  return null;
}

async function pickImage(images) {
  // images: [{ src, width, height, alt, position }]
  let list = images.filter((im) => im && im.src).sort((a, b) => (a.position || 0) - (b.position || 0));
  // الـ GIF المتحرّكة غالباً إعلانات، منستخدمهاش إلا لو مفيش غيرها
  const still = list.filter((im) => !/\.gif(\?|$)/i.test(im.src));
  if (still.length) list = still;
  if (!list.length) return null;
  const scored = [];
  for (const [i, im] of list.entries()) {
    const ratio = im.width && im.height ? Math.max(im.width, im.height) / Math.min(im.width, im.height) : 1;
    const altBad = /عرض|خصم|offer|sale|banner|بانر/i.test(im.alt || "");
    let score = (ratio > 1.3 ? -0.4 : 0) + (altBad ? -0.2 : 0) + (i === 0 ? 0.05 : 0);
    let stats = null;
    if (page) {
      try {
        let got;
        try { got = await get(sized(im.src, "160x"), "bytes"); }
        catch { await sleep(800); got = await get(im.src, "bytes"); }
        const { buf, mime } = got;
        await sleep(250);
        stats = await analyze(`data:${mime.split(";")[0]};base64,${buf.toString("base64")}`);
        // أطراف بيضا = علبة على خلفية بيضا، أطراف سادة بلون تاني = نص النقطة، والوسط لازم يكون فيه حاجة
        score += scoreStats(stats);
      } catch (e) { stats = { error: e.message }; }
    }
    scored.push({ src: im.src, position: im.position, alt: im.alt || "", ratio: +ratio.toFixed(2), score: +score.toFixed(3), stats });
  }
  scored.sort((a, b) => b.score - a.score);
  return { best: scored[0], candidates: scored };
}

// ---------- التشغيل ----------
const pages = JSON.parse(fs.readFileSync(INPUT, "utf8").replace(/^\uFEFF/, ""));
// \u0627\u062E\u062A\u064A\u0627\u0631\u0627\u062A \u064A\u062F\u0648\u064A\u0629 \u0628\u0639\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629: {"\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062A\u062C": \u0631\u0642\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 (position) \u0641\u064A \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0646\u062A\u062C}
const OVERRIDES_FILE = path.join(HERE, "image-overrides.json");
const overrides = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8")) : {};
const entries = Object.entries(pages).filter(([k, v]) => k.trim() && typeof v === "string" && v.trim());
console.log(`📦 ${entries.length} منتج`);
await startBrowser();

const result = {}, report = {};
let ok = 0, viaOg = 0, failed = 0, lowConfidence = 0;
for (const [i, [name, pageUrl]] of entries.entries()) {
  const label = `[${i + 1}/${entries.length}] ${name}`;
  try {
    let chosen = null, source = "", candidates = [];
    try {
      const json = await get(productJsonUrl(pageUrl), "json");
      const p = json.product || {};
      const byVariant = variantImages(name, p);
      const imgs = byVariant ? byVariant.imgs : Array.isArray(p.images) && p.images.length ? p.images : p.image ? [p.image] : [];
      const forced = Number(overrides[name]) ? imgs.find((im) => im.position === Number(overrides[name])) : null;
      const pick = forced
        ? { best: { src: forced.src, position: forced.position, score: null, manual: true }, candidates: [] }
        : await pickImage(imgs);
      if (pick) {
        chosen = pick.best; candidates = pick.candidates;
        source = forced ? `product.json (اختيار يدوي: صورة رقم ${forced.position})`
          : byVariant ? `product.json (variant: ${byVariant.variant})` : "product.json";
      }
    } catch (e) {
      source = `product.json failed (${e.message})`;
    }
    if (!chosen) {
      const og = ogImage(await get(pageUrl, "text"));
      if (og) { chosen = { src: og, score: null }; source += (source ? " → " : "") + "og:image"; viaOg++; }
    }
    if (!chosen) throw new Error("مفيش صورة");
    const url = sized(chosen.src);
    result[name] = url;
    // محتاجة مراجعة: الأطراف مش بيضا، أو فيها ملصقات عروض حمرا/نصوص كتير (يعني غالباً صورة عرض مش العلبة بس)
    const st = chosen.stats && !chosen.stats.error ? chosen.stats : null;
    const low = !!st && (st.whiteBorder < 0.6 || st.red > 0.03 || st.edges > 0.12);
    if (low) lowConfidence++;
    report[name] = { page: pageUrl, image: url, source, images: candidates.length || 1, score: chosen.score, needsReview: low || undefined, candidates: candidates.length > 1 ? candidates : undefined };
    ok++;
    console.log(`✅ ${label} ← ${candidates.length || 1} صورة${low ? " (راجعيها)" : ""}`);
  } catch (e) {
    failed++;
    report[name] = { page: pageUrl, error: e.message };
    console.log(`❌ ${label}: ${e.message}`);
  }
  await sleep(DELAY_MS);
}
if (browser) await browser.close();

fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
console.log(`\nتمام: ${ok} صورة (منهم ${viaOg} من og:image)، فشل ${failed}، محتاجين مراجعة ${lowConfidence}`);
console.log(`📄 ${OUT}\n📄 ${REPORT}`);
