import { NextRequest, NextResponse } from "next/server";
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode, type Config } from "@neplex/vectorizer";

/**
 * Parse hex color from SVG fill attribute
 */
function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

/**
 * Merge SVG colors down to targetCount using k-means-like clustering.
 * Replaces fill colors in the SVG string so similar colors become one layer.
 */
function mergeColorsToTarget(svg: string, targetCount: number, seedPalette?: { r: number; g: number; b: number }[]): string {
  // Extract all unique fill colors
  const fillRegex = /fill="(#[0-9a-fA-F]{6})"/g;
  const colorCounts = new Map<string, number>();
  let match;
  while ((match = fillRegex.exec(svg)) !== null) {
    const c = match[1].toUpperCase();
    colorCounts.set(c, (colorCounts.get(c) || 0) + 1);
  }

  const uniqueColors = Array.from(colorCounts.entries())
    .map(([hex, count]) => ({ hex, rgb: hexToRgb(hex), count }))
    .sort((a, b) => b.count - a.count);

  if (uniqueColors.length <= targetCount) return svg;

  // Initialize clusters — use detected palette if available, otherwise most frequent
  let clusters;
  if (seedPalette && seedPalette.length >= targetCount) {
    clusters = seedPalette.slice(0, targetCount).map(c => ({
      center: [c.r, c.g, c.b] as [number, number, number],
      hex: rgbToHex(c.r, c.g, c.b),
      members: [] as typeof uniqueColors,
    }));
  } else {
    clusters = uniqueColors.slice(0, targetCount).map(c => ({
      center: [...c.rgb] as [number, number, number],
      hex: c.hex,
      members: [] as typeof uniqueColors,
    }));
  }

  // Assign each color to nearest cluster
  for (const color of uniqueColors) {
    let minDist = Infinity;
    let bestCluster = clusters[0];
    for (const cluster of clusters) {
      const dist = colorDistance(color.rgb, cluster.center);
      if (dist < minDist) {
        minDist = dist;
        bestCluster = cluster;
      }
    }
    bestCluster.members.push(color);
  }

  // Use the most frequent color in each cluster as representative
  // (averaging muddles vivid colors — keeping the dominant one preserves accuracy)
  for (const cluster of clusters) {
    if (cluster.members.length === 0) continue;
    const dominant = cluster.members.reduce((best, m) => m.count > best.count ? m : best);
    cluster.center = dominant.rgb;
    cluster.hex = dominant.hex;
  }

  // Build replacement map: original color -> cluster color
  const replacements = new Map<string, string>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      if (member.hex !== cluster.hex) {
        replacements.set(member.hex, cluster.hex);
      }
    }
  }

  // Replace colors in SVG
  let result = svg;
  for (const [from, to] of replacements) {
    result = result.replaceAll(`fill="${from}"`, `fill="${to}"`);
    result = result.replaceAll(`fill="${from.toLowerCase()}"`, `fill="${to}"`);
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, numberOfColors, smoothness, detectedPalette } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    const targetLayers = numberOfColors || 7;

    // Run VTracer at high quality — more colors initially = better merging later
    const config: Config = {
      colorMode: ColorMode.Color,
      hierarchical: Hierarchical.Stacked,
      filterSpeckle: 2,
      colorPrecision: 8,       // Maximum precision — capture every color
      layerDifference: 5,      // Minimal merging — let our post-process handle it
      mode: smoothness === 0 ? PathSimplifyMode.Polygon : PathSimplifyMode.Spline,
      cornerThreshold: 60,
      lengthThreshold: 4.0,
      maxIterations: 10,
      spliceThreshold: 45,
      pathPrecision: 3,
    };

    let svg = await vectorize(imageBuffer, config);

    // Post-process: merge VTracer's colors to our detected palette
    svg = mergeColorsToTarget(svg, targetLayers, detectedPalette);

    // Make SVG scalable — replace fixed width/height with viewBox
    svg = svg.replace(
      /(<svg[^>]*?)width="(\d+)"([^>]*?)height="(\d+)"/,
      (_, pre, w, mid, h) => `${pre}viewBox="0 0 ${w} ${h}"${mid}width="100%" height="100%"`
    );

    return NextResponse.json({ svg });
  } catch (err: any) {
    console.error("Vectorization failed:", err);
    return NextResponse.json({ error: err.message || "Vectorization failed" }, { status: 500 });
  }
}
