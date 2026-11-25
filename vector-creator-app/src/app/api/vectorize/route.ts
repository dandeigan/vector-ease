import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { gzipSync } from "zlib";
import { getVerifiedUid } from "@/lib/firebase/verify-token";
import { buildPalette, type Rgb } from "@/lib/vectorizer/palette";
import { prepareLineArt, PAPER_HEX } from "@/lib/vectorizer/line-art";
import { quantizeCrisp, traceScale, upscaleForTrace } from "@/lib/vectorizer/quantize";
import { traceByLayer } from "@/lib/vectorizer/layer-trace";

/** Big images can take a few seconds to trace. */
export const maxDuration = 60;

/** Vercel refuses function responses over 4.5 MB, so stay under it. */
const MAX_RESPONSE_BYTES = 4_000_000;

/**
 * Image → layered SVG (one fill colour per laser layer).
 * 1. Enlarge up to 2x so small details survive (quantize.ts).
 * 2. Split into the palette's colours without halo rings (quantize.ts), or
 *    ink vs paper in line-art mode (line-art.ts).
 * 3. Trace each colour on its own and bake coordinates back to the original
 *    image size (layer-trace.ts).
 */
export async function POST(req: NextRequest) {
  // Only signed-in users may use the vectorizer (it costs server CPU).
  const uid = await getVerifiedUid(req);
  if (!uid) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const { imageBase64, numberOfColors, smoothness, detectedPalette, lineArt, inkTones, inkSensitivity, skipWhite } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer: Buffer<ArrayBuffer> = Buffer.from(base64Data, "base64") as Buffer<ArrayBuffer>;

    const targetLayers = Math.min(16, Math.max(2, Math.round(Number(numberOfColors) || 7)));
    // Pick the palette (colour mode). Use the auto-detected colours only when they
    // match the layer count asked for; otherwise build exactly that many from the image.
    let palette: Rgb[] = [];
    if (!lineArt) {
      palette =
        Array.isArray(detectedPalette) && detectedPalette.length === targetLayers
          ? detectedPalette
          : await buildPalette(imageBuffer, targetLayers);
      if (!palette.length) palette = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
      palette = palette.map((c) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }));
    }

    const trace = async (scale: number): Promise<string> => {
      const big = await upscaleForTrace(imageBuffer, scale);
      // Specks smaller than ~2 original pixels across are dropped (JPEG noise).
      const opts = { speckle: Math.max(2, Math.round(2 * scale)), smoothness: smoothness === 0 ? 0 : 1, lengthThreshold: 4, scale };
      if (lineArt) {
        // Line art: ink vs paper by brightness, paper dropped, fine detail kept.
        const { png } = await prepareLineArt(big, { tones: Number(inkTones) || 1, sensitivity: Number(inkSensitivity ?? 50) });
        return traceByLayer(png, { ...opts, skip: [PAPER_HEX] });
      }
      // Flat colours with no in-between rings, then one clean trace per layer.
      // Stencils: the white paper is left out of the file.
      return traceByLayer(await quantizeCrisp(big, palette, scale), skipWhite ? { ...opts, skip: [PAPER_HEX] } : opts);
    };

    // Trace bigger than the original so dots, thin strokes and curves stay crisp.
    const meta = await sharp(imageBuffer).metadata();
    const scale = traceScale(meta.width ?? 1000, meta.height ?? 1000);
    let json = JSON.stringify({ svg: await trace(scale) });
    // Normal results go back as plain JSON (Vercel compresses them on the way).
    if (json.length <= MAX_RESPONSE_BYTES) return new Response(json, { headers: { "Content-Type": "application/json" } });

    // Very detailed images at many layers outgrow Vercel's response limit, so
    // send those pre-compressed. Still too big: try again at the original size,
    // then explain what to change.
    let body = gzipSync(json);
    if (body.length > MAX_RESPONSE_BYTES && scale > 1) {
      json = JSON.stringify({ svg: await trace(1) });
      body = gzipSync(json);
    }
    if (body.length > MAX_RESPONSE_BYTES) {
      return NextResponse.json(
        { error: lineArt
            ? "This drawing has too much fine detail to send back in one file. Try 1 ink layer, or move Faint lines toward Fewer."
            : `This image has too much fine detail for ${targetLayers} layers. Try fewer layers, or Line art for drawings and sketches.` },
        { status: 413 },
      );
    }
    return new Response(body, { headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" } });
  } catch (err) {
    console.error("Vectorization failed:", err);
    return NextResponse.json({ error: (err instanceof Error && err.message) || "Vectorization failed" }, { status: 500 });
  }
}
