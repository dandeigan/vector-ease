"use client";

import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Eye } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { materialById, targetSize, type EngraveOptions } from "@/lib/photo/engrave";
import { loadImage } from "@/lib/vectorizer/background-remove";

let worker: Worker | null = null;
let nextId = 1;
function engraveInWorker(rgba: Uint8ClampedArray, w: number, h: number, opts: EngraveOptions): Promise<Uint8ClampedArray> {
  if (!worker) worker = new Worker(new URL("../../lib/photo/engrave.worker.ts", import.meta.url), { type: "module" });
  const wk = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      wk.removeEventListener("message", onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.pixels);
    };
    wk.addEventListener("message", onMsg);
    wk.postMessage({ id, rgba, w, h, opts }, [rgba.buffer]);
  });
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Convert's preview in Photo engrave mode. Re-makes the engraving whenever
 * the photo or a setting changes, and shows it as it will look on the
 * material (or as the raw black-and-white laser file).
 */
export default function PhotoPreview() {
  const { originalImage, cutoutImage, engrave, photoOutput, setPhotoOutput } = useEditorStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [laserView, setLaserView] = useState(false);
  const run = useRef(0);

  const source = engrave.removeBackground ? cutoutImage : originalImage;

  // Make the engraving (debounced, newest request wins).
  useEffect(() => {
    if (!source) return;
    const ticket = ++run.current;
    const t = setTimeout(async () => {
      setWorking(true);
      setError(null);
      try {
        const img = await loadImage(source);
        const { w, h } = targetSize(img.naturalWidth, img.naturalHeight, engrave.widthMm, engrave.dpi);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = "high";
        // Photos without a cut-out sit on white; a cut-out keeps its transparency (= no burn).
        if (!engrave.removeBackground) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const pixels = await engraveInWorker(rgba, w, h, engrave);
        if (ticket !== run.current) return;
        setPhotoOutput({ pixels, w, h, dpi: engrave.dpi, widthMm: engrave.widthMm });
      } catch (err) {
        if (ticket === run.current) setError(err instanceof Error ? err.message : "Couldn't make the engraving.");
      } finally {
        if (ticket === run.current) setWorking(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [source, engrave, setPhotoOutput]);

  // Colour it: material colours, or the raw laser file (full size, one pixel per dot).
  const fullRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    if (!photoOutput) return;
    const { pixels, w, h } = photoOutput;
    const full = fullRef.current ?? (fullRef.current = document.createElement("canvas"));
    full.width = w;
    full.height = h;
    const ctx = full.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const mat = materialById(engrave.material);
    const base = laserView ? [255, 255, 255] : hexRgb(mat.base);
    const mark = laserView ? [0, 0, 0] : hexRgb(mat.mark);
    // The file is a burn map (0 = burn). On flipped materials the burn is the light mark.
    for (let p = 0, i = 0; p < pixels.length; p++, i += 4) {
      const t = pixels[p] / 255; // 1 = no burn
      img.data[i] = mark[0] + (base[0] - mark[0]) * t;
      img.data[i + 1] = mark[1] + (base[1] - mark[1]) * t;
      img.data[i + 2] = mark[2] + (base[2] - mark[2]) * t;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    setDrawn((n) => n + 1);
  }, [photoOutput, laserView, engrave.material]);

  // Show it. Zoomed: the real dots, 2x. Fitted: shrunk in halving steps, so the
  // dots blend into tones the way the eye sees them on wood (no grainy moiré).
  useEffect(() => {
    const cv = canvasRef.current, full = fullRef.current, box = boxRef.current;
    if (!cv || !full || !box || !drawn) return;
    const paint = () => {
      const ctx = cv.getContext("2d")!;
      if (zoom) {
        cv.width = full.width;
        cv.height = full.height;
        cv.style.width = `${full.width * 2}px`;
        cv.style.height = `${full.height * 2}px`;
        ctx.drawImage(full, 0, 0);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const k = Math.min((box.clientWidth - 48) / full.width, (box.clientHeight - 48) / full.height, 1);
      const cssW = Math.max(1, Math.floor(full.width * k)), cssH = Math.max(1, Math.floor(full.height * k));
      const tw = Math.min(full.width, Math.round(cssW * dpr)), th = Math.min(full.height, Math.round(cssH * dpr));
      let src: HTMLCanvasElement = full;
      while (src.width / 2 >= tw) {
        const half = document.createElement("canvas");
        half.width = Math.round(src.width / 2);
        half.height = Math.round(src.height / 2);
        const hctx = half.getContext("2d")!;
        hctx.imageSmoothingQuality = "high";
        hctx.drawImage(src, 0, 0, half.width, half.height);
        src = half;
      }
      cv.width = tw;
      cv.height = th;
      cv.style.width = `${cssW}px`;
      cv.style.height = `${cssH}px`;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, tw, th);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(box);
    return () => ro.disconnect();
  }, [drawn, zoom]);

  const heightMm = photoOutput ? (photoOutput.h / photoOutput.w) * photoOutput.widthMm : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground-muted">
          Photo engrave preview
          {photoOutput && (
            <span className="ml-2 text-[11px] font-normal">
              {Math.round(photoOutput.widthMm)} × {Math.round(heightMm)} mm · {photoOutput.dpi} DPI
            </span>
          )}
        </h3>
        {working && <div className="w-3.5 h-3.5 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setLaserView((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-medium border ${laserView ? "border-dd-gold-400/50 text-dd-gold-400 bg-dd-gold-400/10" : "border-border text-foreground-muted hover:text-foreground"}`}
            title="Show the black-and-white file the laser gets (black = burn)"
          >
            <Eye className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> Laser file
          </button>
          <button
            onClick={() => setZoom((z) => !z)}
            className="px-2 py-1 rounded-md text-[11px] font-medium border border-border text-foreground-muted hover:text-foreground"
            title={zoom ? "Fit to window" : "See the actual laser dots"}
          >
            {zoom ? <ZoomOut className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> : <ZoomIn className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
            {zoom ? "Fit" : "Dots"}
          </button>
        </div>
      </div>
      <div ref={boxRef} className={`flex-1 min-h-0 relative bg-background/40 ${zoom ? "overflow-auto" : "overflow-hidden flex items-center justify-center"}`}>
        {error && <p className="absolute top-3 left-3 right-3 z-10 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {!photoOutput && !error && <p className="text-sm text-foreground-muted">Making your engraving...</p>}
        {photoOutput && !zoom && (
          <p className="absolute bottom-2 left-3 right-3 text-center text-[10px] text-foreground-muted pointer-events-none">
            {laserView
              ? "Black = laser burns. White = laser stays off."
              : `Preview on ${materialById(engrave.material).label.toLowerCase()}. The plain colour is the bare material, which the laser never touches. Only the dots burn.`}
          </p>
        )}
        <canvas
          ref={canvasRef}
          className={`${photoOutput ? "" : "hidden"} ${zoom ? "max-w-none" : "shadow-xl rounded-sm"}`}
          style={zoom ? { imageRendering: "pixelated" } : undefined}
        />
      </div>
    </div>
  );
}
