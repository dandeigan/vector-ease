/**
 * Photo engrave as GRBL G-code, for lasers driven by G-code senders
 * (Falcon Design Space "Run G-code", LaserGRBL, UGS…).
 *
 * Format copied from a real Falcon Design Space 1.10.8 file for a Falcon2 22W:
 * - $H (home) first, then absolute coordinates measured from the home corner.
 * - M4 (dynamic power), S on a 0–1000 scale (35% = S350).
 * - Bi-directional fill rows, laser off (S0) on the overscan ends.
 * - Ends with M5, a return to X0 Y0 and M2.
 * Falcon's own files are in inches (G20); this one is in mm (G21), which GRBL
 * accepts the same way.
 *
 * Pixels: 0 = full burn, 255 = no burn (VectorEase's photo output).
 */

export interface PhotoGcodeOptions {
  pixels: ArrayLike<number>;
  w: number;
  h: number;
  dpi: number;
  speedMmMin: number;
  powerPct: number;
  /** Grayscale dot style: power follows the shade instead of on/off dots. */
  grayscale?: boolean;
  /** Lower-left corner of the photo, in mm from the laser's home corner. */
  originX?: number;
  originY?: number;
  /** mm to shift the right-to-left rows, to line them up with the left-to-right ones. */
  scanOffset?: number;
  /** Extra header lines a machine's own software sends (Falcon: "$101=80"). */
  preamble?: string[];
  label?: string;
}

const f = (n: number) => String(Math.round(n * 1000) / 1000);

export function photoToGcode(o: PhotoGcodeOptions): string {
  const pitch = 25.4 / o.dpi;
  const sMax = Math.round(Math.max(0, Math.min(100, o.powerPct)) * 10);
  const ox = o.originX ?? 0;
  const oy = o.originY ?? 0;
  const offset = o.scanOffset ?? 0;
  const widthMm = o.w * pitch;
  const heightMm = o.h * pitch;
  const overscan = Math.max(2, widthMm * 0.025);

  // Power for one pixel, on the 0–1000 scale.
  const sOf = (p: number) => {
    if (o.grayscale) return Math.round(((255 - p) / 255) * sMax);
    return p < 128 ? sMax : 0;
  };

  const out: string[] = [
    "$H",
    ...(o.preamble ?? []),
    `; VectorEase photo engrave${o.label ? `: ${o.label}` : ""}`,
    "; GRBL, absolute coords from the home corner, mm",
    `; Bounds: X${f(ox)} Y${f(oy)} to X${f(ox + widthMm)} Y${f(oy + heightMm)}`,
    `; ${f(o.speedMmMin)} mm/min, ${Math.round(sMax / 10)}% power, ${f(pitch)} mm line interval`,
    "G00 G17 G40 G21 G54",
    "G90",
    "M4",
    "M9",
  ];

  let first = true;
  let lastS = -1;
  let forward = true;
  for (let row = 0; row < o.h; row++) {
    const base = row * o.w;
    // Runs of equal power across the row.
    const runs: { a: number; b: number; s: number }[] = [];
    for (let x = 0; x < o.w; ) {
      const s = sOf(o.pixels[base + x]);
      let e = x + 1;
      while (e < o.w && sOf(o.pixels[base + e]) === s) e++;
      if (s > 0) runs.push({ a: x, b: e, s });
      x = e;
    }
    if (runs.length === 0) continue;

    // Image row 0 is the top of the photo: highest Y (GRBL is Y-up).
    const y = oy + (o.h - 1 - row) * pitch + pitch / 2;
    const shift = forward ? 0 : offset;
    const X = (px: number) => ox + px * pitch + shift;
    const startPx = runs[0].a, endPx = runs[runs.length - 1].b;
    const lead = forward ? X(startPx) - overscan : X(endPx) + overscan;
    const tail = forward ? X(endPx) + overscan : X(startPx) - overscan;

    const move = (x: number, s: number) => {
      const sPart = s !== lastS ? `S${s}` : "";
      out.push(`G1X${f(x)}${sPart}${first ? `F${f(o.speedMmMin)}` : ""}`);
      first = false;
      lastS = s;
    };

    // Travel to the start of the row with the laser off.
    out.push(`G0X${f(lead)}Y${f(y)}`);
    lastS = -1;
    if (forward) {
      let at = startPx;
      move(X(startPx), 0);
      for (const r of runs) {
        if (r.a > at) move(X(r.a), 0);
        move(X(r.b), r.s);
        at = r.b;
      }
    } else {
      let at = endPx;
      move(X(endPx), 0);
      for (let i = runs.length - 1; i >= 0; i--) {
        const r = runs[i];
        if (r.b < at) move(X(r.b), 0);
        move(X(r.a), r.s);
        at = r.a;
      }
    }
    move(tail, 0);
    forward = !forward;
  }

  out.push("G1 S0", "M5", "; return to starting pos", "G0 X0Y0", "M2", "");
  return out.join("\n");
}
