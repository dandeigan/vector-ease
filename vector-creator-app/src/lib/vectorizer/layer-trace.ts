import sharp from "sharp";
import { vectorize, type Config } from "@neplex/vectorizer";

/**
 * Trace a flat-colour image one laser layer at a time.
 *
 * VTracer's colour "cutout" mode quietly drops small shapes that sit inside a
 * different colour (the dot on an "i", a full stop, a thin highlight) and can
 * fill letter holes with the wrong colour. Tracing each colour on its own as a
 * black-and-white mask keeps every shape, keeps holes as real holes, and gives
 * exactly one set of non-overlapping shapes per laser layer.
 */
export interface LayerTraceOptions {
  /** Colours to leave out entirely (e.g. the paper in line art). Hex, no #. */
  skip?: string[];
  /** Drop specks smaller than this many pixels across (VTracer filterSpeckle). */
  speckle: number;
  /** 0 = angular, else curved. */
  smoothness: number;
  /** VTracer lengthThreshold. */
  lengthThreshold: number;
  /**
   * How much the image was enlarged before tracing. Coordinates are divided
   * by this, so the SVG comes back at the original image size (exports use
   * the viewBox for physical size).
   */
  scale: number;
}

const BINARY = 1;
const STACKED = 0;
const POLYGON = 1;
const SPLINE = 2;

const hex = (r: number, g: number, b: number) =>
  [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/**
 * Merge every patch smaller than `minArea` pixels into the colour it touches
 * most, so no layer is left with a pin-hole where a speck used to be.
 * `ids` is updated in place.
 */
function despeckle(ids: Int32Array, W: number, H: number, k: number, minArea: number) {
  if (minArea <= 1) return;
  const n = W * H;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const patch: number[] = [];
  const touch = new Int32Array(k);
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const id = ids[start];
    // Flood-fill this patch (4-connected), stopping early once it's big enough.
    patch.length = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let big = false;
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
    // Small patch: hand it to the neighbouring colour it borders most.
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

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);
/** Path coordinates: 0.1 original pixel (about 0.03 mm at 96 dpi) is plenty for a laser and keeps files small. */
const r1 = (v: number) => String(Math.round(v * 10) / 10);

/**
 * Bake VTracer's per-path translate() and the enlarge scale into the path
 * data, so every exporter (DXF ignores transforms) gets plain absolute
 * coordinates. VTracer only writes absolute M, L, C and Z, so every number is
 * part of an x,y pair.
 */
function bakePath(tag: string, scale: number): string {
  const t = tag.match(/transform="translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)"/i);
  const tx = t ? Number(t[1]) : 0, ty = t ? Number(t[2]) : 0;
  return tag
    .replace(/\s*transform="[^"]*"/, "")
    .replace(/\bd="([^"]*)"/, (_m, d: string) => {
      let i = 0;
      return `d="${d.replace(NUM, (n) => r1((Number(n) + (i++ % 2 === 0 ? tx : ty)) / scale))}"`;
    });
}

/** Returns an SVG with a viewBox of the original image size, one fill colour per layer. */
export async function traceByLayer(png: Buffer, opts: LayerTraceOptions): Promise<string> {
  const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const n = W * H;
  const skip = new Set((opts.skip ?? []).map((s) => s.toUpperCase()));

  // Find the colours and how many pixels each has.
  const ids = new Int32Array(n);
  const colours: string[] = [];
  const counts: number[] = [];
  const index = new Map<number, number>();
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let id = index.get(key);
    if (id === undefined) {
      id = colours.length;
      index.set(key, id);
      colours.push(hex(data[i], data[i + 1], data[i + 2]));
      counts.push(0);
    }
    ids[p] = id;
    counts[id]++;
  }
  if (colours.length > 64) throw new Error("traceByLayer expects a flat-colour image");

  // Specks are removed here, on the pixels, and not by VTracer: a speck dropped
  // from its own layer would otherwise leave a hole in the layer around it.
  despeckle(ids, W, H, colours.length, opts.speckle * opts.speckle);

  const config: Config = {
    colorMode: BINARY,
    hierarchical: STACKED,
    filterSpeckle: 0,
    colorPrecision: 6,
    layerDifference: 16,
    mode: opts.smoothness === 0 ? POLYGON : SPLINE,
    cornerThreshold: 60,
    lengthThreshold: opts.lengthThreshold,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 3,
  };

  // Biggest layer first so it sits at the bottom of the preview.
  const order = colours.map((_, id) => id).filter((id) => !skip.has(colours[id])).sort((a, b) => counts[b] - counts[a]);
  const mask = Buffer.alloc(n);
  const parts: string[] = [];
  for (const id of order) {
    for (let p = 0; p < n; p++) mask[p] = ids[p] === id ? 0 : 255;
    const maskPng = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
    const svg = await vectorize(maskPng as Buffer<ArrayBuffer>, config);
    const paths = svg.match(/<path\b[^>]*\/>/g) ?? [];
    for (const path of paths) parts.push(bakePath(path, opts.scale).replace(/fill="#[0-9a-fA-F]{6}"/, `fill="#${colours[id]}"`));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(W / opts.scale)} ${r3(H / opts.scale)}" width="100%" height="100%">\n${parts.join("\n")}\n</svg>`;
}
