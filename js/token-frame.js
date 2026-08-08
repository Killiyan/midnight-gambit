export const MG_TOKEN_FRAMES = [
  { key: "filigree", label: "Filigree", src: "systems/midnight-gambit/assets/images/Tokens/filifgree-frame.png", aperture: { x: 10.5, y: 11, width: 78.6, height: 76.9 } },
  { key: "mortal", label: "Mortal", src: "systems/midnight-gambit/assets/images/Tokens/mortal-frame.png", aperture: { x: 9.5, y: 6, width: 80.9, height: 86 } },
  { key: "soul", label: "Soul", src: "systems/midnight-gambit/assets/images/Tokens/soul-frame.png", aperture: { x: 13.9, y: 13.5, width: 73, height: 75.5 } },
  { key: "kintsugi", label: "Kintsugi", src: "systems/midnight-gambit/assets/images/Tokens/kintsugi-frame.png", aperture: { x: 11, y: 10.2, width: 77.3, height: 75.1 } }
];

export function mgGetTokenFrame(key) {
  return MG_TOKEN_FRAMES.find(frame => frame.key === key) ||
    MG_TOKEN_FRAMES.find(frame => frame.key === "soul") ||
    MG_TOKEN_FRAMES[0];
}

export function mgResolveDrawableImageSrc(src) {
  const clean = String(src ?? "").trim();
  if (!clean) return "";
  if (/^(https?:|data:|blob:)/i.test(clean)) return clean;
  return foundry.utils.getRoute(clean);
}

export function mgLoadDrawableImage(src, { anonymous = true } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = mgResolveDrawableImageSrc(src);
  });
}

function mgGetFilePickerSources() {
  const sources = FilePicker?.sources;
  if (!sources) return [];
  if (sources instanceof Map) return Array.from(sources.entries());
  return Object.entries(sources);
}

function mgGetTokenFrameUploadSource() {
  const sources = mgGetFilePickerSources();
  const sourceText = ([key, source]) => `${key} ${source?.label ?? ""} ${source?.name ?? ""}`;
  const forgeSource = sources.find(source => /forge/i.test(sourceText(source)));
  const dataSource = sources.find(([key]) => key === "data");
  return forgeSource?.[0] ?? dataSource?.[0] ?? sources[0]?.[0] ?? "data";
}

async function mgLoadCanvasImage(src) {
  try {
    return await mgLoadDrawableImage(src, { anonymous: true });
  } catch (err) {
    const clean = String(src ?? "").trim();
    if (!/^(https?:)?\/\//i.test(clean)) throw err;
    return mgLoadDrawableImage(src, { anonymous: false });
  }
}

function mgSlug(value, fallback = "token") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

async function mgEnsureUploadDirectory(source, target) {
  if (typeof FilePicker?.createDirectory !== "function") return;
  const parts = String(target ?? "").split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await FilePicker.createDirectory(source, current, { notify: false });
    } catch (_) {
      // Existing directories and sources without folder creation are both fine here.
    }
  }
}

function mgCanvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export framed token image."));
    }, "image/png");
  });
}

function mgCanvasToDataURL(canvas, imageSrc) {
  try {
    return canvas.toDataURL("image/png");
  } catch (err) {
    const clean = String(imageSrc ?? "").trim();
    if (/^(https?:)?\/\//i.test(clean)) {
      throw new Error("This remote image can be displayed, but the browser will not allow Midnight Gambit to export it as a framed token. Choose it through Foundry's file browser or upload a local/world image first.", { cause: err });
    }
    throw err;
  }
}

async function mgUploadTokenFrameCanvas(canvas, actor, frameDef) {
  if (typeof FilePicker?.upload !== "function" || typeof File !== "function") return "";
  const canUpload = game.user?.can?.("FILES_UPLOAD") ?? game.user?.isTrusted ?? game.user?.isGM ?? false;
  if (!canUpload) return "";

  const source = mgGetTokenFrameUploadSource();
  const target = "midnight-gambit/token-frames";
  const actorId = mgSlug(actor?.id || actor?._id || actor?.name, "actor");
  const frameKey = mgSlug(frameDef?.key, "frame");
  const filename = `${actorId}-${frameKey}.png`;
  const blob = await mgCanvasToBlob(canvas);
  const file = new File([blob], filename, { type: "image/png" });

  await mgEnsureUploadDirectory(source, target);
  const response = await FilePicker.upload(source, target, file, {}, { notify: false });
  return String(response?.path || response?.url || `${target}/${filename}`).trim();
}

export function mgGetActorTokenPreviewBox(img, stage) {
  const imgRect = img?.getBoundingClientRect?.();
  const stageRect = stage?.getBoundingClientRect?.();
  if (!imgRect || !stageRect || stageRect.width <= 0 || stageRect.height <= 0 || imgRect.width <= 0 || imgRect.height <= 0) return null;
  const size = 1000;
  return {
    x: ((imgRect.left - stageRect.left) / stageRect.width) * size,
    y: ((imgRect.top - stageRect.top) / stageRect.height) * size,
    width: (imgRect.width / stageRect.width) * size,
    height: (imgRect.height / stageRect.height) * size
  };
}

function mgClampDrawBoxToClip(draw, clip) {
  let { x, y, width, height } = draw;
  const minScale = Math.max(clip.width / Math.max(width, 1), clip.height / Math.max(height, 1), 1);
  if (minScale > 1) {
    const cx = x + (width / 2);
    const cy = y + (height / 2);
    width *= minScale;
    height *= minScale;
    x = cx - (width / 2);
    y = cy - (height / 2);
  }

  if (x > clip.x) x = clip.x;
  if (y > clip.y) y = clip.y;
  if (x + width < clip.x + clip.width) x = clip.x + clip.width - width;
  if (y + height < clip.y + clip.height) y = clip.y + clip.height - height;

  return { x, y, width, height };
}

export function mgGetTokenMinScale(frameKey, img) {
  if (!img?.naturalWidth || !img?.naturalHeight) return 1;
  const frame = mgGetTokenFrame(frameKey);
  const aperture = frame?.aperture || { width: 100, height: 100 };
  const imageRatio = img.naturalWidth / Math.max(img.naturalHeight, 1);
  const apertureRatio = aperture.width / Math.max(aperture.height, 1);
  return Math.max(1, imageRatio / Math.max(apertureRatio, 0.001));
}

async function mgRenderActorTokenCanvas(imageSrc, frameDef, crop = {}, previewBox = null) {
  const [image, frameImg] = await Promise.all([
    mgLoadCanvasImage(imageSrc),
    mgLoadCanvasImage(frameDef.src)
  ]);
  const size = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const x = Number.isFinite(crop.x) ? crop.x : 50;
  const y = Number.isFinite(crop.y) ? crop.y : 50;
  const scale = Number.isFinite(crop.scale) ? crop.scale : 1;
  const widthPct = Number.isFinite(crop.width) && crop.width > 0 ? crop.width : 100;
  const heightPct = Number.isFinite(crop.height) && crop.height > 0 ? crop.height : null;
  const aperture = frameDef.aperture || { x: 0, y: 0, width: 100, height: 100 };
  const clipX = (aperture.x / 100) * size;
  const clipY = (aperture.y / 100) * size;
  const clipW = (aperture.width / 100) * size;
  const clipH = (aperture.height / 100) * size;
  const clip = { x: clipX, y: clipY, width: clipW, height: clipH };
  const imageRatio = image.naturalWidth / Math.max(image.naturalHeight, 1);
  const hasPreviewBox = previewBox &&
    Number.isFinite(previewBox.x) &&
    Number.isFinite(previewBox.y) &&
    Number.isFinite(previewBox.width) &&
    Number.isFinite(previewBox.height) &&
    previewBox.width > 0 &&
    previewBox.height > 0;
  let drawX;
  let drawY;
  let drawW;
  let drawH;

  if (hasPreviewBox) {
    ({ x: drawX, y: drawY, width: drawW, height: drawH } = previewBox);
  } else {
    let baseW = (widthPct / 100) * clipW;
    let baseH = heightPct ? (heightPct / 100) * clipH : baseW / imageRatio;
    if (!Number.isFinite(baseH) || baseH <= 0) baseH = size;

    drawW = baseW * scale;
    drawH = baseH * scale;
    drawX = clipX + (clipW / 2) - (drawW * (x / 100));
    drawY = clipY + (clipH / 2) - (drawH * (y / 100));
  }

  ({ x: drawX, y: drawY, width: drawW, height: drawH } = mgClampDrawBoxToClip(
    { x: drawX, y: drawY, width: drawW, height: drawH },
    clip
  ));

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, clipW, clipH);
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawW, drawH);
  ctx.restore();
  ctx.drawImage(frameImg, 0, 0, size, size);
  return canvas;
}

export async function mgComposeActorTokenImage(imageSrc, frameDef, crop = {}, previewBox = null) {
  const canvas = await mgRenderActorTokenCanvas(imageSrc, frameDef, crop, previewBox);
  return mgCanvasToDataURL(canvas, imageSrc);
}

export async function mgComposeAndStoreActorTokenImage(actor, imageSrc, frameDef, crop = {}, previewBox = null) {
  const canvas = await mgRenderActorTokenCanvas(imageSrc, frameDef, crop, previewBox);
  try {
    const uploaded = await mgUploadTokenFrameCanvas(canvas, actor, frameDef);
    if (uploaded) return uploaded;
  } catch (err) {
    console.warn("MG | Could not upload framed token image; falling back to inline image.", err);
  }
  return mgCanvasToDataURL(canvas, imageSrc);
}
