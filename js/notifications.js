// الإشعارات عن طريق OneSignal Web SDK (v16)
// لو ONESIGNAL_APP_ID فاضي، بنستخدم إذن المتصفح العادي لحد ما يتحط الـ ID.
import { ONESIGNAL_APP_ID } from "./firebase-config.js";

let oneSignalReady = null;

function loadOneSignal() {
  if (!ONESIGNAL_APP_ID) return null;
  if (oneSignalReady) return oneSignalReady;
  oneSignalReady = new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          // بنستخدم نفس الـ service worker بتاع الـ PWA (sw.js بيستورد كود OneSignal)
          serviceWorkerPath: "sw.js",
          serviceWorkerParam: { scope: "/" },
          allowLocalhostAsSecureOrigin: true
        });
        OneSignal.Notifications.addEventListener("permissionChange", () => notify());
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
  return oneSignalReady;
}

const listeners = new Set();
export function onNotifChange(fn) { listeners.add(fn); }
function notify() { listeners.forEach((fn) => fn(getStatus())); }

export function isSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

// "granted" | "denied" | "default" | "unsupported"
export function getStatus() {
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

export async function initNotifications() {
  await loadOneSignal();
  notify();
}

export async function enableNotifications() {
  if (!isSupported()) { notify(); return "unsupported"; }
  try {
    const OneSignal = await loadOneSignal();
    if (OneSignal) {
      await OneSignal.Notifications.requestPermission();
      if (Notification.permission === "granted") await OneSignal.User.PushSubscription.optIn();
    } else {
      await Notification.requestPermission();
    }
  } catch (e) {
    console.warn("Permission request failed", e);
  }
  notify();
  return getStatus();
}
