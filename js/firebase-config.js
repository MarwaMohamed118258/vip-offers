// =====================================================================
// إعدادات Firebase — حطي هنا الكود اللي بتاخديه من Firebase Console:
// Project settings → General → Your apps → Web app → SDK setup and configuration
// (مفاتيح Firebase دي مش سرية، الحماية الحقيقية في firestore.rules)
// =====================================================================
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// رقم واتساب الطلبات (بالصيغة الدولية من غير +)
export const WHATSAPP_NUMBER = "201276795766";

// OneSignal: حطي الـ App ID هنا بعدين (من لوحة OneSignal → Settings → Keys & IDs)
export const ONESIGNAL_APP_ID = "";

export const isFirebaseConfigured = () => !firebaseConfig.apiKey.startsWith("PASTE_");
