import sharp from "sharp";
import type { Rgb } from "./palette";

/**
 * Crisp tracing helpers.
 *
 * 1. Trace bigger: the image is enlarged (smoothly) before it is split into
 *    colours, so every edge lands on a finer pixel grid. Small things like the
 *    dot on an "i" or a thin pen stroke survive, and curves come out smoother.
 * 2. No halos: where a light shape meets a dark one, the photo blends the two
 *    across a pixel or two. Splitting into colours turns that blend into a thin
 *    ring of an in-between layer around every letter and edge. Those ring
 *    pixels are handed back to whichever side they really belong to.
 */

/** Long side we aim to trace at. Small images are enlarged up to 2x to get there. */
const TARGET_LONG_SIDE = 3600;

/** How much to enlarge before tracing (1 to 2). */
export function traceScale(width: number, height: number): number {
  const long = Math.max(width, height);
  return Math.max(1, Math.min(2, TARGET_LONG_SIDE / long));
}

/** Enlarge the image smoothly (no-op at scale 1). */
export async function upscaleForTrace(buf: Buffer, scale: number): Promise<Buffer> {
  if (scale <= 1.01) return buf;
  const meta = await sharp(buf).metadata();
  return sharp(buf)
    .resize(Math.round(meta.width! * scale), Math.round(meta.height! * scale), { kernel: "lanczos3" })
    .png()
    .toBuffer();
}

const d2 = (r: number, g: number, b: number, p: Rgb) => (r - p.r) ** 2 + (g - p.g) ** 2 + (b - p.b) ** 2;

/** Squared distance from colour c to the segment a→b. */
function segDist2(cr: number, cg: number, cb: number, a: Rgb, b: Rgb): number {
  const vr = b.r - a.r, vg = b.g - a.g, vb = b.b - a.b;
  const len = vr * vr + vg * vg + vb * vb;
  let t = len ? ((cr - a.r) * vr + (cg - a.g) * vg + (cb - a.b) * vb) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return (cr - a.r - t * vr) ** 2 + (cg - a.g - t * vg) ** 2 + (cb - a.b - t * vb) ** 2;
}

/**
 * Snap every pixel to its nearest palette colour, then remove the thin
 * in-between rings (see top of file). `radius` is how far (in traced pixels)
 * to look for the two real sides of an edge; use about the enlarge scale.
 * Returns a flat-colour PNG ready for VTracer.
 */
export async function quantizeCrisp(buf: Buffer, palette: Rgb[], radius: number): Promise<Buffer> {
  const { data, info } = await sharp(buf).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const n = W * H;
  const k = palette.length;

  // 1. Nearest colour.
  let labels = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    let best = 0, bd = Infinity;
    for (let j = 0; j < k; j++) {
      const d = d2(data[i], data[i + 1], data[i + 2], palette[j]);
      if (d < bd) { bd = d; best = j; }
    }
    labels[p] = best;
  }

  // Which palette colours sit "between" two others (only those can be a halo).
  // between[l][a*k+b] = true when colour l lies close to the line from a to b.
  const between: boolean[][] = palette.map((pl, l) => {
    const row = new Array(k * k).fill(false);
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
      if (a === l || b === l) continue;
      const ab = d2(palette[a].r, palette[a].g, palette[a].b, palette[b]);
      if (ab < 60 * 60) continue; // a and b too alike to make a visible edge
      if (segDist2(pl.r, pl.g, pl.b, palette[a], palette[b]) < 28 * 28) row[a * k + b] = row[b * k + a] = true;
    }
    return row;
  });
  const canHalo = between.map((row) => row.some(Boolean));
  if (!canHalo.some(Boolean)) return toPng(labels, palette, W, H);

  // 2. Halo removal, twice (the second pass catches pixels the first one exposed).
  const r = Math.max(1, Math.round(radius));
  const seen = new Int32Array(k).fill(-1);
  for (let pass = 0; pass < 2; pass++) {
    const out = labels.slice();
    let stamp = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const l = labels[p];
        if (!canHalo[l]) continue;
        // Quick exit: inside a solid area (all 4 neighbours the same).
        if (x > 0 && x < W - 1 && y > 0 && y < H - 1 &&
            labels[p - 1] === l && labels[p + 1] === l && labels[p - W] === l && labels[p + W] === l) continue;

        // Other colours within the radius.
        stamp++;
        const others: number[] = [];
        for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
            const q = labels[yy * W + xx];
            if (q !== l && seen[q] !== stamp) { seen[q] = stamp; others.push(q); }
          }
        }
        if (others.length < 2) continue;

        // Best pair of real sides this pixel could be a blend of.
        const i = p * 3, cr = data[i], cg = data[i + 1], cb = data[i + 2];
        let bestA = -1, bestB = -1, bestD = 30 * 30;
        for (let s = 0; s < others.length; s++) for (let t = s + 1; t < others.length; t++) {
          const a = others[s], b = others[t];
          if (!between[l][a * k + b]) continue;
          const d = segDist2(cr, cg, cb, palette[a], palette[b]);
          if (d < bestD) { bestD = d; bestA = a; bestB = b; }
        }
        if (bestA < 0) continue;
        out[p] = d2(cr, cg, cb, palette[bestA]) <= d2(cr, cg, cb, palette[bestB]) ? bestA : bestB;
      }
    }
    labels = out;
  }
  return toPng(labels, palette, W, H);
}

function toPng(labels: Uint8Array, palette: Rgb[], W: number, H: number): Promise<Buffer> {
  const px = Buffer.alloc(W * H * 3);
  for (let p = 0; p < labels.length; p++) {
    const c = palette[labels[p]];
    px[p * 3] = c.r; px[p * 3 + 1] = c.g; px[p * 3 + 2] = c.b;
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}
