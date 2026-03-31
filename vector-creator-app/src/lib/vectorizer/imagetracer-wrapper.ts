import ImageTracer from "imagetracerjs";
import { TracingOptions } from "@/store/useEditorStore";

/**
 * Maps our UI tracing options into imagetracerjs option keys.
 * Tuned for laser-cutting output: clean paths, crisp layer separation.
 */
function mapOptionsToImageTracer(opts: TracingOptions) {
  return {
    // Color quantization
    numberofcolors: opts.numberOfColors,
    mincolorratio: opts.minColorRatio,
    colorquantcycles: opts.colorQuantCycles,

    // Pre-processing blur (noise reduction before quantization)
    blurradius: opts.blurRadius,
    blurdelta: opts.blurDelta,

    // Path building — pathomit removes tiny artifact paths (pixel area threshold)
    pathomit: opts.pathOmit,

    // Tracing precision — lower = more accurate paths
    ltres: 0.5,   // Line simplification tolerance
    qtres: 0.5,   // Quadratic spline tolerance
    rightangleenhance: true, // Sharpen corners (great for logos and text)

    // Curve type
    qsplines: opts.smoothness > 0 ? 1 : 0,

    // SVG output
    scale: 1,
    roundcoords: 2, // Decimal precision
    desc: false,     // No description metadata
    viewbox: true,   // Use viewBox for scalability
    strokewidth: 0,  // Fill only, no strokes (cleaner for laser import)

    // Let imagetracerjs auto-detect the palette from the image
    // Do NOT set pal — auto palette from quantization is far better
  };
}

/**
 * Traces an image client-side using imagetracerjs.
 * Returns a layered SVG string where each color = one laser layer.
 */
export async function traceImageToSVG(imageUrl: string, options: TracingOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const tracerOptions = mapOptionsToImageTracer(options);

      ImageTracer.imageToSVG(
        imageUrl,
        (svgString: string) => {
          if (!svgString) {
            reject(new Error("Tracing failed: returned empty string."));
            return;
          }
          resolve(svgString);
        },
        tracerOptions
      );
    } catch (error) {
      reject(error);
    }
  });
}
