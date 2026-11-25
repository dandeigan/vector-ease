/// <reference lib="webworker" />
import { makeStencil, type StencilOptions } from "./stencil";

// Stencil runs here so the page never freezes while bridges are worked out.
self.onmessage = (e: MessageEvent<{ id: number; rgba: Uint8ClampedArray; w: number; h: number; opts: StencilOptions }>) => {
  const { id, rgba, w, h, opts } = e.data;
  try {
    const { labels, bridges } = makeStencil(rgba, w, h, opts);
    (self as unknown as Worker).postMessage({ id, labels, bridges }, [labels.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : "Stencil failed" });
  }
};
