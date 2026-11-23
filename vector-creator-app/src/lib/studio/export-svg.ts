import { FabricImage, Path, type FabricObject } from "fabric";
import { bakeCommands, multiply, translate } from "./geometry";
import { HAIRLINE_MM } from "./layers";
import type { Matrix, StudioLayer } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layer";

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

export interface SvgExportResult {
  svg: string;
  shapeCount: number;
  hiddenLayerNames: string[];
}

/**
 * Build a laser-ready SVG in millimetres from the Studio's leaf objects.
 * One <g> per layer (Inkscape-style layers, which LightBurn, xTool,
 * Glowforge and Bambu Suite all understand). Cut/score layers are
 * hairline strokes; engrave layers are filled.
 */
export function buildSvg(opts: {
  name: string;
  board: { w: number; h: number };
  layers: StudioLayer[];
  leaves: FabricObject[];
}): SvgExportResult {
  const { name, board, layers, leaves } = opts;
  const byLayer = new Map<string, string[]>();
  let shapeCount = 0;

  for (const leaf of leaves) {
    const layerId = leaf.layerId as string | undefined;
    const layer = layers.find((l) => l.id === layerId) ?? layers[0];
    if (!layer.visible) continue;
    const world = leaf.calcTransformMatrix() as Matrix;
    let el = "";

    if (leaf instanceof Path) {
      const m = multiply(world, translate(-leaf.pathOffset.x, -leaf.pathOffset.y));
      const d = bakeCommands(leaf.path as unknown as (string | number)[][], m);
      if (!d) continue;
      const rule = layer.operation === "engrave" && leaf.fillRule === "evenodd" ? ` fill-rule="evenodd"` : "";
      el = `<path${rule} d="${d}"/>`;
    } else if (leaf instanceof FabricImage) {
      const w = leaf.width, h = leaf.height;
      const m = multiply(world, translate(-w / 2, -h / 2));
      el = `<image width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none" transform="matrix(${m.map(fmt).join(" ")})" href="${esc(leaf.getSrc())}"/>`;
    }
    if (!el) continue;
    shapeCount++;
    const list = byLayer.get(layer.id) ?? [];
    list.push(el);
    byLayer.set(layer.id, list);
  }

  const groups: string[] = [];
  for (const layer of layers) {
    const els = byLayer.get(layer.id);
    if (!els?.length) continue;
    const paint =
      layer.operation === "engrave"
        ? `fill="${layer.color}" stroke="none"`
        : layer.operation === "image"
          ? ``
          : `fill="none" stroke="${layer.color}" stroke-width="${HAIRLINE_MM}"`;
    groups.push(
      `  <g id="${slug(layer.name)}" inkscape:groupmode="layer" inkscape:label="${esc(layer.name)}" ${paint}>\n    ${els.join("\n    ")}\n  </g>`
    );
  }

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${fmt(board.w)}mm" height="${fmt(board.h)}mm" viewBox="0 0 ${fmt(board.w)} ${fmt(board.h)}">`,
    `  <title>${esc(name)}</title>`,
    ...groups,
    `</svg>`,
  ].join("\n");

  return {
    svg,
    shapeCount,
    hiddenLayerNames: layers.filter((l) => !l.visible && leaves.some((o) => o.layerId === l.id)).map((l) => l.name),
  };
}
