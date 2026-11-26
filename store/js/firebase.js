// نسخة تلقائية من /js/firebase.js (node tools/sync-store.mjs) — متعدّليش هنا
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// للتجربة على الجهاز بس: localhost + localStorage.vip_emulator = "1" → Firebase Emulators (مش البيانات الحقيقية)
try {
  if (["localhost", "127.0.0.1"].includes(location.hostname) && localStorage.getItem("vip_emulator") === "1") {
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
} catch {}
