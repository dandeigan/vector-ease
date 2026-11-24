"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Type, Square, Circle, Heart, Star, Undo2, Redo2, Copy, Trash2, Group as GroupIcon, Ungroup,
  ZoomIn, ZoomOut, Maximize, FolderOpen, Download, FilePlus, Crosshair,
} from "lucide-react";
import { StudioEngine, type EngineState, type ShapeKind } from "@/lib/studio/engine";
import { importLac } from "@/lib/studio/import-lac";
import { importSvg } from "@/lib/studio/import-svg";
import { importDxf } from "@/lib/studio/import-dxf";
import { takePendingStudioFiles, type StudioHandoffMeta } from "@/lib/studio/handoff";
import { newLayerId } from "@/lib/studio/layers";
import { buildLac } from "@/lib/studio/export-lac";
import { DEFAULT_FONT_ID, registerFontFaces } from "@/lib/studio/fonts";
import type { ImportedDesign, StudioTextSettings } from "@/lib/studio/types";
import SelectionPanel from "./SelectionPanel";
import LayersPanel from "./LayersPanel";
import ExportDoneDialog, { exportDialogSkipped, type ExportInfo } from "./ExportDoneDialog";
import MmInput from "./MmInput";
import AppHeader from "@/components/AppHeader";

interface Toast {
  id: number;
  tone: "ok" | "warn" | "error";
  text: string;
}

const DEFAULT_TEXT: StudioTextSettings = {
  text: "Your text",
  fontId: DEFAULT_FONT_ID,
  sizeMm: 14,
  align: "center",
  lineHeight: 1.2,
  letterSpacing: 0,
};

const OPEN_ACCEPT = ".lac,.svg,.dxf,image/svg+xml,image/vnd.dxf,application/dxf";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";
}

/** A Convert result: give every colour its own Studio layer (named as on Convert) instead of lumping them into Engrave. */
function applyLayerColors(design: ImportedDesign, layerColors: NonNullable<StudioHandoffMeta["layerColors"]>) {
  const ids = new Map<string, string>();
  for (const item of design.items) {
    if (item.kind !== "path" || !item.sourceColor) continue;
    const hex = item.sourceColor.toUpperCase();
    const info = layerColors[hex];
    if (!info) continue;
    let id = ids.get(hex);
    if (!id) {
      id = newLayerId();
      ids.set(hex, id);
      design.layers.push({ id, name: info.name, color: hex, operation: info.operation, visible: true });
    }
    item.layerId = id;
  }
}

export default function Studio() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exported, setExported] = useState<ExportInfo | null>(null);
  const lastExport = useRef<{ blob: Blob; file: string } | null>(null);

  const toast = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "ok" ? 3500 : 7000);
  }, []);

  /* ── engine setup ── */
  useEffect(() => {
    registerFontFaces();
    const el = canvasRef.current, box = containerRef.current;
    if (!el || !box) return;
    const engine = new StudioEngine(el, setState);
    engineRef.current = engine;
    engine.init({ width: box.clientWidth, height: box.clientHeight }).then(() => {
      if (engineRef.current !== engine) return; // unmounted while loading
      setState(engine.getState());
      // Files picked on the Convert page and sent here.
      const handed = takePendingStudioFiles();
      if (handed.files.length) openFilesRef.current?.(handed.files, handed.meta);
    });

    const ro = new ResizeObserver(() => engine.resize({ width: box.clientWidth, height: box.clientHeight }));
    ro.observe(box);
    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const eng = () => engineRef.current;

  /* ── opening files ── */
  const openFiles = useCallback(async (files: FileList | File[], meta?: StudioHandoffMeta) => {
    const engine = eng();
    if (!engine) return;
    for (const file of Array.from(files)) {
      const name = file.name;
      const ext = name.split(".").pop()?.toLowerCase();
      setBusy(`Opening ${name}…`);
      try {
        let design;
        if (ext === "lac") design = await importLac(file, name);
        else if (ext === "svg" || file.type === "image/svg+xml") design = await importSvg(file, name);
        else if (ext === "dxf") design = await importDxf(file, name);
        else if (file.type.startsWith("image/")) {
          toast("warn", `To turn a photo into a vector, use Convert first. Opening photos straight in the Studio is coming in the next update.`);
          continue;
        } else {
          toast("error", `"${name}" isn't a file type the Studio can open yet. Right now it opens Bambu .lac, .svg and .dxf files.`);
          continue;
        }
        if (meta?.layerColors) applyLayerColors(design, meta.layerColors);
        await engine.addDesign(design);
        const shapes = design.items.length;
        toast("ok", `Opened "${design.name}" (${shapes} shape${shapes === 1 ? "" : "s"}).`);
        for (const w of design.warnings) toast("warn", w);
      } catch (err) {
        toast("error", err instanceof Error ? err.message : `Couldn't open "${name}".`);
      } finally {
        setBusy(null);
      }
    }
  }, [toast]);
  const openFilesRef = useRef(openFiles);
  useEffect(() => { openFilesRef.current = openFiles; }, [openFiles]);

  /* ── actions ── */
  const addText = async () => {
    await eng()?.addText(DEFAULT_TEXT);
    setTimeout(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.select();
    }, 50);
  };
  const addShape = (k: ShapeKind) => eng()?.addShape(k);

  /** Download a finished file and show the export-complete box (or a toast if the user turned it off). */
  const finishExport = (kind: ExportInfo["kind"], file: string, blob: Blob, shapeCount: number, hiddenLayerNames: string[]) => {
    const engine = eng();
    if (!engine) return;
    lastExport.current = { blob, file };
    download(blob, file);
    const layers = engine.getState().layers.filter((l) => l.visible && l.count > 0 && (kind === "svg" || l.operation !== "image"));
    if (exportDialogSkipped()) {
      toast("ok", `Saved ${file} to Downloads (${shapeCount} shapes, ${engine.board.w} × ${engine.board.h} mm).`);
      if (hiddenLayerNames.length) toast("warn", `Hidden layers were left out: ${hiddenLayerNames.join(", ")}.`);
      return;
    }
    setExported({ kind, file, shapeCount, board: { ...engine.board }, layers, hiddenLayerNames });
  };

  const exportSvg = () => {
    const engine = eng();
    if (!engine) return;
    const { svg, shapeCount, hiddenLayerNames } = engine.exportSvg();
    if (!shapeCount) {
      toast("warn", "There's nothing to export yet. Open a file or add some text first.");
      return;
    }
    finishExport("svg", `${slugify(engine.projectName)}.svg`, new Blob([svg], { type: "image/svg+xml" }), shapeCount, hiddenLayerNames);
  };

  const exportLac = async () => {
    const engine = eng();
    if (!engine) return;
    const { shapes, skippedImages, hiddenLayerNames } = engine.lacShapes();
    const result = shapes.length ? await buildLac({ title: engine.projectName, shapes }) : null;
    if (!result) {
      toast("warn", skippedImages
        ? "Photos can't go into a Bambu .lac file yet. Export SVG instead, or add some shapes or text."
        : "There's nothing to export yet. Open a file or add some text first.");
      return;
    }
    if (skippedImages) toast("warn", `${skippedImages} photo${skippedImages > 1 ? "s were" : " was"} left out: .lac export doesn't include photos yet. Export SVG keeps them.`);
    finishExport("lac", `${slugify(engine.projectName)}.lac`, result.blob, shapes.length, hiddenLayerNames);
  };

  const download = (blob: Blob, file: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const newProject = () => {
    if (state && !state.isEmpty && !window.confirm("Start a new design? The current one will be cleared (you can undo).")) return;
    eng()?.newProject();
  };

  /* ── keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const engine = eng();
      if (!engine) return;
      if (document.querySelector('[aria-modal="true"]')) return; // a dialog is open
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const step = e.shiftKey ? 10 : 1;

      if (k === "delete" || k === "backspace") { e.preventDefault(); engine.deleteSelected(); }
      else if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); engine.undo(); }
      else if (mod && ((k === "z" && e.shiftKey) || k === "y")) { e.preventDefault(); engine.redo(); }
      else if (mod && k === "d") { e.preventDefault(); engine.duplicateSelected(); }
      else if (mod && k === "g" && !e.shiftKey) { e.preventDefault(); engine.groupSelected(); }
      else if (mod && k === "g" && e.shiftKey) { e.preventDefault(); engine.ungroupSelected(); }
      else if (mod && k === "a") { e.preventDefault(); engine.selectAll(); }
      else if (mod && k === "o") { e.preventDefault(); fileInputRef.current?.click(); }
      else if (mod && k === "s") { e.preventDefault(); exportSvg(); }
      else if (mod && k === "0") { e.preventDefault(); engine.zoomToFit(); }
      else if (mod && (k === "=" || k === "+")) { e.preventDefault(); engine.zoomBy(1.25); }
      else if (mod && k === "-") { e.preventDefault(); engine.zoomBy(0.8); }
      else if (k === "arrowleft") { e.preventDefault(); engine.nudge(-step, 0); }
      else if (k === "arrowright") { e.preventDefault(); engine.nudge(step, 0); }
      else if (k === "arrowup") { e.preventDefault(); engine.nudge(0, -step); }
      else if (k === "arrowdown") { e.preventDefault(); engine.nudge(0, step); }
      else if (k === "escape") { engine.canvas.discardActiveObject(); engine.canvas.requestRenderAll(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // exportSvg reads from the engine ref, so it's safe to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sel = state?.selection;
  const hasSel = !!sel && sel.count > 0;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* ── Top bar ── */}
      <AppHeader
        active="studio"
        title={
          <input
            value={state?.projectName ?? ""}
            onChange={(e) => {
              const engine = eng();
              if (!engine) return;
              engine.projectName = e.target.value;
              setState(engine.getState());
            }}
            onBlur={() => eng()?.commit()}
            className="w-full bg-transparent text-sm font-medium px-2 py-1 rounded-md border border-transparent hover:border-border focus:border-dd-gold-400/50 focus:outline-none"
            aria-label="Design name"
          />
        }
        actions={
          <>
            <button onClick={newProject} className="btn-ghost" title="New design">
              <FilePlus className="w-4 h-4" /> <span className="hidden md:inline">New</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="btn-ghost" title="Open .lac, .svg or .dxf (⌘O)">
              <FolderOpen className="w-4 h-4" /> <span className="hidden md:inline">Open</span>
            </button>
            <button onClick={exportSvg} className="btn-export" title="Export SVG for LightBurn, xTool, Glowforge… (⌘S)">
              <Download className="w-4 h-4" /> Export SVG
            </button>
            <button onClick={exportLac} className="btn-export" title="Export a Bambu Suite project (.lac)">
              <Download className="w-4 h-4" /> Export .lac
            </button>
          </>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={OPEN_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) openFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex-1 flex min-h-0">
        {/* ── Tool rail ── */}
        <aside className="w-[68px] shrink-0 border-r border-border bg-background-raised flex flex-col items-center py-3 gap-1 overflow-y-auto">
          <ToolButton label="Text" onClick={addText}><Type className="w-5 h-5" /></ToolButton>
          <Divider />
          <ToolButton label="Box" onClick={() => addShape("rect")}><Square className="w-5 h-5" /></ToolButton>
          <ToolButton label="Circle" onClick={() => addShape("circle")}><Circle className="w-5 h-5" /></ToolButton>
          <ToolButton label="Heart" onClick={() => addShape("heart")}><Heart className="w-5 h-5" /></ToolButton>
          <ToolButton label="Star" onClick={() => addShape("star")}><Star className="w-5 h-5" /></ToolButton>
          <Divider />
          <ToolButton label="Undo" onClick={() => eng()?.undo()} disabled={!state?.canUndo}><Undo2 className="w-5 h-5" /></ToolButton>
          <ToolButton label="Redo" onClick={() => eng()?.redo()} disabled={!state?.canRedo}><Redo2 className="w-5 h-5" /></ToolButton>
          <Divider />
          <ToolButton label="Copy" onClick={() => eng()?.duplicateSelected()} disabled={!hasSel}><Copy className="w-5 h-5" /></ToolButton>
          <ToolButton label="Center" onClick={() => eng()?.centerSelectionOnBoard()} disabled={!hasSel}><Crosshair className="w-5 h-5" /></ToolButton>
          <ToolButton label="Group" onClick={() => eng()?.groupSelected()} disabled={sel?.kind !== "multi"}><GroupIcon className="w-5 h-5" /></ToolButton>
          <ToolButton label="Ungroup" onClick={() => eng()?.ungroupSelected()} disabled={sel?.kind !== "group"}><Ungroup className="w-5 h-5" /></ToolButton>
          <ToolButton label="Delete" onClick={() => eng()?.deleteSelected()} disabled={!hasSel} danger><Trash2 className="w-5 h-5" /></ToolButton>
        </aside>

        {/* ── Canvas ── */}
        <main
          ref={containerRef}
          className="flex-1 relative min-w-0 bg-[#161B26]"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) openFiles(e.dataTransfer.files);
          }}
        >
          <canvas ref={canvasRef} />

          {state?.isEmpty && !busy && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="pointer-events-auto text-center max-w-sm rounded-2xl border border-border bg-card/95 backdrop-blur p-7 shadow-2xl">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-dd-gold-400/10 text-dd-gold-400 flex items-center justify-center">
                  <FolderOpen className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-bold mb-1">Start a design</h2>
                <p className="text-sm text-foreground-muted mb-5">Drop a Bambu <b>.lac</b>, <b>.svg</b> or <b>.dxf</b> file anywhere here, or start from scratch.</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12]">Open a file</button>
                  <button onClick={addText} className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:border-dd-gold-400/40">Add text</button>
                </div>
              </div>
            </div>
          )}

          {dragging && (
            <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-dd-gold-400 bg-dd-gold-400/10 flex items-center justify-center pointer-events-none">
              <span className="text-dd-gold-400 font-semibold">Drop to open</span>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-xl bg-card border border-border px-5 py-3">
                <div className="w-4 h-4 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">{busy}</span>
              </div>
            </div>
          )}

          {/* zoom */}
          <div className="absolute left-3 bottom-3 flex items-center gap-1 rounded-lg bg-card/95 border border-border p-1 shadow-lg">
            <IconBtn title="Zoom out (⌘-)" onClick={() => eng()?.zoomBy(0.8)}><ZoomOut className="w-4 h-4" /></IconBtn>
            <span className="text-[11px] font-mono w-12 text-center text-foreground-muted">{state?.zoomPct ?? 100}%</span>
            <IconBtn title="Zoom in (⌘+)" onClick={() => eng()?.zoomBy(1.25)}><ZoomIn className="w-4 h-4" /></IconBtn>
            <IconBtn title="Fit to screen (⌘0)" onClick={() => eng()?.zoomToFit()}><Maximize className="w-4 h-4" /></IconBtn>
          </div>
          <div className="absolute right-3 bottom-3 text-[10px] text-foreground-muted/80 hidden lg:block">
            Pinch or ⌘-scroll to zoom · scroll to move around · arrows nudge 1 mm (⇧ = 10 mm)
          </div>

          {/* toasts */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-[min(520px,90%)] pointer-events-none">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`pointer-events-auto rounded-xl px-4 py-2.5 text-sm shadow-xl border ${
                  t.tone === "ok" ? "bg-card border-emerald-500/40 text-foreground"
                  : t.tone === "warn" ? "bg-card border-dd-gold-400/50 text-foreground"
                  : "bg-card border-red-500/60 text-foreground"
                }`}
              >
                {t.text}
              </div>
            ))}
          </div>
        </main>

        {/* ── Right panel ── */}
        <aside className="w-[300px] shrink-0 border-l border-border bg-background-raised overflow-y-auto">
          {state && eng() && (
            <>
              <SelectionPanel state={state} engine={eng()!} textAreaRef={textAreaRef} />
              <LayersPanel state={state} engine={eng()!} />
              <BoardPanel state={state} engine={eng()!} />
            </>
          )}
        </aside>
      </div>

      {exported && (
        <ExportDoneDialog
          info={exported}
          onClose={() => setExported(null)}
          onDownloadAgain={() => lastExport.current && download(lastExport.current.blob, lastExport.current.file)}
          onNewDesign={() => { setExported(null); eng()?.newProject(); }}
          onConvertPhoto={() => { setExported(null); router.push("/dashboard"); }}
        />
      )}

      <style jsx global>{`
        .panel-title {
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--dd-gold-400);
        }
      `}</style>
    </div>
  );
}

function ToolButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`w-14 py-1.5 rounded-lg flex flex-col items-center gap-0.5 text-foreground-muted transition-colors disabled:opacity-25 disabled:pointer-events-none ${
        danger ? "hover:text-red-400 hover:bg-red-400/10" : "hover:text-dd-gold-400 hover:bg-dd-gold-400/10"
      }`}
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="w-8 h-px bg-border my-1.5" />;
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="p-1.5 rounded-md text-foreground-muted hover:text-dd-gold-400 hover:bg-dd-gold-400/10">
      {children}
    </button>
  );
}

function BoardPanel({ state, engine }: { state: EngineState; engine: StudioEngine }) {
  return (
    <section className="p-4 border-t border-border">
      <h3 className="panel-title">Work area</h3>
      <div className="flex items-center gap-2 mt-3">
        <MmInput label="W" value={state.board.w} onCommit={(v) => engine.setBoardSize(v, state.board.h)} />
        <span className="text-foreground-muted text-xs">×</span>
        <MmInput label="H" value={state.board.h} onCommit={(v) => engine.setBoardSize(state.board.w, v)} />
      </div>
      <button
        onClick={() => engine.fitBoardToDesign()}
        disabled={state.isEmpty}
        className="mt-3 w-full py-2 rounded-lg text-xs font-medium border border-border text-foreground-muted hover:text-dd-gold-400 hover:border-dd-gold-400/40 disabled:opacity-30"
      >
        Shrink work area to fit design
      </button>
      <p className="text-[10px] text-foreground-muted mt-2 leading-relaxed">The exported SVG is exactly this size, in millimetres.</p>
    </section>
  );
}
