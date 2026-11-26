# vip-offers
عروض VIP لكبار العملاء: تطبيق ويب PWA بالعربي لعرض عروض شركات الأدوية والمكملات للصيدليات والمخازن.

## الملفات
| الملف | الوظيفة |
|---|---|
| `index.html`, `js/app.js` | التطبيق: الترحيب، العروض، التفاصيل، الإشعارات، مانجر مروة |
| `admin.html`, `js/admin.js` | لوحة التحكم (تسجيل دخول + إضافة/تعديل/مسح العروض + صفحة مانجر مروة) |
| `js/firebase-config.js` | **إعدادات Firebase ورقم واتساب و ONESIGNAL_APP_ID** |
| `sw.js`, `manifest.json`, `icons/` | الـ PWA |
| `firestore.rules` | قواعد الأمان: الكل يقرأ، الأدمن بس يكتب |
| `netlify.toml` | إعدادات Netlify |

## الإعداد
1. حطي إعدادات Firebase بتاعتك في `js/firebase-config.js`.
2. في Firebase Console:
   - **Authentication → Sign-in method**: فعّلي Email/Password، وبعدين من **Users** ضيفي حساب الأدمن.
   - **Firestore Database**: اعملي قاعدة بيانات، وانسخي محتوى `firestore.rules` في تبويب **Rules** واضغطي Publish.
   - في Firestore اعملي collection اسمها `admins` وجواها document اسمه نفس الـ **User UID** بتاع حساب الأدمن (هتلاقيه في Authentication → Users). المستند ممكن يكون فيه حقل واحد مثلاً `role: "admin"`.
   - **Authentication → Settings → Authorized domains**: ضيفي دومين Netlify بتاعك.
3. افتحي `/admin.html` وسجّلي دخول واضغطي «ضيفي عرض تجريبي».
4. (بعدين) حطي `ONESIGNAL_APP_ID` في `js/firebase-config.js`.

## تشغيل محلي
```
npx serve .
```
وافتحي http://localhost:3000

## متجر العروض (Offers Store)
موقع تاني للجمهور في نفس مشروع Firebase ونفس Firestore: https://offers-store-961c8.web.app

| الملف | الوظيفة |
|---|---|
| `store/` | موقع المتجر (`store/js/store-app.js` هو التطبيق، و `store/js/firebase-config.js` فيه `ONESIGNAL_APP_ID_STORE`) |
| `js/core.js` | أدوات عامة مشتركة بين VIP والمتجر (الأسعار، التواريخ…) |
| `js/store-shared.js` | منطق المتجر: المحافظات، الشحن، رسالة واتساب، ظهور الشركات، المساعد (الأسئلة والإجابات) |
| `js/admin-store.js` | تبويبات Offers Store في لوحة الأدمن |
| `tools/sync-store.mjs` | بينسخ الملفات المشتركة لـ `store/` (بيشتغل لوحده قبل deploy المتجر) |

- الملفات اللي في `store/` وأولها «نسخة تلقائية» متعدّليهاش هناك: عدّلي الأصل في `js/` أو `css/` وشغّلي `node tools/sync-store.mjs`.
- Firestore: `companies`، `faq`، `consumerOrders`، `storeFollowups`، و `settings/store`.

### الـ deploy
```
firebase deploy --only hosting:vip      # تطبيق VIP
firebase deploy --only hosting:store    # متجر العروض
firebase deploy --only firestore:rules
```
