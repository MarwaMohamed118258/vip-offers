// Service worker للـ PWA + OneSignal في نفس الملف
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (e) {
  // لو النت مقطوع أو OneSignal مش متاح، التطبيق يفضل شغال عادي
}

// غيّري الرقم ده مع كل تحديث عشان الكاش القديم يتمسح
const VERSION = "vip-v13";
const SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/utils.js",
  "/js/notifications.js",
  "/js/firebase-config.js",
  "/js/firebase.js",
  "/js/image.js",
  "/js/cart.js",
  "/js/i18n.js",
  "/js/voice.js",
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // cache: "reload" = نجيب من السيرفر نفسه مش من كاش المتصفح (عشان منحفظش نسخة قديمة)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .catch((e) => console.warn("precache failed", e))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// النت الأول، والكاش بس لو مفيش نت
async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    // طلبات الصفحات (navigate) مينفعش نديها options، والسيرفر بيبعتها no-cache أصلاً
    const res = await (req.mode === "navigate" ? fetch(req) : fetch(req, { cache: "no-cache" }));
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true })) ||
      (fallbackUrl && (await cache.match(fallbackUrl))) ||
      Response.error();
  }
}

// الكاش الأول (للملفات اللي اسمها فيه رقم نسخة ومبتتغيّرش: Firebase SDK والخطوط والأيقونات)
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  // الصفحات: النت الأول، ولو مفيش نت الصفحة المحفوظة
  if (req.mode === "navigate") {
    if (sameOrigin && url.pathname.startsWith("/admin")) return; // لوحة الأدمن من النت دايماً
    event.respondWith(networkFirst(req, "/index.html"));
    return;
  }

  if (sameOrigin) {
    // HTML و JS و CSS و manifest: النت الأول دايماً عشان أي تحديث يظهر على طول
    if (/\.(html|js|css|json)$/.test(url.pathname) || url.pathname === "/") {
      if (url.pathname === "/sw.js") return;
      event.respondWith(networkFirst(req));
      return;
    }
    // الأيقونات والصور
    event.respondWith(cacheFirst(req));
    return;
  }

  // خطوط جوجل + Firebase SDK (روابطها فيها رقم النسخة)
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ||
      (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))) {
    event.respondWith(cacheFirst(req));
  }
  // أي حاجة تانية (Firestore و OneSignal): النت مباشرة
});
