import type { ImportedDesign } from "./types";
import { DEFAULT_LAYERS, IMAGE_LAYER } from "./layers";

/**
 * Open a photo (JPG, PNG, WebP; HEIC where the browser can read it) in the
 * Studio, on the Image engrave layer.
 *
 * Size: a file that carries a real print resolution (Photo engrave PNGs do,
 * 150 DPI or more) opens at that exact size in mm. Anything else (phone
 * photos say 72 DPI, which means nothing for a laser) opens 100 mm wide.
 */
const DEFAULT_WIDTH_MM = 100;

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This browser can't read that image. Save it as JPG or PNG and try again (iPhone HEIC photos: share or export as JPG)."));
    img.src = url;
  });
}

/** Dots per inch stored in the file, if any (PNG pHYs, JPEG JFIF). */
function storedDpi(bytes: Uint8Array): number | null {
  // PNG: pHYs chunk, pixels per metre.
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    for (let i = 8; i + 12 <= bytes.length && i < 1 << 20; ) {
      const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (type === "pHYs" && bytes[i + 16] === 1) {
        const ppm = ((bytes[i + 8] << 24) | (bytes[i + 9] << 16) | (bytes[i + 10] << 8) | bytes[i + 11]) >>> 0;
        return ppm * 0.0254;
      }
      if (type === "IDAT" || len < 0) break;
      i += 12 + len;
    }
    return null;
  }
  // JPEG: JFIF APP0 density.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[6] === 0x4a && bytes[7] === 0x46) {
    const units = bytes[13];
    const x = (bytes[14] << 8) | bytes[15];
    if (units === 1) return x;
    if (units === 2) return x * 2.54;
  }
  return null;
}

export async function importImage(file: File, fileName = "Photo"): Promise<ImportedDesign> {
  const head = new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer());
  const dataUrl = await readDataUrl(file);
  const img = await decode(dataUrl);
  const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
  const dpi = storedDpi(head);
  const widthMm = dpi && dpi >= 150 ? (w / dpi) * 25.4 : DEFAULT_WIDTH_MM;
  const k = widthMm / w;
  const name = fileName.replace(/\.[^.]+$/, "") || "Photo";
  return {
    name,
    items: [{ kind: "image", dataUrl, width: w, height: h, transform: [k, 0, 0, k, 0, 0], layerId: "image", name }],
    layers: [...DEFAULT_LAYERS, IMAGE_LAYER],
    warnings: dpi && dpi >= 150
      ? []
      : [`"${name}" opened ${DEFAULT_WIDTH_MM} mm wide; drag a corner to resize. For a laser-ready photo, run it through Convert → Photo engrave first.`],
  };
}
