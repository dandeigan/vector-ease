import sharp from "sharp";

/**
 * Line-art preparation for drawings, engravings and sketches: one ink on paper.
 *
 * Instead of splitting the image into N colours (which turns faint line edges
 * into paper-coloured layers), every pixel is either paper or ink, judged by
 * brightness. The threshold starts at Otsu's automatic split and the
 * "sensitivity" slider moves it, so faint lines can be picked up or dropped.
 * Ink can then be split into 1–3 tones (darkest first) for different laser
 * power settings. Paper is painted pure white so the route can drop it.
 */

export const PAPER_HEX = "FFFFFF";

export interface LineArtOptions {
  /** 1–3 ink layers. */
  tones: number;
  /** 0–100. 50 = automatic; higher picks up fainter lines. */
  sensitivity: number;
}

/** Otsu's method: the grey level that best separates two groups. */
function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

const hex = (r: number, g: number, b: number) =>
  [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();

export async function prepareLineArt(
  imageBuffer: Buffer,
  opts: LineArtOptions,
): Promise<{ png: Buffer; inkHexes: string[] }> {
  const tones = Math.min(3, Math.max(1, Math.round(opts.tones || 1)));
  const sensitivity = Math.min(100, Math.max(0, Number.isFinite(opts.sensitivity) ? opts.sensitivity : 50));

  // Transparent areas count as paper.
  const { data, info } = await sharp(imageBuffer)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const grey = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grey[p] = g;
    hist[g]++;
  }

  // Threshold: Otsu leans strict on line art (faint lines are a small share of
  // the pixels), so the default sits 30 grey levels lighter. The slider moves
  // it ±60 from there.
  // Never reach the paper itself: stay 15 levels darker than the most common paper grey.
  const split = otsu(hist, n);
  let paper = split + 1;
  for (let g = split + 1; g < 256; g++) if (hist[g] > hist[paper]) paper = g;
  const threshold = Math.min(paper - 15, Math.max(15, split + 30 + Math.round((sensitivity - 50) * 1.2)));

  // Tone boundaries: equal shares of the ink pixels, darkest tone first.
  const inkHist = hist.slice(0, threshold);
  const inkTotal = inkHist.reduce((a, b) => a + b, 0);
  const bounds: number[] = []; // upper grey (exclusive) for tones 0..tones-2
  if (tones > 1 && inkTotal > 0) {
    let acc = 0, next = 1;
    for (let g = 0; g < threshold && next < tones; g++) {
      acc += inkHist[g];
      if (acc >= (inkTotal * next) / tones) { bounds.push(g + 1); next++; }
    }
  }
  const toneOf = (g: number) => {
    for (let t = 0; t < bounds.length; t++) if (g < bounds[t]) return t;
    return bounds.length;
  };
  const toneCount = bounds.length + 1;

  // Each tone's colour = the average colour of its pixels, so the preview looks like the original.
  const sums = Array.from({ length: toneCount }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  const toneIdx = new Int8Array(n).fill(-1);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    if (grey[p] >= threshold) continue;
    const t = toneOf(grey[p]);
    toneIdx[p] = t;
    const s = sums[t];
    s.r += data[i]; s.g += data[i + 1]; s.b += data[i + 2]; s.n++;
  }
  const used = new Set<string>([PAPER_HEX]);
  const inkHexes: string[] = [];
  const inkRgb: [number, number, number][] = [];
  sums.forEach((s, t) => {
    let [r, g, b] = s.n ? [s.r / s.n, s.g / s.n, s.b / s.n] : [t * 60, t * 60, t * 60];
    let h = hex(r, g, b);
    // Keep every layer colour distinct (and never pure white).
    while (used.has(h)) { r = Math.max(0, r - 3); g = Math.max(0, g - 3); b = Math.max(0, b - 3); h = hex(r, g, b); }
    used.add(h);
    inkHexes.push(h);
    inkRgb.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
  });

  const out = Buffer.alloc(n * 3, 255);
  for (let p = 0; p < n; p++) {
    const t = toneIdx[p];
    if (t < 0) continue;
    const c = inkRgb[t];
    out[p * 3] = c[0]; out[p * 3 + 1] = c[1]; out[p * 3 + 2] = c[2];
  }
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  return { png, inkHexes };
}

/** Remove the paper paths from a VTracer SVG (cutout mode, so ink shapes stand alone). */
export function stripPaper(svg: string): string {
  return svg.replace(new RegExp(`<path\\b[^>]*fill="#${PAPER_HEX}"[^>]*/>`, "gi"), "");
}
