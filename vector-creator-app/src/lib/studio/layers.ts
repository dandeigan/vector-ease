import type { LayerOperation, StudioLayer } from "./types";

export const DEFAULT_LAYERS: StudioLayer[] = [
  { id: "cut", name: "Cut", color: "#E53935", operation: "cut", visible: true },
  { id: "score", name: "Score", color: "#1E88E5", operation: "score", visible: true },
  { id: "engrave", name: "Engrave", color: "#212121", operation: "engrave", visible: true },
];

export const IMAGE_LAYER: StudioLayer = {
  id: "image",
  name: "Image engrave",
  color: "#8E24AA",
  operation: "image",
  visible: true,
};

export const OPERATION_LABELS: Record<LayerOperation, string> = {
  cut: "Cut",
  score: "Score",
  engrave: "Engrave",
  image: "Image engrave",
};

/** Colours offered for new layers (distinct, laser-software friendly). */
export const LAYER_PALETTE = [
  "#E53935", "#1E88E5", "#212121", "#43A047", "#FB8C00",
  "#8E24AA", "#00ACC1", "#F06292", "#795548", "#FDD835",
];

/** Line width used on screen and in exported files for cut/score lines (mm). */
export const HAIRLINE_MM = 0.1;

/** Pick a layer id for a shape from its colours (used by the SVG importer). */
export function guessLayerFromColors(fill: string | null, stroke: string | null): string {
  if (fill) return "engrave";
  if (stroke) {
    const rgb = parseColor(stroke);
    if (rgb && rgb[2] > 150 && rgb[2] > rgb[0] + 40) return "score"; // blue-ish
    return "cut";
  }
  return "cut";
}

/** Parse "#rgb", "#rrggbb" or "rgb(r, g, b)" into [r, g, b]. */
export function parseColor(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{6})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // fully transparent
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  }
  return null;
}

export function newLayerId(): string {
  return "layer_" + Math.random().toString(36).slice(2, 9);
}
