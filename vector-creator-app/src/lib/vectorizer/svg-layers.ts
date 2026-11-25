/** Helpers for the layered SVG that Convert produces (one fill colour per laser layer). */

/* ── Layer parsing helpers ── */
export interface LayerInfo {
  color: string;
  pathCount: number;
}

/** Convert rgb(r,g,b) string to #RRGGBB */
export function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return rgb;
  const [, r, g, b] = m;
  return "#" + [r, g, b].map((v) => parseInt(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function parseLayers(svg: string): LayerInfo[] {
  // Match both rgb() and hex fill formats
  const fillRegex = /fill="(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-fA-F]{6})"/g;
  const counts = new Map<string, number>();
  let m;
  while ((m = fillRegex.exec(svg)) !== null) {
    const c = rgbToHex(m[1]).toUpperCase();
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([color, pathCount]) => ({ color, pathCount }))
    .sort((a, b) => b.pathCount - a.pathCount);
}

export function filterSvg(svg: string, hidden: Set<string>): string {
  if (hidden.size === 0) return svg;
  return svg.replace(
    /(<path[^>]*fill=")(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-fA-F]{6})("[^>]*)(\/?>)/gi,
    (full, pre, color, mid, close) =>
      hidden.has(rgbToHex(color).toUpperCase())
        ? `${pre}${color}"${mid} style="opacity:0.06"${close}`
        : full
  );
}

/** Plain-English name for a layer colour. Greys get distinct shades so 5 grey layers don't share a name. */
export function colorName(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  // Greys (and near-greys like warm ink on paper).
  if (max - min < 40) {
    if (brightness < 30) return "Black";
    if (brightness < 90) return "Dark Gray";
    if (brightness < 150) return "Gray";
    if (brightness < 200) return "Light Gray";
    if (brightness < 240) return "Pale Gray";
    return "White";
  }
  // Colours: hue name, with Dark / Light when it's far from mid-brightness.
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const hue =
    h < 15 || h >= 345 ? "Red" : h < 40 ? (brightness < 110 ? "Brown" : "Orange") : h < 70 ? "Yellow" :
    h < 160 ? "Green" : h < 200 ? "Teal" : h < 255 ? "Blue" : h < 290 ? "Purple" : "Pink";
  if (brightness < 70 && hue !== "Brown") return `Dark ${hue}`;
  if (brightness > 190) return `Light ${hue}`;
  return hue;
}

/** Remove hidden layers' paths completely (for export). */
export function stripHiddenLayers(svg: string, hidden: Set<string>): string {
  if (!svg || hidden.size === 0) return svg;
  return svg.replace(
    /<path[^>]*fill="(rgb\([^)]+\)|#[0-9a-fA-F]{6})"[^>]*\/?>(\s*<\/path>)?/gi,
    (full, color) => {
      const hex = color.startsWith("rgb") ? rgbToHex(color).toUpperCase() : color.toUpperCase();
      return hidden.has(hex) ? "" : full;
    }
  );
}
