// البحث بالصوت: Web Speech API بتاع المتصفح نفسه (مجاني، من غير أي خدمة خارجية)
// لو المتصفح مش بيدعمه، زرار المايك مش بيظهر خالص.
import { t, isEn } from "./i18n.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = () => typeof SR === "function";

let active = null; // التسجيل الشغّال دلوقتي (واحد بس في نفس الوقت)

// input: خانة البحث، onError: دالة بتعرض رسالة (toast)
export function setupVoiceSearch(input, onError = () => {}) {
  if (!voiceSupported() || !input) return;
  const wrap = input.closest(".search-wrap");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mic-btn";
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>`;
  const status = document.createElement("span");
  status.className = "mic-status";
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  wrap.append(btn, status);
  wrap.classList.add("has-mic");

  const label = () => btn.setAttribute("aria-label", btn.classList.contains("listening") ? t("micStop") : t("micStart"));
  label();
  document.addEventListener("langchange", label);

  const setListening = (on) => {
    btn.classList.toggle("listening", on);
    wrap.classList.toggle("listening", on);
    status.hidden = !on;
    status.textContent = on ? t("listening") : "";
    label();
  };

  const run = (text) => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  btn.addEventListener("click", () => {
    // ضغطة تانية وهو بيسمع = وقّف
    if (active && active.btn === btn) { active.rec.stop(); return; }
    if (active) active.rec.abort();

    const rec = new SR();
    rec.lang = isEn() ? "en-US" : "ar-EG";
    rec.interimResults = true;   // النص بيظهر وإنت بتتكلم
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let heard = false;

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      text = text.trim();
      if (!text) return;
      heard = true;
      run(text);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") onError(t("micDenied"));
      else if (e.error === "no-speech") onError(t("micNoSpeech"));
      else if (e.error === "network") onError(t("micNetwork"));
    };
    rec.onend = () => {
      setListening(false);
      if (active && active.rec === rec) active = null;
      if (heard) input.blur(); // نقفل الكيبورد عشان النتايج تبان
    };

    active = { rec, btn };
    try { rec.start(); } catch { active = null; setListening(false); }
  });
}
