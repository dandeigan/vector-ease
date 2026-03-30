import ImageTracer from "imagetracerjs";
import { TracingOptions } from "@/store/useEditorStore";

/**
 * Maps our high-level UI tracing options into the specific 
 * option keys imagetracerjs expects.
 */
function mapOptionsToImageTracer(opts: TracingOptions) {
  // ImageTracerJS expects a very specific dictionary format based on its "options" specification.
  // We customize the 'colorquantization' and 'tracing' options.
  return {
    // Quality & Colors
    numberofcolors: opts.numberOfColors,
    mincolorratio: opts.minColorRatio,
    colorquantcycles: opts.colorQuantCycles,
    
    // Blurring prior to quantization (reduces noise)
    blurradius: opts.blurRadius,
    blurdelta: opts.blurDelta,
    
    // Path building options
    // pathomit removes small artifact paths (noise dust)
    pathomit: opts.pathOmit,

    // SVG rendering
    scale: 1,
    lcd: 0,
    roundcoords: 1,

    // Curve Smoothing
    pal: [{ r: 255, g: 255, b: 255, a: 255 }], // Placeholder if custom palette used
    qtres: 1,     // Error threshold for quad tree (1 is standard)
    ltres: 1,     // Error threshold for linear simplification
    qsplines: opts.smoothness > 0 ? 1 : 0, // Ensure smooth curves are used if requested
  };
}

/**
 * Traces an image completely client-side.
 * Uses imagetracerjs to convert an image URL (or base64) into an SVG string.
 */
export async function traceImageToSVG(imageUrl: string, options: TracingOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const tracerOptions = mapOptionsToImageTracer(options);

      // imagetracerjs takes (url, callback, options)
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
