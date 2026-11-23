// =====================================================================
// إعدادات Firebase — حطي هنا الكود اللي بتاخديه من Firebase Console:
// Project settings → General → Your apps → Web app → SDK setup and configuration
// (مفاتيح Firebase دي مش سرية، الحماية الحقيقية في firestore.rules)
// =====================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyDUygrnvI6si7K-7_oNbKFk5MFpBcLazL4",
  authDomain: "vip-offers-961c8.firebaseapp.com",
  projectId: "vip-offers-961c8",
  storageBucket: "vip-offers-961c8.firebasestorage.app",
  messagingSenderId: "783880103025",
  appId: "1:783880103025:web:77fc769589367f17afe7d0"
};

// رقم واتساب الطلبات (بالصيغة الدولية من غير +)
export const WHATSAPP_NUMBER = "201276795766";

// OneSignal: حطي الـ App ID هنا بعدين (من لوحة OneSignal → Settings → Keys & IDs)
export const ONESIGNAL_APP_ID = "90e985ef-d6b2-4ad1-a419-b18a10142bec";

export const isFirebaseConfigured = () => !firebaseConfig.apiKey.startsWith("PASTE_");
