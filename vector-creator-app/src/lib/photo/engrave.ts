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
  /** Black areas of the photo (poster backgrounds) burn solid, no stray dots. Default on. */
  solidBlacks?: boolean;
  /** Black poster background stays bare and white lettering burns dark; the photo is unchanged. Default off. */
  invertBackground?: boolean;
  /** Burn sharp text and logos solid instead of as dots. */
  crispGraphics?: boolean;
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
  solidBlacks: true,
  invertBackground: false,
  crispGraphics: false,
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
 * it is half-sure about would dither into faint ghost dots. Here every pixel
 * is either fully kept or fully dropped, and the edge is pulled in one dot so
 * no dark background fringe is left.
 *
 * Each kept piece is then sorted:
 *   - the main subject (the biggest piece) engraves normally
 *   - other objects (a car) engrave normally, unless "main subject only"
 *   - white pieces (text, a signature, a logo printed white on a dark
 *     background) would vanish on bare wood, so they are flagged to burn
 *     dark instead ("flip"), unless "main subject only"
 */
export function cleanMask(alpha: Float32Array, gray: Float32Array, W: number, H: number, mainOnly: boolean): { alpha: Float32Array; flip: Uint8Array } {
  const n = W * H;
  // Sure pixels (>= 50%) seed the cut; it then grows into half-sure pixels
  // (>= 20%) that touch it, so a shoulder the model is unsure of stays whole
  // instead of breaking into blotches.
  const grown = new Uint8Array(n);
  {
    const st = new Int32Array(n);
    let t = 0;
    for (let p = 0; p < n; p++) if (alpha[p] >= 0.5) { grown[p] = 1; st[t++] = p; }
    while (t) {
      const p = st[--t];
      const x = p % W, y = (p / W) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && !grown[q] && alpha[q] >= 0.2) { grown[q] = 1; st[t++] = q; }
    }
  }
  const m = grown;

  // Label pieces (8-connected) and measure how light each one is.
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  const sizes: number[] = [0];
  const lightShare: number[] = [0];
  for (let s = 0; s < n; s++) {
    if (!m[s] || label[s]) continue;
    const id = sizes.length;
    let top = 0, size = 0, light = 0;
    stack[top++] = s;
    label[s] = id;
    while (top) {
      const p = stack[--top];
      size++;
      if (gray[p] > 170) light++;
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (m[q] && !label[q]) { label[q] = id; stack[top++] = q; }
      }
    }
    sizes.push(size);
    lightShare.push(light / size);
  }
  let biggestId = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[biggestId]) biggestId = i;
  const biggest = sizes[biggestId] || 0;

  // What happens to each piece: 0 drop, 1 engrave, 2 burn dark (white text / logo).
  const fate = new Uint8Array(sizes.length);
  for (let i = 1; i < sizes.length; i++) {
    if (i === biggestId || sizes[i] >= biggest * 0.4) fate[i] = 1;
    else if (mainOnly) fate[i] = 0;
    else if (lightShare[i] > 0.6) fate[i] = sizes[i] >= 8 ? 2 : 0;
    else fate[i] = sizes[i] >= n * 0.001 ? 1 : 0; // dark crumbs are dropped
  }

  const keep = new Uint8Array(n);
  const flip = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const f = fate[label[p]];
    if (f === 1) keep[p] = 1;
    else if (f === 2) flip[p] = 1;
  }

  // White text and logos printed on a black background, found from the photo
  // itself. The AI cut often fades out over a thin letter ("I") or misses the
  // dot of an "i"; any light shape fully ringed by black is burned dark too.
  if (!mainOnly) {
    const seen = new Uint8Array(n);
    const comp: number[] = [];
    for (let s = 0; s < n; s++) {
      if (seen[s] || keep[s] || gray[s] <= 128) continue;
      comp.length = 0;
      let t = 0, edge = 0, darkEdge = 0, touchesKeep = false;
      stack[t++] = s; seen[s] = 1;
      while (t) {
        const p = stack[--t];
        comp.push(p);
        const x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) { edge++; continue; }
          const q = yy * W + xx;
          if (keep[q]) touchesKeep = true;
          if (gray[q] > 128) { if (!seen[q] && !keep[q]) { seen[q] = 1; stack[t++] = q; } }
          else { edge++; if (gray[q] <= 110) darkEdge++; }
        }
      }
      if (touchesKeep || comp.length < 3 || comp.length > n * 0.02) continue;
      // The letter's soft edge: ring of mid-grey pixels next to it.
      if (darkEdge < edge * 0.6) continue;
      for (const p of comp) {
        flip[p] = 1;
        const x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (!keep[q] && gray[q] > 40) flip[q] = 1;
        }
      }
    }
  }

  // Pull the edge of engraved pieces in one dot (removes the dark halo).
  const er = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!keep[p]) continue;
    if (x > 0 && !keep[p - 1]) continue;
    if (x < W - 1 && !keep[p + 1]) continue;
    if (y > 0 && !keep[p - W]) continue;
    if (y < H - 1 && !keep[p + W]) continue;
    er[p] = 1;
  }

  // Fill small holes inside engraved pieces (gaps the model missed) so they don't go blank.
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
  // Only for the main subject on its own: elsewhere a "hole" may be the inside of a signature loop.
  if (mainOnly) for (let p = 0; p < n; p++) if (holeLabel[p] && holeSizes[holeLabel[p]] <= maxHole) er[p] = 1;

  const out = new Float32Array(n);
  for (let p = 0; p < n; p++) out[p] = er[p];
  return { alpha: out, flip };
}

/**
 * Find text and logos: dark-on-light or light-on-dark shapes with hard edges
 * (printed letters, a signature, sponsor logos). Those are better burned solid
 * or left bare than shaded with dots, which makes their edges fuzzy and lets
 * light specks show inside dark letters. Photo tones (skin, fabric, shadows)
 * change gradually, so they are left to the dither.
 *
 * Returns, per pixel: 0 = photo, 1 = graphic to burn solid, 2 = graphic to leave bare.
 */
export function findGraphics(gray: Float32Array, W: number, H: number, dpi: number): Uint8Array {
  const n = W * H;
  const r = Math.max(2, Math.round((dpi / 254) * 3));
  // Local min and max (separable sliding window).
  const rowMin = new Float32Array(n), rowMax = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let lo = 255, hi = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) { const g = gray[row + xx]; if (g < lo) lo = g; if (g > hi) hi = g; }
      rowMin[row + x] = lo;
      rowMax[row + x] = hi;
    }
  }
  const mean = boxBlur(gray, W, H, r);
  const out = new Uint8Array(n);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let lo = 255, hi = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) { const p = yy * W + x; if (rowMin[p] < lo) lo = rowMin[p]; if (rowMax[p] > hi) hi = rowMax[p]; }
      const p = y * W + x;
      // A hard edge nearby: near-black and near-white within a few dots.
      if (lo > 70 || hi < 185 || hi - lo < 150) continue;
      // Dark letters on a light ground (a logo on a helmet) often have grey
      // glare on them: split high, so the glare still burns and the letters
      // read solid. Light letters on a dark ground split near the middle, so
      // they keep their full width.
      const split = mean[p] > lo + (hi - lo) * 0.5 ? 0.8 : 0.5;
      out[p] = gray[p] < lo + (hi - lo) * split ? 1 : 2;
    }
  }
  return out;
}

/** Burn text and logos solid / leave them bare (see findGraphics). */
function applyGraphics(out: Uint8ClampedArray, gray: Float32Array, alpha: Float32Array, W: number, H: number, o: EngraveOptions, flip?: Uint8Array) {
  const g = findGraphics(gray, W, H, o.dpi);
  for (let p = 0; p < W * H; p++) {
    if (!g[p] || (flip && flip[p])) continue;
    if (o.removeBackground && alpha[p] < 0.5) continue;
    // 1 = dark in the photo. Dark burns, unless the material is flipped.
    const burn = (g[p] === 1) !== o.invert;
    out[p] = burn ? 0 : 255;
  }
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
/**
 * For "Invert background": find the black poster background and the white
 * lettering on it, straight from the photo. Background = near-black pixels in
 * a mostly-black area. Lettering = light shapes ringed by that background,
 * plus their soft grey rim. Everything else (the photo) is left alone.
 */
function findPoster(gray: Float32Array, flatBlack: Float32Array, W: number, H: number): Uint8Array {
  const n = W * H;
  const out = new Uint8Array(n);
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (gray[p] <= 10 && flatBlack[p] >= 0.6) cand[p] = 1;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || gray[s] <= 128) continue;
    comp.length = 0;
    let t = 0, edge = 0, bgEdge = 0;
    stack[t++] = s; seen[s] = 1;
    while (t) {
      const p = stack[--t];
      comp.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { edge++; continue; }
        const q = yy * W + xx;
        if (gray[q] > 128) { if (!seen[q]) { seen[q] = 1; stack[t++] = q; } }
        else { edge++; if (gray[q] <= 110 && flatBlack[q] >= 0.3) bgEdge++; }
      }
    }
    if (comp.length < 3 || comp.length > n * 0.02 || bgEdge < edge * 0.6) continue;
    for (const p of comp) {
      out[p] = 2;
      const x = p % W, y = (p / W) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (out[q] !== 2 && gray[q] > 30 && gray[q] <= 128) out[q] = 2;
      }
    }
  }
  // Black right next to lettering (between letters, inside an "o") counts too,
  // even though the letters make that spot less than mostly-black.
  const isText = new Float32Array(n);
  for (let p = 0; p < n; p++) if (out[p] === 2) isText[p] = 1;
  const nearText = boxBlur(isText, W, H, Math.max(3, Math.round(Math.min(W, H) / 100)));
  for (let p = 0; p < n; p++) if (gray[p] <= 30 && nearText[p] > 0.01) cand[p] = 1; // letter rims are cleaner, a bit looser is fine
  // Background pieces: black areas that reach the edge of the picture, or that
  // sit inside lettering (the hole of an "o", a signature loop). Black areas
  // enclosed by the photo itself (a helmet visor, a dark car part) stay burned.
  const lab = new Int32Array(n);
  let id = 0;
  const pix: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!cand[s] || lab[s] || out[s] === 2) continue;
    id++;
    pix.length = 0;
    let t = 0, border = false, rim = 0, rimText = 0;
    stack[t++] = s; lab[s] = id;
    while (t) {
      const p = stack[--t];
      pix.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (cand[q] && out[q] !== 2) { if (!lab[q]) { lab[q] = id; stack[t++] = q; } }
        else { rim++; if (out[q] === 2) rimText++; }
      }
    }
    const keep = (border && pix.length >= n * 0.002) || (rim > 0 && rimText >= rim * 0.7);
    if (keep) for (const p of pix) out[p] = 1;
  }
  // Clean silhouette: the photo's edge carries a dark rim where it blended into
  // the black background, which would burn as a heavy outline around the
  // person. Let the background eat a few dots into that rim (only very dark
  // pixels), then smooth the edge so it isn't stair-stepped.
  const depth = Math.max(2, Math.round(Math.min(W, H) / 200));
  let front: number[] = [];
  for (let p = 0; p < n; p++) if (out[p] === 1) front.push(p);
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (const p of front) {
      const x = p % W, y = (p / W) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && out[q] === 0 && gray[q] <= 20) { out[q] = 1; next.push(q); }
    }
    front = next;
  }
  // Right around the lettering everything is either letter or background: no
  // in-between pixels left to dither into specks or nibbled edges.
  // Decided on a lightly smoothed copy so JPEG ripples don't nibble the edges.
  const tight = boxBlur(isText, W, H, 2);
  const g3 = boxBlur(gray, W, H, 1);
  for (let p = 0; p < n; p++) if (tight[p] > 0.01) out[p] = g3[p] >= 110 ? 2 : 1;
  const bg = new Float32Array(n);
  for (let p = 0; p < n; p++) if (out[p] === 1) bg[p] = 1;
  const sm = boxBlur(bg, W, H, 1);
  for (let p = 0; p < n; p++) {
    if (out[p] === 2) continue;
    if (out[p] === 1 && sm[p] < 0.5) out[p] = 0;
    else if (out[p] === 0 && sm[p] >= 0.5 && gray[p] <= 20) out[p] = 1;
  }
  return out;
}

/**
 * Lettering printed on a black poster background: the soft grey rim of each
 * letter would dither into ragged speckle. Where a small window holds only
 * black and white (few in-between greys) and sits beside a large black area,
 * the letter edge is cut clean at half-grey instead of dithered. Faces and
 * hair have plenty of in-between greys, so they never qualify.
 */
function crispPosterText(out: Uint8ClampedArray, gray: Float32Array, alpha: Float32Array, flatBlack: Float32Array, flip: Uint8Array | null, W: number, H: number, o: EngraveOptions, poster: Uint8Array | null = null) {
  const n = W * H;
  const lo = new Float32Array(n), hi = new Float32Array(n);
  for (let p = 0; p < n; p++) { if (gray[p] <= 40) lo[p] = 1; else if (gray[p] >= 200) hi[p] = 1; }
  const r = Math.max(2, Math.round((o.dpi / 254) * 3));
  const loS = boxBlur(lo, W, H, r), hiS = boxBlur(hi, W, H, r);
  for (let p = 0; p < n; p++) {
    if (flatBlack[p] < 0.3 || loS[p] < 0.05 || hiS[p] < 0.05 || 1 - loS[p] - hiS[p] > 0.3) continue;
    const light = gray[p] >= 128;
    if (flip && flip[p]) { out[p] = light ? 0 : 255; continue; }
    if (alpha[p] < 1) continue;
    if (poster && poster[p]) { out[p] = (poster[p] === 2) !== o.invert ? 0 : 255; continue; }
    out[p] = light !== o.invert ? 255 : 0;
  }
}

export function engravePixels(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number, o: EngraveOptions, touch?: Uint8ClampedArray | null): Uint8ClampedArray {
  const n = W * H;
  const { gray, alpha: rawAlpha } = toGray(rgba, n);
  const cut = o.removeBackground ? cleanMask(rawAlpha, gray, W, H, o.mainSubjectOnly ?? true) : null;
  const alpha = cut ? cut.alpha : rawAlpha;
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
  // Big solid-black areas of the photo (poster backgrounds): share of nearby
  // pixels that are black. Black pixels in a mostly-black area burn solid;
  // shadows inside a face or car are too broken up to qualify.
  let flatBlack: Float32Array | null = null;
  const invBg = !!o.invertBackground && !cut;
  if ((o.solidBlacks ?? true) || invBg) {
    const isBlack = new Float32Array(n);
    let any = false;
    for (let p = 0; p < n; p++) if (gray[p] <= 10 && alpha[p] >= 1) { isBlack[p] = 1; any = true; }
    if (any) flatBlack = boxBlur(isBlack, W, H, Math.max(4, Math.round((o.dpi / 254) * 10)));
  }
  // Invert background: 1 = poster background (left bare), 2 = lettering (burned dark).
  const poster = invBg && flatBlack ? findPoster(gray, flatBlack, W, H) : null;
  // Where the photo meets the now-bare background, fade it out over a few dots
  // (like a vignette) so hair and shoulders don't end in a hard, cut-out line.
  let fade: Float32Array | null = null;
  if (poster) {
    const bgm = new Float32Array(n);
    for (let p = 0; p < n; p++) if (poster[p] === 1) bgm[p] = 1;
    fade = boxBlur(bgm, W, H, Math.max(2, Math.round((o.dpi / 254) * 3)));
  }
  for (let p = 0; p < n; p++) {
    let x = (v[p] - 128) * k + 128 + b;
    x = Math.max(0, Math.min(255, x));
    if (o.invert) x = 255 - x;
    x = 255 * Math.pow(x / 255, gamma);
    // 4. Removed background: never burn.
    const a = o.removeBackground ? alpha[p] : 1;
    x = x * a + 255 * (1 - a);
    // White text / logos with the background gone: burn them dark, straight
    // from the photo (crisp letters, no local-contrast or sharpening halos).
    // Same on every material: the letters get the laser mark, the rest stays bare.
    if (cut && cut.flip[p]) x = gray[p] >= 247 ? 0 : gray[p] <= 8 ? 255 : 255 - gray[p];
    else if (poster && poster[p] === 1) x = o.invert ? 0 : 255;
    else if (poster && poster[p] === 2) x = o.invert ? 255 : 0;
    else if (fade && fade[p] > 0) { const bare = o.invert ? 0 : 255; x = x + (bare - x) * Math.min(1, fade[p] * 1.5); }
    // Areas that are black in the photo itself stay solid. Without this, local
    // contrast blows up tiny JPEG noise in a black poster background into a
    // scatter of stray dots that stops where the noise stops.
    else if (flatBlack && gray[p] <= 10 && flatBlack[p] >= 0.6) x = o.invert ? 255 : 0;
    // Snap near-white / near-black so highlights and shadows don't get stray dots.
    if (x >= 247) x = 255;
    else if (x <= 6) x = 0;
    v[p] = x;
  }

  const hasTouch = !!touch && touch.length === n * 3 && touch.some((t) => t > 0);
  // Touch-ups: a copy of the tones with the brushed spots darkened / lightened.
  const vt = hasTouch ? v.slice() : null;
  if (vt && touch) {
    for (let p = 0; p < n; p++) {
      const d = touch[p] / 255, l = touch[n + p] / 255;
      if (!d && !l) continue;
      // A curve, like a photo editor's: Darken deepens the mid-tones but keeps
      // highlights (eye glints) bright; Lighten lifts the mid-tones but keeps
      // the darkest darks (pupils, lashes, brows) dark. Flat areas barely move.
      let x = Math.max(0, Math.min(255, vt[p])) / 255;
      if (d) x = Math.pow(x, 1 + 0.8 * d);
      if (l) x = Math.pow(x, 1 / (1 + 0.8 * l));
      vt[p] = x * 255;
    }
  }

  // 5. Dots.
  const finish = (tones: Float32Array) => {
    let out: Uint8ClampedArray;
    if (o.dither === "grayscale") {
      out = new Uint8ClampedArray(n);
      for (let p = 0; p < n; p++) out[p] = tones[p];
    } else {
      out = dither(tones.slice(), W, H, o.dither);
      if (o.cleanDots ?? true) cleanLoneDots(out, W, H);
    }
    if (o.crispGraphics ?? false) applyGraphics(out, gray, alpha, W, H, o, cut?.flip);
    if (flatBlack) crispPosterText(out, gray, alpha, flatBlack, cut?.flip ?? null, W, H, o, poster);
    return out;
  };
  const out = finish(v);
  if (!vt || !touch) return out;

  // The touched version is used ONLY where the user painted, so the rest of
  // the engraving stays dot-for-dot identical (dither ripples can't leak out).
  const touched = finish(vt);
  for (let p = 0; p < n; p++) if (touch[p] || touch[n + p] || touch[2 * n + p]) out[p] = touched[p];
  sharpenLogos(out, gray, alpha, W, H, o, touch.subarray(2 * n));
  return out;
}

/**
 * The "Sharpen logo" brush: inside the painted spot, every dot is decided by
 * comparing it with its immediate surroundings, so lettering and logos burn
 * solid with clean edges, and grey glare on dark letters still burns. Flat
 * areas inside the spot (plain suit, plain helmet) keep their normal dots.
 */
function sharpenLogos(out: Uint8ClampedArray, gray: Float32Array, alpha: Float32Array, W: number, H: number, o: EngraveOptions, mask: Uint8ClampedArray) {
  const r = Math.max(3, Math.round((o.dpi / 254) * 4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (mask[p] < 80) continue;
    if (o.removeBackground && alpha[p] < 0.5) continue;
    let sum = 0, cnt = 0, lo = 255, hi = 0;
    const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r), y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const g = gray[yy * W + xx];
      sum += g; cnt++;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    if (hi - lo < 40) continue; // flat: keep the normal dots
    const dark = gray[p] < sum / cnt - 4;
    out[p] = dark !== o.invert ? 0 : 255;
  }
}
