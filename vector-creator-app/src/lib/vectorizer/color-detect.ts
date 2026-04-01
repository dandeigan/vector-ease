"use client";

export interface DetectedColor {
  r: number;
  g: number;
  b: number;
  hex: string;
  name: string;
  percentage: number;
}

/**
 * Analyzes an image and detects dominant distinct colors.
 * Uses canvas pixel sampling + clustering to find real colors,
 * ignoring anti-aliasing and compression artifacts.
 */
export async function detectImageColors(imageUrl: string): Promise<DetectedColor[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Sample at reduced size for performance
      const maxDim = 200;
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      // Step 1: Collect all pixels, quantize to reduce noise
      // Round to nearest 8 (finer than 16) to preserve color accuracy
      const buckets = new Map<string, number>();
      const totalPixels = data.length / 4;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue; // Skip transparent pixels

        const r = Math.round(data[i] / 8) * 8;
        const g = Math.round(data[i + 1] / 8) * 8;
        const b = Math.round(data[i + 2] / 8) * 8;
        const key = `${r},${g},${b}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }

      // Step 2: Sort by frequency and cluster similar colors
      const sorted = Array.from(buckets.entries())
        .map(([key, count]) => {
          const [r, g, b] = key.split(",").map(Number);
          return { r, g, b, count };
        })
        .sort((a, b) => b.count - a.count);

      // Step 3: Cluster — merge colors within distance threshold
      const MERGE_DISTANCE = 55; // Moderate merge — catches anti-aliasing but preserves distinct colors

      function clusterColors(input: typeof sorted, threshold: number) {
        const clusters: { r: number; g: number; b: number; count: number }[] = [];
        for (const pixel of input) {
          let merged = false;
          for (const cluster of clusters) {
            const dist = Math.sqrt(
              (pixel.r - cluster.r) ** 2 +
              (pixel.g - cluster.g) ** 2 +
              (pixel.b - cluster.b) ** 2
            );
            if (dist < threshold) {
              const totalCount = cluster.count + pixel.count;
              cluster.r = Math.round((cluster.r * cluster.count + pixel.r * pixel.count) / totalCount);
              cluster.g = Math.round((cluster.g * cluster.count + pixel.g * pixel.count) / totalCount);
              cluster.b = Math.round((cluster.b * cluster.count + pixel.b * pixel.count) / totalCount);
              cluster.count = totalCount;
              merged = true;
              break;
            }
          }
          if (!merged) {
            clusters.push({ ...pixel });
          }
        }
        return clusters;
      }

      // First pass
      let clusters = clusterColors(sorted, MERGE_DISTANCE);
      // Second pass — merge any clusters that drifted close after weighted averaging
      clusters = clusterColors(
        clusters.sort((a, b) => b.count - a.count),
        MERGE_DISTANCE
      );

      // Step 4: Filter out tiny clusters (< 1.5% of image) and sort
      const minCount = totalPixels * 0.015;
      const significant = clusters
        .filter((c) => c.count >= minCount)
        .sort((a, b) => b.count - a.count);

      // Step 5: Convert to output format
      const result: DetectedColor[] = significant.map((c) => ({
        r: clamp(c.r),
        g: clamp(c.g),
        b: clamp(c.b),
        hex: toHex(clamp(c.r), clamp(c.g), clamp(c.b)),
        name: nameColor(clamp(c.r), clamp(c.g), clamp(c.b)),
        percentage: Math.round((c.count / totalPixels) * 100),
      }));

      resolve(result);
    };
    img.onerror = () => resolve([]);
    img.src = imageUrl;
  });
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function nameColor(r: number, g: number, b: number): string {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

  // Neutrals first — low saturation
  if (saturation < 0.15) {
    if (brightness > 230) return "White";
    if (brightness < 35) return "Black";
    if (brightness > 180) return "Light Gray";
    if (brightness > 100) return "Gray";
    return "Dark Gray";
  }

  // Chromatic colors
  if (r > 180 && g < 100 && b < 100) return "Red";
  if (r > 200 && g > 100 && g < 170 && b < 120) return "Salmon";
  if (r > 180 && g > 90 && g < 150 && b < 80) return "Orange";
  if (r > 180 && g > 150 && b < 80) return "Yellow";
  if (r < 100 && g > 150 && b < 100) return "Green";
  if (r < 80 && g > 120 && b > 120) return "Teal";
  if (r < 100 && g < 100 && b > 160) return "Blue";
  if (r < 80 && g > 80 && b > 180) return "Blue";
  if (r > 60 && r < 160 && g < 100 && b > 160) return "Purple";
  if (r > 180 && g < 120 && b > 120) return "Pink";
  if (r > 150 && g > 100 && b > 80 && r > g && r > b) return "Peach";

  // Fallback based on dominant channel
  if (r > g && r > b) return brightness > 150 ? "Light Red" : "Dark Red";
  if (g > r && g > b) return brightness > 150 ? "Light Green" : "Dark Green";
  if (b > r && b > g) return brightness > 150 ? "Light Blue" : "Dark Blue";

  if (brightness > 150) return "Light Gray";
  if (brightness > 80) return "Gray";
  return "Dark Gray";
}
