/**
 * Stencil: turn a photo into 2 to 4 bold flat tones (street-art portrait
 * style), ready to vectorize for cutting or engraving.
 *
 *   1. grey, local contrast, then blur so shapes come out bold and smooth
 *   2. split into tones with multi-level Otsu (shifted by the Threshold slider)
 *   3. drop specks smaller than the chosen detail
 *   4. bridges: any piece of sheet that would fall out when the stencil is cut
 *      (the middle of an O, an eye highlight) gets a thin strip connecting it
 *      to the rest of the sheet
 *
 * Output: labels per pixel, 0 = darkest tone ... tones-1 = white paper.
 * Pure functions, so they run in a web worker and in tests.
 */

export interface StencilOptions {
  /** Ink tones plus paper: 2 = one ink, 3 = two inks, 4 = three inks. */
  tones: 2 | 3 | 4;
  /** -50 (lighter, less ink) .. 50 (darker, more ink). */
  threshold: number;
  /** 0 (bold, simple shapes) .. 100 (fine detail). */
  detail: number;
  /** Add bridges so islands don't fall out of a cut stencil. */
  bridges: boolean;
  /** Bridge thickness 1..10 (relative to the image size). */
  bridgeWidth: number;
  removeBackground: boolean;
  smoothness: 0 | 1;
}

export const DEFAULT_STENCIL: StencilOptions = {
  tones: 2,
  threshold: 0,
  detail: 65,
  bridges: true,
  bridgeWidth: 4,
  removeBackground: false,
  smoothness: 1,
};

/** Long side the stencil is worked out at (the server traces it at up to 2x). */
export const STENCIL_SIDE = 1600;

/** Tone colours, darkest first; the last one is paper (white, left out of the file). */
export function stencilPalette(tones: number): { r: number; g: number; b: number }[] {
  const out = [];
  for (let i = 0; i < tones; i++) {
    const v = i === tones - 1 ? 255 : Math.round((i / (tones - 1)) * 200);
    out.push({ r: v, g: v, b: v });
  }
  return out;
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  if (r < 1) return src;
  const a = src.slice();
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let acc = 0;
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

/** Best k-1 thresholds splitting the histogram into k classes (exhaustive multi-Otsu). */
function multiOtsu(hist: Float64Array, k: number): number[] {
  const P = new Float64Array(257), S = new Float64Array(257);
  for (let i = 0; i < 256; i++) { P[i + 1] = P[i] + hist[i]; S[i + 1] = S[i] + i * hist[i]; }
  const between = (a: number, b: number) => { // classes [a, b)
    const w = P[b] - P[a];
    return w > 0 ? ((S[b] - S[a]) ** 2) / w : 0;
  };
  let best = -1, bestT: number[] = [];
  if (k === 2) {
    for (let t = 1; t < 256; t++) { const v = between(0, t) + between(t, 256); if (v > best) { best = v; bestT = [t]; } }
  } else if (k === 3) {
    for (let t1 = 1; t1 < 255; t1++) for (let t2 = t1 + 1; t2 < 256; t2++) {
      const v = between(0, t1) + between(t1, t2) + between(t2, 256);
      if (v > best) { best = v; bestT = [t1, t2]; }
    }
  } else {
    // 4 classes: search on a step of 2 to stay fast, then it's plenty precise.
    for (let t1 = 2; t1 < 252; t1 += 2) for (let t2 = t1 + 2; t2 < 254; t2 += 2) for (let t3 = t2 + 2; t3 < 256; t3 += 2) {
      const v = between(0, t1) + between(t1, t2) + between(t2, t3) + between(t3, 256);
      if (v > best) { best = v; bestT = [t1, t2, t3]; }
    }
  }
  return bestT;
}

/** Merge 4-connected patches smaller than minArea into the label they border most. */
function despeckle(ids: Uint8Array, W: number, H: number, k: number, minArea: number) {
  if (minArea <= 1) return;
  const n = W * H;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const patch: number[] = [];
  const touch = new Int32Array(k);
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const id = ids[start];
    patch.length = 0;
    let top = 0, big = false;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const p = stack[--top];
      if (!big) { patch.push(p); if (patch.length >= minArea) big = true; }
      const x = p % W;
      if (x > 0 && !seen[p - 1] && ids[p - 1] === id) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < W - 1 && !seen[p + 1] && ids[p + 1] === id) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (p >= W && !seen[p - W] && ids[p - W] === id) { seen[p - W] = 1; stack[top++] = p - W; }
      if (p < n - W && !seen[p + W] && ids[p + W] === id) { seen[p + W] = 1; stack[top++] = p + W; }
    }
    if (big) continue;
    touch.fill(0);
    for (const p of patch) {
      const x = p % W;
      if (x > 0 && ids[p - 1] !== id) touch[ids[p - 1]]++;
      if (x < W - 1 && ids[p + 1] !== id) touch[ids[p + 1]]++;
      if (p >= W && ids[p - W] !== id) touch[ids[p - W]]++;
      if (p < n - W && ids[p + W] !== id) touch[ids[p + W]]++;
    }
    let best = -1, bc = 0;
    for (let j = 0; j < k; j++) if (touch[j] > bc) { bc = touch[j]; best = j; }
    if (best >= 0) for (const p of patch) ids[p] = best;
  }
}

/** Paint a thick straight line of `value` into ids, only over pixels of label `over`. */
function paintLine(ids: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, r: number, over: number, value: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + ((x1 - x0) * s) / steps, cy = y0 + ((y1 - y0) * s) / steps;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x;
      if (ids[p] === over) ids[p] = value;
    }
  }
}

/**
 * Bridges for one ink tone. The ink area is what gets cut out; everything
 * else is the sheet. Sheet pieces not touching the edge would fall out, so
 * each one is joined to the edge-connected sheet by the shortest strip.
 * Returns how many bridges were added.
 */
function addBridges(ids: Uint8Array, W: number, H: number, ink: number, radius: number, minIsland: number): number {
  const n = W * H;
  // Label sheet components (8-connected: a corner touch holds in a laser cut sheet only barely, so treat it as joined).
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const compSize: number[] = [];
  const compEdge: boolean[] = [];
  let nc = 0;
  for (let s = 0; s < n; s++) {
    if (ids[s] === ink || comp[s] >= 0) continue;
    let top = 0, size = 0, edge = false;
    stack[top++] = s;
    comp[s] = nc;
    while (top) {
      const p = stack[--top];
      size++;
      const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (ids[q] !== ink && comp[q] < 0) { comp[q] = nc; stack[top++] = q; }
      }
    }
    compSize.push(size);
    compEdge.push(edge);
    nc++;
  }
  const connected = compEdge.slice();
  const islands: number[] = [];
  for (let c = 0; c < nc; c++) if (!connected[c]) islands.push(c);
  if (!islands.length) return 0;

  // Tiny islands are just cut away (they'd be too small to hold a bridge).
  const tiny = new Set(islands.filter((c) => compSize[c] < minIsland));
  if (tiny.size) for (let p = 0; p < n; p++) if (comp[p] >= 0 && tiny.has(comp[p])) { ids[p] = ink; comp[p] = -1; }

  // Biggest islands first: they matter most visually.
  const todo = islands.filter((c) => !tiny.has(c)).sort((a, b) => compSize[b] - compSize[a]);
  const dist = new Int32Array(n);
  const prev = new Int32Array(n);
  const queue = new Int32Array(n);
  let bridges = 0;
  for (const c of todo) {
    if (connected[c]) continue;
    // Breadth-first search out of the island through ink, until we reach connected sheet.
    dist.fill(-1);
    let head = 0, tail = 0;
    for (let p = 0; p < n; p++) if (comp[p] === c) { dist[p] = 0; prev[p] = -1; queue[tail++] = p; }
    let hit = -1;
    while (head < tail && hit < 0) {
      const p = queue[head++];
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1 && hit < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (dist[q] >= 0) continue;
        dist[q] = dist[p] + 1;
        prev[q] = p;
        if (ids[q] !== ink && comp[q] >= 0 && comp[q] !== c && connected[comp[q]]) { hit = q; break; }
        // Pass through ink, and through other loose islands (they get joined on the way).
        queue[tail++] = q;
      }
    }
    if (hit < 0) continue;
    // Walk the path back; draw each stretch that crosses ink as a straight strip.
    const sheetLabel = ids[hit];
    let p = prev[hit], runEnd = -1, runStart = -1;
    const flush = () => {
      if (runEnd < 0) return;
      paintLine(ids, W, H, runStart % W, (runStart / W) | 0, runEnd % W, (runEnd / W) | 0, radius, ink, sheetLabel);
      runEnd = runStart = -1;
    };
    while (p >= 0) {
      if (ids[p] === ink) { if (runEnd < 0) runEnd = p; runStart = p; }
      else {
        flush();
        if (comp[p] >= 0) connected[comp[p]] = true;
      }
      p = prev[p];
    }
    flush();
    connected[c] = true;
    bridges++;
  }
  return bridges;
}

/**
 * The full stencil. `rgba` is the photo at the working size; with the
 * background removed, transparent pixels become paper.
 */
export function makeStencil(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number, o: StencilOptions): { labels: Uint8Array; bridges: number } {
  const n = W * H;
  const gray = new Float32Array(n);
  const fg = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = o.removeBackground ? rgba[i + 3] / 255 : 1;
    gray[p] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
    fg[p] = a > 0.5 ? 1 : 0;
  }

  // Bold shapes: blur more for low detail.
  const long = Math.max(W, H);
  const blurR = Math.round(((100 - o.detail) / 100) * long * 0.006);
  const g = boxBlur(gray, W, H, blurR);

  // Tones from the subject's own histogram.
  const hist = new Float64Array(256);
  for (let p = 0; p < n; p++) if (fg[p]) hist[Math.max(0, Math.min(255, g[p] | 0))]++;
  const shift = o.threshold * 1.6;
  const th = multiOtsu(hist, o.tones).map((t) => t + shift);

  const labels = new Uint8Array(n);
  const paper = o.tones - 1;
  for (let p = 0; p < n; p++) {
    if (!fg[p]) { labels[p] = paper; continue; }
    let l = 0;
    while (l < th.length && g[p] >= th[l]) l++;
    labels[p] = l;
  }

  // Specks: smaller than about 0.3% to 1.5% of the long side across.
  const speck = Math.max(2, Math.round(long * (0.003 + ((100 - o.detail) / 100) * 0.012)));
  despeckle(labels, W, H, o.tones, speck * speck);

  let bridges = 0;
  if (o.bridges) {
    const radius = Math.max(1, Math.round((o.bridgeWidth / 10) * long * 0.006));
    const minIsland = Math.max(9, (radius * 3) ** 2);
    for (let ink = 0; ink < paper; ink++) bridges += addBridges(labels, W, H, ink, radius, minIsland);
  }
  return { labels, bridges };
}
