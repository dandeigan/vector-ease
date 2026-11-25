"use client";

/**
 * AI background removal, in the browser.
 *
 * The ISNet model (DIS, Apache-2.0, about 44 MB, cached after the first use)
 * runs in a web worker (public/workers/remove-bg.js) so the page doesn't
 * freeze. It finds the subject (people, pets, objects, text) and returns
 * the image with the background made transparent. Nothing is uploaded.
 */

const SIZE = 1024;
let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) worker = new Worker("/workers/remove-bg.js", { type: "module" });
  return worker;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = url;
  });
}

function runModel(rgba: Uint8ClampedArray, onProgress?: (msg: string) => void): Promise<Uint8ClampedArray> {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      if (e.data.progress) { onProgress?.(e.data.progress); return; }
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.mask as Uint8ClampedArray);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || "Background removal failed."));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, rgba }, [rgba.buffer]);
  });
}

/** Returns a PNG data URL of the image with its background transparent. */
export async function removeBackground(imageUrl: string, onProgress?: (msg: string) => void): Promise<string> {
  onProgress?.("Loading the AI model...");
  const img = await loadImage(imageUrl);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Model input: the image squashed to 1024 x 1024 on white.
  const inCanvas = document.createElement("canvas");
  inCanvas.width = SIZE;
  inCanvas.height = SIZE;
  const ictx = inCanvas.getContext("2d", { willReadFrequently: true })!;
  ictx.fillStyle = "#ffffff";
  ictx.fillRect(0, 0, SIZE, SIZE);
  ictx.drawImage(img, 0, 0, SIZE, SIZE);
  const mask = await runModel(ictx.getImageData(0, 0, SIZE, SIZE).data, onProgress);

  // Mask back to the image's own size (smooth edges).
  const maskSmall = document.createElement("canvas");
  maskSmall.width = SIZE;
  maskSmall.height = SIZE;
  const mctx = maskSmall.getContext("2d")!;
  const md = mctx.createImageData(SIZE, SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) {
    md.data[p * 4 + 3] = mask[p];
  }
  mctx.putImageData(md, 0, 0);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(maskSmall, 0, 0, W, H);
  // Keep the photo only where the mask is.
  octx.globalCompositeOperation = "source-in";
  octx.drawImage(img, 0, 0, W, H);
  onProgress?.("Done");
  return out.toDataURL("image/png");
}
