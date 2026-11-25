"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/store/useEditorStore";
import { STENCIL_SIDE, stencilPalette, type StencilOptions } from "@/lib/photo/stencil";
import { loadImage } from "@/lib/vectorizer/background-remove";

let worker: Worker | null = null;
let nextId = 1;
function stencilInWorker(rgba: Uint8ClampedArray, w: number, h: number, opts: StencilOptions): Promise<{ labels: Uint8Array; bridges: number }> {
  if (!worker) worker = new Worker(new URL("../../lib/photo/stencil.worker.ts", import.meta.url), { type: "module" });
  const wk = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      wk.removeEventListener("message", onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve({ labels: e.data.labels, bridges: e.data.bridges });
    };
    wk.addEventListener("message", onMsg);
    wk.postMessage({ id, rgba, w, h, opts }, [rgba.buffer]);
  });
}

/**
 * Convert's preview in Stencil mode. Shows the flat stencil live while you
 * adjust it, then the finished vectors once "Make stencil" has run.
 */
export default function StencilPreview({ svg }: { svg: string | null }) {
  const { originalImage, cutoutImage, stencil, setStencilFlat, resultFrom, setResultSvg } = useEditorStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridges, setBridges] = useState<number | null>(null);
  const run = useRef(0);
  const first = useRef(true);

  const source = stencil.removeBackground ? cutoutImage : originalImage;
  const showSvg = !!svg && resultFrom === "stencil";

  useEffect(() => {
    if (!source) return;
    // A change of settings makes the old vectors out of date.
    if (!first.current && useEditorStore.getState().resultFrom === "stencil") setResultSvg(null);
    first.current = false;
    const ticket = ++run.current;
    const t = setTimeout(async () => {
      setWorking(true);
      setError(null);
      try {
        const img = await loadImage(source);
        const k = Math.min(1, STENCIL_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = "high";
        if (!stencil.removeBackground) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        const { labels, bridges: nb } = await stencilInWorker(ctx.getImageData(0, 0, w, h).data, w, h, stencil);
        if (ticket !== run.current) return;
        const pal = stencilPalette(stencil.tones);
        const out = ctx.createImageData(w, h);
        for (let p = 0, i = 0; p < labels.length; p++, i += 4) {
          const col = pal[labels[p]];
          out.data[i] = col.r; out.data[i + 1] = col.g; out.data[i + 2] = col.b; out.data[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        setStencilFlat(c.toDataURL("image/png"));
        setBridges(stencil.bridges ? nb : null);
        const cv = canvasRef.current;
        if (cv) {
          cv.width = w;
          cv.height = h;
          cv.getContext("2d")!.drawImage(c, 0, 0);
        }
      } catch (err) {
        if (ticket === run.current) setError(err instanceof Error ? err.message : "Couldn't make the stencil.");
      } finally {
        if (ticket === run.current) setWorking(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [source, stencil, setStencilFlat, setResultSvg]);

  // Coming back from the vectors view: show the last stencil again.
  useEffect(() => {
    const flat = useEditorStore.getState().stencilFlat;
    const cv = canvasRef.current;
    if (showSvg || !flat || !cv) return;
    loadImage(flat).then((img) => {
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      cv.getContext("2d")!.drawImage(img, 0, 0);
    }).catch(() => {});
  }, [showSvg]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground-muted">
          {showSvg ? "Stencil vectors" : "Stencil preview"}
          {bridges !== null && !showSvg && <span className="ml-2 text-[11px] font-normal">{bridges} bridge{bridges === 1 ? "" : "s"} added</span>}
        </h3>
        {working && <div className="w-3.5 h-3.5 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />}
        {!showSvg && <span className="ml-auto text-[11px] text-foreground-muted">Click Make stencil to turn this into vectors</span>}
      </div>
      <div className="flex-1 min-h-0 relative overflow-hidden checkered-bg flex items-center justify-center">
        {error && <p className="absolute top-3 left-3 right-3 z-10 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {showSvg ? (
          <div
            className="w-full h-full flex items-center justify-center p-6 bg-white/95 [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg! }}
          />
        ) : (
          <canvas ref={canvasRef} className="max-w-full max-h-full w-auto h-auto p-6" style={{ objectFit: "contain" }} />
        )}
      </div>
    </div>
  );
}
