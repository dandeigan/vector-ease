/**
 * Vector exports: find a "background" layer, the lightest colour when it is
 * one big light shape filling in behind everything (a sky, paper, a cream
 * card). On a laser every layer burns, so that layer would darken the whole
 * board. The export asks the user whether to keep it.
 */
import { rgbToHex, type LayerInfo } from "./svg-layers";

export interface BackgroundLayer {
  color: string;
  /** Share of the design's area this layer's shapes cover, 0..1. */
  coverage: number;
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

/** Pure check: which layer could be the background (lightest, and light). */
export function backgroundCandidate(layers: LayerInfo[]): string | null {
  if (layers.length < 2) return null;
  const lightest = [...layers].sort((a, b) => lum(b.color) - lum(a.color))[0];
  return lum(lightest.color) >= 170 ? lightest.color : null;
}

/** Only this colour's shapes, drawn black; everything else unfilled. */
export function isolateLayer(svg: string, color: string): string {
  return svg.replace(/fill="(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-fA-F]{6})"/g, (_full, c: string) =>
    rgbToHex(c).toUpperCase() === color ? 'fill="#000000"' : 'fill="none"');
}

/**
 * Browser only: measure how much of the design the candidate layer covers by
 * drawing it small. Returns null when there is no background-like layer
 * (covers under 40%).
 */
export async function findBackgroundLayer(svg: string, layers: LayerInfo[]): Promise<BackgroundLayer | null> {
  const color = backgroundCandidate(layers);
  if (!color) return null;
  const vb = svg.match(/viewBox="([\d.\s-]+)"/)?.[1].trim().split(/\s+/).map(Number);
  const aspect = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] / vb[2] : 1;
  const W = 200, H = Math.max(1, Math.round(200 * aspect));
  const only = isolateLayer(svg, color)
    .replace(/(<svg[^>]*?)\swidth="[^"]*"/, `$1 width="${W}"`)
    .replace(/(<svg[^>]*?)\sheight="[^"]*"/, `$1 height="${H}"`);
  const url = URL.createObjectURL(new Blob([only], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read the design"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    let on = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 127) on++;
    const coverage = on / (W * H);
    return coverage >= 0.4 ? { color, coverage } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
