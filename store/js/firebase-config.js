// إعدادات موقع «متجر العروض» (Offers Store) — نفس مشروع Firebase ونفس Firestore بتوع تطبيق VIP
// (مفاتيح Firebase دي مش سرية، الحماية الحقيقية في firestore.rules)
export const firebaseConfig = {
  apiKey: "AIzaSyDUygrnvI6si7K-7_oNbKFk5MFpBcLazL4",
  authDomain: "vip-offers-961c8.firebaseapp.com",
  projectId: "vip-offers-961c8",
  storageBucket: "vip-offers-961c8.firebasestorage.app",
  messagingSenderId: "783880103025",
  appId: "1:783880103025:web:77fc769589367f17afe7d0"
};

// رابط الموقع (للمشاركة)
export const STORE_URL = "https://offers-store-961c8.web.app";

// OneSignal للمتجر: تطبيق OneSignal تاني منفصل عن VIP.
// لما تعمليه (Site URL = رابط المتجر فوق)، حطي الـ App ID هنا من Settings → Keys & IDs واعملي deploy.
// طول ما هو فاضي: زرار التفعيل بيطلب إذن الإشعارات من المتصفح بس، والاشتراك بيتسجّل أول ما الـ ID يتحط.
export const ONESIGNAL_APP_ID_STORE = "";

// notifications.js (مشترك مع VIP) بيقرا الاسم ده
export const ONESIGNAL_APP_ID = ONESIGNAL_APP_ID_STORE;

export const isFirebaseConfigured = () => !firebaseConfig.apiKey.startsWith("PASTE_");
