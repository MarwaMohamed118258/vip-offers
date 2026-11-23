// تصغير وضغط صورة في المتصفح: أقصى بُعد 500px وحجم أقل من 80KB، والنتيجة data URL.
// بنجرّب WebP الأول، ولو المتصفح مش بيدعمه بنستخدم JPEG.

const dataUrlBytes = (u) => Math.floor((u.length - u.indexOf(",") - 1) * 3 / 4);

async function decode(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

let webpOK;
function supportsWebp() {
  if (webpOK === undefined) {
    const c = document.createElement("canvas"); c.width = c.height = 1;
    webpOK = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpOK;
}

export async function compressImage(file, { maxSide = 500, maxBytes = 80 * 1024 } = {}) {
  if (!file || !file.type.startsWith("image/")) throw new Error("not-image");
  const src = await decode(file);
  const w0 = src.width, h0 = src.height;
  const type = supportsWebp() ? "image/webp" : "image/jpeg";
  let scale = Math.min(1, maxSide / Math.max(w0, h0));
  let best = null;

  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // خلفية بيضا بدل الشفافية (JPEG مبيدعمش الشفافية)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
      const url = canvas.toDataURL(type, q);
      if (!best || dataUrlBytes(url) < dataUrlBytes(best)) best = url;
      if (dataUrlBytes(url) <= maxBytes) { src.close?.(); return url; }
    }
    scale *= 0.8; // لسه كبيرة؟ نصغّر الأبعاد ونجرّب تاني
  }
  src.close?.();
  if (best && dataUrlBytes(best) <= maxBytes) return best;
  throw new Error("too-big");
}

export const imageKB = (u) => Math.round(dataUrlBytes(u) / 1024);
