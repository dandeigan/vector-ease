/**
 * Photo engrave: turn a photo into a laser-ready image.
 *
 * Lasers engrave photos as dots, not vectors (LightBurn's dithered image
 * modes). This prepares that image the way a skilled operator would by hand:
 *   1. local contrast (CLAHE) so faces and fur get depth instead of flat grey
 *   2. sharpening so edges and eyes stay crisp after dithering
 *   3. brightness / contrast and a per-material burn curve
 *   4. invert for materials where the laser makes LIGHT marks (slate, dark metal)
 *   5. removed background = no burn at all
 *   6. dithering at the laser's real resolution (DPI), so one pixel = one dot
 *
 * Pure functions on grey pixel arrays, so they run in the browser and in tests.
 * Output convention: 0 = black = laser fires, 255 = white = no burn.
 */

export type DitherId = "jarvis" | "stucki" | "floyd" | "atkinson" | "grayscale";
export type MaterialId = "wood" | "leather" | "paper" | "slate" | "darkmetal";

export interface Material {
  id: MaterialId;
  label: string;
  hint: string;
  /** Laser makes light marks on this material, so the image is flipped. */
  invert: boolean;
  /** Burn curve: below 1 lightens the mid-tones (for materials that burn dark fast). */
  gamma: number;
  dither: DitherId;
  /** Preview colours: the bare material and a laser mark on it. */
  base: string;
  mark: string;
}

export const MATERIALS: Material[] = [
  { id: "wood", label: "Wood", hint: "Plywood, basswood, MDF. Burns dark quickly, so mid-tones are lightened.", invert: false, gamma: 0.78, dither: "jarvis", base: "#E7CFA5", mark: "#4A2C16" },
  { id: "leather", label: "Leather", hint: "Real and faux leather.", invert: false, gamma: 0.85, dither: "jarvis", base: "#B07A4C", mark: "#3B2213" },
  { id: "paper", label: "Card / paper", hint: "Card stock, cork, cardboard.", invert: false, gamma: 0.9, dither: "jarvis", base: "#F2EBDD", mark: "#5A4632" },
  { id: "slate", label: "Slate / tile", hint: "The laser makes light marks, so the image is flipped.", invert: true, gamma: 0.9, dither: "stucki", base: "#33363A", mark: "#C9CCCF" },
  { id: "darkmetal", label: "Dark metal", hint: "Black anodized aluminium, painted tumblers. Light marks, so flipped.", invert: true, gamma: 1, dither: "stucki", base: "#1E2124", mark: "#D8DADC" },
];

export const DITHERS: { id: DitherId; label: string; hint: string }[] = [
  { id: "jarvis", label: "Jarvis", hint: "Smooth, fine detail. Best all-rounder." },
  { id: "stucki", label: "Stucki", hint: "Crisp and clean, great on slate and metal." },
  { id: "floyd", label: "Floyd-Steinberg", hint: "Classic, slightly grainier." },
  { id: "atkinson", label: "Atkinson", hint: "High contrast, punchy highlights." },
  { id: "grayscale", label: "Grayscale", hint: "No dots. For lasers that vary power by shade." },
];

/** Line interval choices: dots per inch at the laser. */
export const DPI_CHOICES = [
  { dpi: 169, label: "169 DPI (0.15 mm)", hint: "Fast, bold" },
  { dpi: 254, label: "254 DPI (0.10 mm)", hint: "Most diode lasers" },
  { dpi: 318, label: "318 DPI (0.08 mm)", hint: "Fine detail" },
  { dpi: 423, label: "423 DPI (0.06 mm)", hint: "Fibre / very fine" },
];

export interface EngraveOptions {
  widthMm: number;
  dpi: number;
  material: MaterialId;
  invert: boolean;
  /** -50..50 */
  brightness: number;
  /** -50..50 */
  contrast: number;
  /** Local contrast strength 0..100. */
  depth: number;
  /** Sharpening 0..100. */
  detail: number;
  dither: DitherId;
  removeBackground: boolean;
  /** With the background removed: keep only the main subject (drops text, logos, half-found objects). */
  mainSubjectOnly?: boolean;
  /** Remove lone single dots (they burn shallow and sand off unevenly). */
  cleanDots?: boolean;
}

export const DEFAULT_ENGRAVE: EngraveOptions = {
  widthMm: 100,
  dpi: 254,
  material: "wood",
  invert: false,
  brightness: 0,
  contrast: 0,
  depth: 50,
  detail: 50,
  dither: "jarvis",
  removeBackground: false,
  mainSubjectOnly: true,
  cleanDots: true,
};

/** Biggest image we'll make, so the browser never stalls (about 600 mm at 254 DPI). */
export const MAX_SIDE_PX = 6000;

export function materialById(id: MaterialId): Material {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
}

/** Pixel size of the engraving: one pixel per laser dot. */
export function targetSize(imgW: number, imgH: number, widthMm: number, dpi: number) {
  let w = Math.max(1, Math.round((widthMm / 25.4) * dpi));
  let h = Math.max(1, Math.round((w * imgH) / imgW));
  const k = Math.min(1, MAX_SIDE_PX / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return { w, h, heightMm: (widthMm * imgH) / imgW, capped: k < 1 };
}

/** RGBA → luma (0..255) and alpha (0..1). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, n: number) {
  const gray = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    gray[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    alpha[p] = rgba[i + 3] / 255;
  }
  return { gray, alpha };
}

/**
 * CLAHE (contrast-limited adaptive histogram equalization): evens out
 * contrast tile by tile, so detail shows in both the shadows and the
 * highlights. Only subject pixels (alpha > 0.5) count toward the histograms.
 */
function clahe(gray: Float32Array, alpha: Float32Array, W: number, H: number, strength: number): Float32Array {
  if (strength <= 0) return gray;
  const tiles = 8;
  const tw = W / tiles, th = H / tiles;
  const maps: Float32Array[] = [];
  const hist = new Float64Array(256);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      hist.fill(0);
      const x0 = Math.floor(tx * tw), x1 = Math.floor((tx + 1) * tw);
      const y0 = Math.floor(ty * th), y1 = Math.floor((ty + 1) * th);
      let count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = y * W + x;
        if (alpha[p] <= 0.5) continue;
        hist[Math.max(0, Math.min(255, gray[p] | 0))]++;
        count++;
      }
      const map = new Float32Array(256);
      if (count < 16) {
        for (let v = 0; v < 256; v++) map[v] = v;
      } else {
        // Clip tall bins (limit 3x the flat level) and spread the excess evenly.
        const limit = Math.max(1, (3 * count) / 256);
        let excess = 0;
        for (let v = 0; v < 256; v++) if (hist[v] > limit) { excess += hist[v] - limit; hist[v] = limit; }
        const add = excess / 256;
        let cdf = 0;
        for (let v = 0; v < 256; v++) { cdf += hist[v] + add; map[v] = (cdf / count) * 255; }
      }
      maps.push(map);
    }
  }
  // Blend the four nearest tile maps for every pixel (no visible tile seams).
  const out = new Float32Array(gray.length);
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(tiles - 1, (y + 0.5) / th - 0.5));
    const ya = Math.floor(fy), yb = Math.min(tiles - 1, ya + 1), wy = fy - ya;
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const v = Math.max(0, Math.min(255, gray[p] | 0));
      const fx = Math.max(0, Math.min(tiles - 1, (x + 0.5) / tw - 0.5));
      const xa = Math.floor(fx), xb = Math.min(tiles - 1, xa + 1), wx = fx - xa;
      const top = maps[ya * tiles + xa][v] * (1 - wx) + maps[ya * tiles + xb][v] * wx;
      const bot = maps[yb * tiles + xa][v] * (1 - wx) + maps[yb * tiles + xb][v] * wx;
      const eq = top * (1 - wy) + bot * wy;
      out[p] = gray[p] + (eq - gray[p]) * strength;
    }
  }
  return out;
}

/** Box blur, horizontal then vertical, radius r (three passes ≈ Gaussian). */
function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const a = src.slice();
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / (2 * r + 1);
        acc += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  return a;
}

type Kernel = { div: number; taps: [number, number, number][] };
const KERNELS: Record<Exclude<DitherId, "grayscale">, Kernel> = {
  floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  jarvis: {
    div: 48,
    taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  stucki: {
    div: 42,
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  // Atkinson spreads only 6/8 of the error: highlights stay clean.
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
};

/** Error-diffusion dither, serpentine (alternating rows) so there are no diagonal streaks. */
function dither(v: Float32Array, W: number, H: number, id: Exclude<DitherId, "grayscale">): Uint8ClampedArray {
  const { div, taps } = KERNELS[id];
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const ltr = y % 2 === 0;
    for (let i = 0; i < W; i++) {
      const x = ltr ? i : W - 1 - i;
      const p = y * W + x;
      const old = v[p];
      const nv = old < 128 ? 0 : 255;
      out[p] = nv;
      const err = (old - nv) / div;
      if (!err) continue;
      for (const [dx, dy, w] of taps) {
        const xx = x + (ltr ? dx : -dx), yy = y + dy;
        if (xx < 0 || xx >= W || yy >= H) continue;
        v[yy * W + xx] += err * w;
      }
    }
  }
  return out;
}

/**
 * Firm up the AI cut-out. The model gives soft, half-sure edges, and anything
 * it is half-sure about (a faded car, white text on black) would dither into
 * faint ghost dots. Here every pixel is either fully kept or fully dropped,
 * the edge is pulled in one dot so no dark background fringe is left, and
 * optionally only the main subject (the biggest piece) is kept.
 */
export function cleanMask(alpha: Float32Array, W: number, H: number, mainOnly: boolean): Float32Array {
  const n = W * H;
  const m = new Uint8Array(n);
  for (let p = 0; p < n; p++) m[p] = alpha[p] >= 0.5 ? 1 : 0;

  // Pull the edge in one dot (removes the dark halo around kept pieces).
  const er = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!m[p]) continue;
    if (x > 0 && !m[p - 1]) continue;
    if (x < W - 1 && !m[p + 1]) continue;
    if (y > 0 && !m[p - W]) continue;
    if (y < H - 1 && !m[p + W]) continue;
    er[p] = 1;
  }

  if (mainOnly) {
    // Label pieces (8-connected), keep the biggest and any piece at least 40% its size.
    const label = new Int32Array(n);
    const sizes: number[] = [0];
    const stack = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (!er[s] || label[s]) continue;
      const id = sizes.length;
      let top = 0, size = 0;
      stack[top++] = s;
      label[s] = id;
      while (top) {
        const p = stack[--top];
        size++;
        const x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (er[q] && !label[q]) { label[q] = id; stack[top++] = q; }
        }
      }
      sizes.push(size);
    }
    const biggest = Math.max(0, ...sizes);
    for (let p = 0; p < n; p++) if (er[p] && sizes[label[p]] < biggest * 0.4) er[p] = 0;
    // Fill holes inside the subject (gaps the model missed) so they don't go blank.
    const outside = new Uint8Array(n);
    let top = 0;
    const push = (q: number) => { if (!er[q] && !outside[q]) { outside[q] = 1; stack[top++] = q; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (top) {
      const p = stack[--top];
      const x = p % W, y = (p / W) | 0;
      if (x > 0) push(p - 1);
      if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W);
      if (y < H - 1) push(p + W);
    }
    // Only small holes are filled; big enclosed gaps (between an arm and the body) stay open.
    const holeLabel = new Int32Array(n);
    const holeSizes: number[] = [0];
    for (let s = 0; s < n; s++) {
      if (er[s] || outside[s] || holeLabel[s]) continue;
      const id = holeSizes.length;
      let t = 0, size = 0;
      stack[t++] = s;
      holeLabel[s] = id;
      while (t) {
        const p = stack[--t];
        size++;
        const x = p % W, y = (p / W) | 0;
        const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
        for (const q of nb) if (q >= 0 && !er[q] && !outside[q] && !holeLabel[q]) { holeLabel[q] = id; stack[t++] = q; }
      }
      holeSizes.push(size);
    }
    const maxHole = n * 0.002;
    for (let p = 0; p < n; p++) if (holeLabel[p] && holeSizes[holeLabel[p]] <= maxHole) er[p] = 1;
  }

  const out = new Float32Array(n);
  for (let p = 0; p < n; p++) out[p] = er[p];
  return out;
}

/**
 * Remove lone burn dots: a dot with no burned neighbour is a pin-prick that
 * burns shallow and sands away unevenly, leaving light areas looking dirty.
 */
function cleanLoneDots(px: Uint8ClampedArray, W: number, H: number) {
  const src = px.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (src[p] !== 0) continue;
    let burnt = 0;
    for (let dy = -1; dy <= 1 && !burnt; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (src[yy * W + xx] === 0) { burnt = 1; break; }
    }
    if (!burnt) px[p] = 255;
  }
}

/**
 * The full photo-engrave pipeline. `rgba` must already be at the engraving's
 * pixel size (see targetSize); its alpha is the subject mask when the
 * background was removed.
 */
export function engravePixels(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number, o: EngraveOptions): Uint8ClampedArray {
  const n = W * H;
  const { gray, alpha: rawAlpha } = toGray(rgba, n);
  const alpha = o.removeBackground ? cleanMask(rawAlpha, W, H, o.mainSubjectOnly ?? true) : rawAlpha;
  const mat = materialById(o.material);

  // 1. Local contrast.
  const v = clahe(gray, alpha, W, H, o.depth / 100);

  // 2. Sharpen (unsharp mask). Radius tracks the dot size so it looks the same at any DPI.
  if (o.detail > 0) {
    const r = Math.max(1, Math.round(o.dpi / 254));
    const blur = boxBlur(v, W, H, r);
    const amount = (o.detail / 100) * 1.6;
    for (let p = 0; p < n; p++) v[p] = v[p] + amount * (v[p] - blur[p]);
  }

  // 3. Brightness, contrast, then flip if the laser makes light marks, then the burn curve.
  const k = o.contrast >= 0 ? 1 + o.contrast / 25 : 1 + o.contrast / 60;
  const b = o.brightness * 2;
  const gamma = mat.gamma;
  for (let p = 0; p < n; p++) {
    let x = (v[p] - 128) * k + 128 + b;
    x = Math.max(0, Math.min(255, x));
    if (o.invert) x = 255 - x;
    x = 255 * Math.pow(x / 255, gamma);
    // 4. Removed background: never burn.
    const a = o.removeBackground ? alpha[p] : 1;
    x = x * a + 255 * (1 - a);
    // Snap near-white / near-black so highlights and shadows don't get stray dots.
    if (x >= 247) x = 255;
    else if (x <= 6) x = 0;
    v[p] = x;
  }

  // 5. Dots.
  if (o.dither === "grayscale") {
    const out = new Uint8ClampedArray(n);
    for (let p = 0; p < n; p++) out[p] = v[p];
    return out;
  }
  const out = dither(v, W, H, o.dither);
  if (o.cleanDots ?? true) cleanLoneDots(out, W, H);
  return out;
}
