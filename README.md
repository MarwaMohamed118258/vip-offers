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
