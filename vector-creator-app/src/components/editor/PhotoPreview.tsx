"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Eye, Brush, Eraser, Trash2, Moon, Sun, Type } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { materialById, targetSize, type EngraveOptions } from "@/lib/photo/engrave";
import { loadImage } from "@/lib/vectorizer/background-remove";

let worker: Worker | null = null;
let nextId = 1;
function engraveInWorker(rgba: Uint8ClampedArray, w: number, h: number, opts: EngraveOptions, touch: Uint8ClampedArray | null): Promise<Uint8ClampedArray> {
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
    wk.postMessage({ id, rgba, w, h, opts, touch }, touch ? [rgba.buffer, touch.buffer] : [rgba.buffer]);
  });
}

/** Brush layers are kept at most this big (long side); they are scaled to the engraving. */
const TOUCH_SIDE = 1200;
type TouchTool = "darken" | "lighten" | "crisp" | "erase";
const TOOLS: { id: TouchTool; label: string; icon: typeof Brush; tint: string; hint: string }[] = [
  { id: "darken", label: "Darken", icon: Moon, tint: "59,130,246", hint: "Adds dots: deeper shadows, more definition" },
  { id: "lighten", label: "Lighten", icon: Sun, tint: "250,204,21", hint: "Removes dots: brighter spots" },
  { id: "crisp", label: "Sharpen logo", icon: Type, tint: "236,72,153", hint: "Burns lettering and logos solid with clean edges" },
  { id: "erase", label: "Erase", icon: Eraser, tint: "0,0,0", hint: "Removes touch-ups" },
];

/** Reads the brush layers at the engraving size: [darken, lighten, crisp], one byte per dot each. */
function readTouch(t: { darken: HTMLCanvasElement; lighten: HTMLCanvasElement; crisp: HTMLCanvasElement }, w: number, h: number): Uint8ClampedArray | null {
  const out = new Uint8ClampedArray(w * h * 3);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  let any = false;
  [t.darken, t.lighten, t.crisp].forEach((layer, k) => {
    ctx.clearRect(0, 0, w, h);
    // Soft edge for darken / lighten so they blend in; Sharpen logo keeps a firm edge.
    ctx.filter = k < 2 ? `blur(${Math.max(1, Math.round(w * 0.004))}px)` : "none";
    ctx.drawImage(layer, 0, 0, w, h);
    ctx.filter = "none";
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let p = 0, i = 3; p < w * h; p++, i += 4) if (d[i]) { out[k * w * h + p] = d[i]; any = true; }
  });
  return any ? out : null;
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Convert's preview in Photo engrave mode. Re-makes the engraving whenever
 * the photo or a setting changes, and shows it as it will look on the
 * material (or as the raw black-and-white laser file).
 */
export default function PhotoPreview() {
  const { originalImage, cutoutImage, engrave, photoOutput, setPhotoOutput, touchLayers, setTouchLayers, touchVersion, bumpTouch } = useEditorStore();
  const [touchOn, setTouchOn] = useState(false);
  const [tool, setTool] = useState<TouchTool>("darken");
  const [brushPct, setBrushPct] = useState(3);
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
        const layers = useEditorStore.getState().touchLayers;
        const touch = layers && layers.forImage === originalImage ? readTouch(layers, w, h) : null;
        const pixels = await engraveInWorker(rgba, w, h, engrave, touch);
        if (ticket !== run.current) return;
        setPhotoOutput({ pixels, w, h, dpi: engrave.dpi, widthMm: engrave.widthMm });
      } catch (err) {
        if (ticket === run.current) setError(err instanceof Error ? err.message : "Couldn't make the engraving.");
      } finally {
        if (ticket === run.current) setWorking(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [source, engrave, setPhotoOutput, touchVersion, originalImage]);

  // Brush layers for this image (made once per uploaded image).
  useEffect(() => {
    if (!originalImage || touchLayers?.forImage === originalImage) return;
    let live = true;
    loadImage(originalImage).then((img) => {
      if (!live) return;
      const k = Math.min(1, TOUCH_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const make = () => {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        return c;
      };
      setTouchLayers({ forImage: originalImage, darken: make(), lighten: make(), crisp: make() });
    }).catch(() => {});
    return () => { live = false; };
  }, [originalImage, touchLayers, setTouchLayers]);

  // Brush overlay: shows where touch-ups are painted.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef<{ x: number; y: number } | null>(null);
  const layersReady = !!touchLayers && touchLayers.forImage === originalImage;
  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    if (!ov || !touchLayers) return;
    ov.width = touchLayers.darken.width;
    ov.height = touchLayers.darken.height;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (!touchOn) return;
    const tint = document.createElement("canvas");
    tint.width = ov.width;
    tint.height = ov.height;
    const tctx = tint.getContext("2d")!;
    const paint = (layer: HTMLCanvasElement, rgb: string) => {
      tctx.globalCompositeOperation = "source-over";
      tctx.clearRect(0, 0, tint.width, tint.height);
      tctx.drawImage(layer, 0, 0);
      tctx.globalCompositeOperation = "source-in";
      tctx.fillStyle = `rgba(${rgb},0.45)`;
      tctx.fillRect(0, 0, tint.width, tint.height);
      ctx.drawImage(tint, 0, 0);
    };
    paint(touchLayers.darken, TOOLS[0].tint);
    paint(touchLayers.lighten, TOOLS[1].tint);
    paint(touchLayers.crisp, TOOLS[2].tint);
    if (strokeRef.current && painting.current) {
      const rgb = tool === "erase" ? "255,255,255" : TOOLS.find((t) => t.id === tool)!.tint;
      paint(strokeRef.current, rgb);
    }
  }, [touchLayers, touchOn, tool]);
  useEffect(() => { drawOverlay(); }, [drawOverlay, touchVersion]);

  const toLayer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ov = e.currentTarget, r = ov.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * ov.width, y: ((e.clientY - r.top) / r.height) * ov.height };
  };
  const stamp = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const st = strokeRef.current;
    if (!st) return;
    const ctx = st.getContext("2d")!;
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, (brushPct / 100) * st.width);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!touchOn || !touchLayers) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const st = document.createElement("canvas");
    st.width = touchLayers.darken.width;
    st.height = touchLayers.darken.height;
    strokeRef.current = st;
    const pt = toLayer(e);
    painting.current = pt;
    stamp(pt, pt);
    drawOverlay();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current) return;
    const pt = toLayer(e);
    stamp(painting.current, pt);
    painting.current = pt;
    drawOverlay();
  };
  const onUp = () => {
    const st = strokeRef.current;
    if (!painting.current || !st || !touchLayers) return;
    painting.current = null;
    const apply = (layer: HTMLCanvasElement, op: GlobalCompositeOperation, alpha: number) => {
      const ctx = layer.getContext("2d")!;
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = alpha;
      ctx.drawImage(st, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    };
    if (tool === "erase") [touchLayers.darken, touchLayers.lighten, touchLayers.crisp].forEach((l) => apply(l, "destination-out", 1));
    else if (tool === "crisp") apply(touchLayers.crisp, "source-over", 1);
    // Each pass adds half strength: paint over a spot again for more.
    else apply(tool === "darken" ? touchLayers.darken : touchLayers.lighten, "source-over", 0.5);
    strokeRef.current = null;
    bumpTouch();
  };
  const clearTouch = () => {
    if (!touchLayers) return;
    [touchLayers.darken, touchLayers.lighten, touchLayers.crisp].forEach((l) => l.getContext("2d")!.clearRect(0, 0, l.width, l.height));
    bumpTouch();
  };

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
            onClick={() => setTouchOn((v) => !v)}
            disabled={!layersReady}
            className={`px-2 py-1 rounded-md text-[11px] font-medium border disabled:opacity-40 ${touchOn ? "border-dd-gold-400/50 text-dd-gold-400 bg-dd-gold-400/10" : "border-border text-foreground-muted hover:text-foreground"}`}
            title="Paint over small spots to darken, lighten or sharpen just those spots"
          >
            <Brush className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> Touch up
          </button>
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
      {touchOn && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-2 border-b border-border bg-card/40">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.hint}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 ${tool === t.id ? "border-dd-gold-400/50 text-dd-gold-400 bg-dd-gold-400/10" : "border-border text-foreground-muted hover:text-foreground"}`}
            >
              {t.id !== "erase" && <span className="w-2 h-2 rounded-full" style={{ background: `rgb(${t.tint})` }} />}
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-foreground-muted ml-2">
            Size
            <input type="range" min={1} max={10} step={0.5} value={brushPct} onChange={(e) => setBrushPct(Number(e.target.value))} aria-label="Brush size" className="w-24" />
          </label>
          <button onClick={clearTouch} className="ml-auto px-2 py-1 rounded-md text-[11px] font-medium border border-border text-foreground-muted hover:text-foreground flex items-center gap-1">
            <Trash2 className="w-3.5 h-3.5" /> Clear touch-ups
          </button>
          <p className="basis-full text-[10px] text-foreground-muted">
            {TOOLS.find((t) => t.id === tool)!.hint}. Paint over a spot; paint again for a stronger effect. Only painted spots change.
          </p>
        </div>
      )}
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
        <div className={`relative ${zoom ? "inline-block" : ""} ${photoOutput ? "" : "hidden"}`}>
          <canvas
            ref={canvasRef}
            className={`block ${zoom ? "max-w-none" : "shadow-xl rounded-sm"}`}
            style={zoom ? { imageRendering: "pixelated" } : undefined}
          />
          <canvas
            ref={overlayRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className={`absolute inset-0 w-full h-full ${touchOn ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
          />
        </div>
      </div>
    </div>
  );
}
