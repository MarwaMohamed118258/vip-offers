// نسخة تلقائية من /js/notifications.js (node tools/sync-store.mjs) — متعدّليش هنا
// الإشعارات عن طريق OneSignal Web SDK (v16)
// sw.js هو الـ service worker الوحيد على الموقع، وبيستورد كود OneSignal جواه.
import { ONESIGNAL_APP_ID } from "./firebase-config.js";

let OS = null;            // نسخة OneSignal بعد ما الـ init يخلص
let osReady = null;       // Promise بيخلص لما OneSignal يجهز (أو يفشل)

const listeners = new Set();
export function onNotifChange(fn) { listeners.add(fn); }
function notify() { listeners.forEach((fn) => fn(getStatus())); }

// ---------- الآيفون ----------
export function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}
// على الآيفون الإشعارات بتشتغل بس لو التطبيق متضاف للشاشة الرئيسية
export const needsIOSInstall = () => isIOS() && !isStandalone();

export function isSupported() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

// "granted" | "denied" | "default" | "unsupported" | "ios-install"
export function getStatus() {
  if (needsIOSInstall()) return "ios-install";
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

function loadOneSignal() {
  if (!ONESIGNAL_APP_ID || !isSupported()) return Promise.resolve(null);
  if (osReady) return osReady;
  osReady = new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          serviceWorkerPath: "sw.js",
          serviceWorkerParam: { scope: "/" },
          allowLocalhostAsSecureOrigin: true
        });
        OneSignal.Notifications.addEventListener("permissionChange", notify);
        OS = OneSignal;
        resolve(OneSignal);
      } catch (e) {
        console.warn("OneSignal init failed", e);
        resolve(null);
      }
    });
    const s = document.createElement("script");
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.defer = true;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return osReady;
}

export async function initNotifications() {
  await loadOneSignal();
  notify();
}

// لازم تتنادي مباشرة من ضغطة زرار (الآيفون/سفاري بيرفض الطلب لو مش من ضغطة)
export async function enableNotifications() {
  const status = getStatus();
  if (status === "ios-install" || status === "unsupported") { notify(); return status; }
  try {
    // لو OneSignal جاهز بنطلب الإذن فوراً عشان منضيّعش ضغطة المستخدم
    const OneSignal = OS || await loadOneSignal();
    if (OneSignal) {
      await OneSignal.Notifications.requestPermission();
      if (Notification.permission === "granted" && !OneSignal.User.PushSubscription.optedIn) {
        await OneSignal.User.PushSubscription.optIn();
      }
    } else {
      await Notification.requestPermission();
    }
  } catch (e) {
    console.warn("Permission request failed", e);
  }
  notify();
  return getStatus();
}

// تسجيل sw.js للـ PWA (الشغل من غير نت + التثبيت).
// لو فيه service worker متسجّل بالفعل (من OneSignal أو قبل كده) منسجلش تاني،
// عشان OneSignal بيسجّل نفس الملف بـ query مختلفة ومش عايزين الاتنين يتخانقوا.
export async function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    let reg = await navigator.serviceWorker.getRegistration("/");
    const url = reg && (reg.active || reg.waiting || reg.installing)?.scriptURL;
    if (!(url && new URL(url).pathname === "/sw.js")) {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    }
    // نشوف لو فيه نسخة جديدة: دلوقتي، وكل ما التطبيق يرجع قدّام (التطبيق المتثبّت مبيعملش reload لوحده)
    const check = () => reg.update().catch(() => {});
    check();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  } catch (e) {
    console.warn("SW registration failed", e);
  }
}

// لما service worker جديد يمسك الصفحة: نعمل reload مرة واحدة عشان الملفات الجديدة تشتغل.
// لازم تتنادي أول ما الصفحة تفتح (قبل ما التحديث يخلص).
export function reloadOnNewServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // أول زيارة خالص (مفيش service worker لسه) مش محتاجة reload
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    // حماية من التكرار: مرة واحدة بس كل 30 ثانية
    try {
      const last = Number(sessionStorage.getItem("vip_sw_reload") || 0);
      if (Date.now() - last < 30000) return;
      sessionStorage.setItem("vip_sw_reload", String(Date.now()));
    } catch {}
    reloading = true;
    location.reload();
  });
}
