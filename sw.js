// Service worker للـ PWA + OneSignal في نفس الملف
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (e) {
  // لو النت مقطوع أو OneSignal مش متاح، التطبيق يفضل شغال عادي
}

const VERSION = "vip-v8";
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
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // صفحات HTML: النت الأول، ولو مفيش نت نرجّع النسخة المحفوظة
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (url.origin === location.origin && url.pathname !== "/admin.html") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // ملفات الموقع + خطوط جوجل + Firebase SDK: من الكاش وبنحدّثه في الخلفية
  const cacheable =
    url.origin === location.origin ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com" ||
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
  if (!cacheable) return; // Firestore و OneSignal يروحوا للنت مباشرة

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
