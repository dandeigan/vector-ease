import ImageTracer from "imagetracerjs";
import { TracingOptions } from "@/store/useEditorStore";

/**
 * Maps our UI tracing options into imagetracerjs option keys.
 * Tuned for laser-cutting output: clean paths, crisp layer separation.
 */
function mapOptionsToImageTracer(opts: TracingOptions) {
  const base: Record<string, any> = {
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
    ltres: 0.5,
    qtres: 0.5,
    rightangleenhance: true,

    // Curve type
    qsplines: opts.smoothness > 0 ? 1 : 0,

    // SVG output
    scale: 1,
    roundcoords: 2,
    desc: false,
    viewbox: true,
    strokewidth: 0,
  };

  // If we have a custom palette from auto-detect, use it.
  // This forces imagetracerjs to map all pixels to these exact colors
  // instead of running its own quantization.
  if (opts.customPalette && opts.customPalette.length > 0) {
    base.pal = opts.customPalette.map((c) => ({
      r: c.r,
      g: c.g,
      b: c.b,
      a: 255,
    }));
    // When using a custom palette, override numberofcolors to match
    base.numberofcolors = opts.customPalette.length;
  }

  return base;
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
