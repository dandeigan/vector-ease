/// <reference lib="webworker" />
import { engravePixels, type EngraveOptions } from "./engrave";

// Photo engrave runs here so big engravings never freeze the page.
self.onmessage = (e: MessageEvent<{ id: number; rgba: Uint8ClampedArray; w: number; h: number; opts: EngraveOptions; touch?: Uint8ClampedArray | null }>) => {
  const { id, rgba, w, h, opts, touch } = e.data;
  try {
    const pixels = engravePixels(rgba, w, h, opts, touch);
    (self as unknown as Worker).postMessage({ id, pixels }, [pixels.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : "Photo engrave failed" });
  }
};
