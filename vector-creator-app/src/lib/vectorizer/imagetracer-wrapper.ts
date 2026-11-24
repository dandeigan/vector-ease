import { TracingOptions } from "@/store/useEditorStore";
import { auth } from "@/lib/firebase/config";

/**
 * Traces an image by sending it to the server-side VTracer engine.
 * Uses @neplex/vectorizer for production-quality vectorization,
 * then merges colors to the detected palette for accurate layer mapping.
 */
export async function traceImageToSVG(imageUrl: string, options: TracingOptions): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/vectorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      imageBase64: imageUrl,
      numberOfColors: options.numberOfColors,
      smoothness: options.smoothness,
      detectedPalette: options.customPalette || null,
      lineArt: options.lineArt,
      inkTones: options.inkTones,
      inkSensitivity: options.inkSensitivity,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Vectorization failed (${res.status})`);
  }

  const data = await res.json();

  if (!data.svg) {
    throw new Error("Vectorization returned empty result");
  }

  return data.svg;
}
