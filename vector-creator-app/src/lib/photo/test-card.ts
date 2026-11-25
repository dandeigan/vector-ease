/**
 * Burn spread test card: a small strip to burn on a scrap of the same wood
 * before the real piece. One row per Burn spread level (0 to 5), each with
 * the level number, a crop of the user's own photo (the busiest mid-tone
 * area, usually the eyes) and five grey steps. The user picks the row that
 * looks right and sets Burn spread to that number.
 *
 * Pure functions on pixel arrays (no DOM), so they run in tests too.
 * Output convention matches engrave.ts: 0 = burn, 255 = no burn.
 */
import { engravePixels, toGray, type EngraveOptions } from "./engrave";

export const CARD_LEVELS = [0, 1, 2, 3, 4, 5];
const STEPS = [15, 30, 50, 70, 85]; // darkness %, light to dark

/** mm → laser dots at this DPI. */
const px = (mm: number, dpi: number) => Math.max(1, Math.round((mm / 25.4) * dpi));

/**
 * Where to crop the photo: the square with the most mid-tone detail (faces,
 * eyes, fur). Flat black backgrounds and white lettering have few mid-tones
 * and their edges are too sharp to count, so they lose. Works on a small copy of the photo; returns fractions 0..1.
 */
export function busiestSquare(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number, sideFrac = 0.3): { x: number; y: number; side: number } {
  const n = W * H;
  const { gray, alpha } = toGray(rgba, n);
  const score = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    const g = gray[p];
    if (alpha[p] < 0.5 || g < 35 || g > 225) continue;
    // Soft shading (skin, fur) scores; hard edges (lettering rims) don't.
    const grad = Math.abs(gray[p + 1] - gray[p - 1]) + Math.abs(gray[p + W] - gray[p - W]);
    if (grad > 4 && grad < 50) score[p] = grad;
  }
  // Summed-area table so every window is O(1).
  const sat = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += score[y * W + x];
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  const s = Math.max(4, Math.round(Math.min(W, H) * sideFrac));
  const step = Math.max(1, Math.round(s / 8));
  let best = -1, bx = Math.round((W - s) / 2), by = Math.round((H - s) / 2);
  for (let y = 0; y + s <= H; y += step) for (let x = 0; x + s <= W; x += step) {
    const v = sat[(y + s) * (W + 1) + x + s] - sat[y * (W + 1) + x + s] - sat[(y + s) * (W + 1) + x] + sat[y * (W + 1) + x];
    if (v > best) { best = v; bx = x; by = y; }
  }
  return { x: bx / W, y: by / H, side: s / Math.min(W, H) };
}

/** Size in dots of the photo crop on the card (it's square). */
export function cardCropPx(dpi: number) {
  return px(20, dpi);
}

// 3x5 digit glyphs, rows top to bottom, bit 2 = left column.
const DIGITS: Record<number, number[]> = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1], 5: [7, 4, 7, 1, 7],
};

/**
 * Build the card. `crop` is the photo crop as RGBA, cardCropPx(dpi) square
 * (already on white, or with transparency if the background was removed).
 * Uses the user's current settings, with only Burn spread changing per row.
 */
export function buildTestCard(crop: Uint8ClampedArray, o: EngraveOptions): { pixels: Uint8ClampedArray; w: number; h: number; widthMm: number } {
  const dpi = o.dpi;
  const m = px(3, dpi), label = px(8, dpi), cs = cardCropPx(dpi), gap = px(3, dpi), stepW = px(6, dpi), rowGap = px(3, dpi);
  const W = m + label + cs + gap + stepW * STEPS.length + m;
  const H = m * 2 + cs * CARD_LEVELS.length + rowGap * (CARD_LEVELS.length - 1);
  const out = new Uint8ClampedArray(W * H).fill(255);

  // Grey steps as a plain image, run through the same tone path (no local
  // contrast or sharpening, which would distort flat patches).
  const sw = stepW * STEPS.length;
  const steps = new Uint8ClampedArray(sw * cs * 4);
  for (let y = 0; y < cs; y++) for (let x = 0; x < sw; x++) {
    const g = Math.round(255 * (1 - STEPS[Math.floor(x / stepW)] / 100));
    const i = (y * sw + x) * 4;
    steps[i] = steps[i + 1] = steps[i + 2] = g;
    steps[i + 3] = 255;
  }
  const flat: EngraveOptions = { ...o, depth: 0, detail: 0, brightness: 0, contrast: 0, removeBackground: false, solidBlacks: false, invertBackground: false, crispGraphics: false };

  const blit = (src: Uint8ClampedArray, sw2: number, sh: number, ox: number, oy: number) => {
    for (let y = 0; y < sh; y++) out.set(src.subarray(y * sw2, y * sw2 + sw2), (oy + y) * W + ox);
  };

  CARD_LEVELS.forEach((lvl, r) => {
    const top = m + r * (cs + rowGap);
    // Level number, burned solid.
    const cell = Math.max(1, Math.floor(Math.min(label * 0.7 / 3, cs * 0.5 / 5)));
    const gx = m + Math.round((label - cell * 3) / 2), gy = top + Math.round((cs - cell * 5) / 2);
    DIGITS[lvl].forEach((bits, ry) => {
      for (let cx = 0; cx < 3; cx++) if (bits & (4 >> cx)) {
        for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) out[(gy + ry * cell + yy) * W + gx + cx * cell + xx] = 0;
      }
    });
    blit(engravePixels(crop, cs, cs, { ...o, burnSpread: lvl }), cs, cs, m + label, top);
    blit(engravePixels(steps, sw, cs, { ...flat, burnSpread: lvl }), sw, cs, m + label + cs + gap, top);
  });
  return { pixels: out, w: W, h: H, widthMm: (W / dpi) * 25.4 };
}
