import { NextRequest, NextResponse } from "next/server";
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode, type Config } from "@neplex/vectorizer";
import sharp from "sharp";

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Pre-process: snap every pixel in the image to the nearest palette color.
 * Eliminates anti-aliasing, JPEG artifacts, and gradient transitions.
 * VTracer then gets a clean flat-color image to trace.
 */
async function quantizeImageToPalette(
  imageBuffer: Buffer,
  palette: { r: number; g: number; b: number }[]
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  // Get raw pixel data (RGBA)
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);

  // Snap each pixel to nearest palette color
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    if (a < 128) continue; // Skip transparent

    let minDist = Infinity;
    let bestR = r, bestG = g, bestB = b;

    for (const pc of palette) {
      const dist = (r - pc.r) ** 2 + (g - pc.g) ** 2 + (b - pc.b) ** 2;
      if (dist < minDist) {
        minDist = dist;
        bestR = pc.r;
        bestG = pc.g;
        bestB = pc.b;
      }
    }

    pixels[i] = bestR;
    pixels[i + 1] = bestG;
    pixels[i + 2] = bestB;
  }

  // Convert back to PNG
  return sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, numberOfColors, smoothness, detectedPalette } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    let imageBuffer = Buffer.from(base64Data, "base64");

    const targetLayers = numberOfColors || 7;

    // Step 1: Pre-process — quantize image to detected palette
    // This eliminates anti-aliasing, JPEG artifacts, and gradient noise
    if (detectedPalette && detectedPalette.length > 0) {
      imageBuffer = await quantizeImageToPalette(imageBuffer, detectedPalette);
    }

    // Step 2: Run VTracer on the clean, flat-color image
    // Low precision + high layer difference since image is already quantized
    const config: Config = {
      colorMode: ColorMode.Color,
      hierarchical: Hierarchical.Stacked,
      filterSpeckle: 8,
      colorPrecision: 3,        // Low — image already has exact colors from quantization
      layerDifference: 25,      // Higher — merge any VTracer artifacts aggressively
      mode: smoothness === 0 ? PathSimplifyMode.Polygon : PathSimplifyMode.Spline,
      cornerThreshold: 60,
      lengthThreshold: 4.0,
      maxIterations: 10,
      spliceThreshold: 45,
      pathPrecision: 3,
    };

    let svg = await vectorize(imageBuffer, config);

    // Step 3: Snap all SVG fill colors to the nearest palette color
    // VTracer may produce slight color variations even from a quantized image
    if (detectedPalette && detectedPalette.length > 0) {
      svg = svg.replace(
        /fill="#([0-9a-fA-F]{6})"/g,
        (full, hex) => {
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          let minDist = Infinity;
          let bestHex = hex;
          for (const pc of detectedPalette) {
            const dist = (r - pc.r) ** 2 + (g - pc.g) ** 2 + (b - pc.b) ** 2;
            if (dist < minDist) {
              minDist = dist;
              bestHex = [pc.r, pc.g, pc.b].map((v: number) => v.toString(16).padStart(2, "0")).join("");
            }
          }
          return `fill="#${bestHex.toUpperCase()}"`;
        }
      );
    }

    // Step 4: Make SVG scalable
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
