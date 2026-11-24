import sharp from "sharp";

export type Rgb = { r: number; g: number; b: number };

/**
 * Pick exactly `k` colours that best represent the image (k-means on a
 * downsampled copy, seeded with farthest-point picks so faint ink and paper
 * both get a colour). Deterministic: the same image and k give the same palette.
 */
export async function buildPalette(imageBuffer: Buffer<ArrayBuffer>, k: number): Promise<Rgb[]> {
  const { data } = await sharp(imageBuffer)
    .resize(240, 240, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Bucket colours (5 bits per channel) so k-means runs on a few thousand weighted points.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const bkt = buckets.get(key);
    if (bkt) { bkt.r += data[i]; bkt.g += data[i + 1]; bkt.b += data[i + 2]; bkt.n++; }
    else buckets.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], n: 1 });
  }
  const pts = Array.from(buckets.values()).map((b) => ({ r: b.r / b.n, g: b.g / b.n, b: b.b / b.n, n: b.n }));
  if (!pts.length) return [];
  const dist = (a: Rgb, b: Rgb) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

  // Seed: most common colour, then repeatedly the point farthest from all seeds
  // (weighted lightly by how common it is, so one stray pixel doesn't win).
  const centers: Rgb[] = [pts.reduce((a, b) => (b.n > a.n ? b : a))];
  while (centers.length < Math.min(k, pts.length)) {
    let best = pts[0], bestScore = -1;
    for (const p of pts) {
      const d = Math.min(...centers.map((c) => dist(p, c)));
      const score = d * Math.sqrt(p.n);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (bestScore <= 0) break;
    centers.push({ r: best.r, g: best.g, b: best.b });
  }

  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, ci) => { const d = dist(p, c); if (d < bd) { bd = d; bi = ci; } });
      const s = sums[bi];
      s.r += p.r * p.n; s.g += p.g * p.n; s.b += p.b * p.n; s.n += p.n;
    }
    sums.forEach((s, ci) => { if (s.n) centers[ci] = { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n }; });
  }
  return centers.map((c) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }));
}
