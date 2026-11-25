"use client";

import { useEffect } from "react";
import { CheckCircle2, Download, FilePlus2, ImageIcon, X, type LucideIcon } from "lucide-react";
import type { LayerWithCount } from "@/lib/studio/engine";

export interface ExportInfo {
  kind: "svg" | "lac" | "lbrn2" | "dxf" | "png";
  file: string;
  shapeCount: number;
  /** Design size in mm, when known. */
  board?: { w: number; h: number };
  layers: LayerWithCount[]; // layers that made it into the file
  hiddenLayerNames: string[];
}

const NEXT_STEPS: Record<ExportInfo["kind"], string[]> = {
  svg: [
    "Open or drag the file into your laser software (LightBurn, xTool Creative Space, Glowforge, Bambu Suite…).",
    "Each colour comes in as its own layer. Set its power and speed there.",
    "Check the size and position on the bed, then run a test on scrap first.",
  ],
  lac: [
    "Double-click the file to open it in Bambu Suite.",
    "Cut, Score and Engrave are already set as Laser Cut, Laser Line and Laser Fill. Pick your material (it starts as 3mm Birch Plywood).",
    "Click Prepare, check the preview, and test on scrap first.",
  ],
  lbrn2: [
    "Double-click the file to open it in LightBurn.",
    "Layer names, modes, speed and power are already set. Adjust them for your material.",
    "Check the size and position on the bed, then run a test on scrap first.",
  ],
  png: [
    "Import the PNG into LightBurn, xTool Creative Space or Bambu Suite. It opens at the size you picked.",
    "The dots are already done: in LightBurn set the image mode to Passthrough and the line interval shown in VectorEase. In Bambu Suite use it as an image engrave.",
    "Run a small test on scrap of the same material first, then adjust power, or Brightness in VectorEase.",
  ],
  dxf: [
    "Import the file into your laser or CAD software.",
    "DXF files don't carry laser settings. Choose cut or engrave for each layer there.",
    "Check the size and position on the bed, then run a test on scrap first.",
  ],
};

const SKIP_KEY = "vectorease-skip-export-dialog";

export function exportDialogSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

function setSkipped(skip: boolean) {
  try {
    if (skip) localStorage.setItem(SKIP_KEY, "1");
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    /* private window: just show it again next time */
  }
}

export interface ExportDoneAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export default function ExportDoneDialog({
  info, onClose, onDownloadAgain, onNewDesign, onConvertPhoto, primaryLabel = "Keep editing", actions,
}: {
  info: ExportInfo;
  onClose: () => void;
  onDownloadAgain: () => void;
  onNewDesign?: () => void;
  onConvertPhoto?: () => void;
  primaryLabel?: string;
  /** The two smaller buttons under the main one. Defaults to Start a new design / Convert a photo. */
  actions?: ExportDoneAction[];
}) {
  const buttons: ExportDoneAction[] = actions ?? [
    ...(onNewDesign ? [{ label: "Start a new design", icon: FilePlus2, onClick: onNewDesign }] : []),
    ...(onConvertPhoto ? [{ label: "Convert a photo", icon: ImageIcon, onClick: onConvertPhoto }] : []),
  ];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="export-done-title" className="relative w-full max-w-md rounded-2xl border border-border bg-background-raised shadow-2xl p-6">
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-md text-foreground-muted hover:text-foreground" aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          <h2 id="export-done-title" className="text-lg font-bold">Export complete</h2>
        </div>
        <p className="text-sm text-foreground-muted mt-2 leading-relaxed">
          <b className="text-foreground break-all">{info.file}</b> is in your <b className="text-foreground">Downloads</b> folder.
          {" "}{info.kind === "png" ? "Photo engrave" : `${info.shapeCount} shape${info.shapeCount === 1 ? "" : "s"}`}{info.board ? `, ${info.board.w} × ${info.board.h} mm` : ""}.
        </p>

        {info.kind !== "png" && <div className="mt-4 rounded-xl border border-border bg-background/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted mb-2">In this file</div>
          <ul className="space-y-1.5">
            {info.layers.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-sm border border-white/15 shrink-0" style={{ backgroundColor: l.color }} />
                <span className="font-medium">{l.name}</span>
                <span className="text-foreground-muted text-xs">({l.count} shape{l.count === 1 ? "" : "s"})</span>
              </li>
            ))}
          </ul>
          {info.hiddenLayerNames.length > 0 && (
            <p className="text-xs text-dd-gold-400 mt-2">Left out because they were hidden: {info.hiddenLayerNames.join(", ")}.</p>
          )}
        </div>}

        <div className="mt-4">
          <div className="text-sm font-semibold mb-1.5">What&apos;s next</div>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground-muted marker:text-foreground-muted">
            {NEXT_STEPS[info.kind].map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={onClose} className="sm:col-span-2 py-2.5 rounded-lg bg-dd-gold-400 text-black text-sm font-semibold hover:bg-dd-gold-300">
            {primaryLabel}
          </button>
          {buttons.map((b) => (
            <button key={b.label} onClick={b.onClick} className="inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-sm text-foreground-muted hover:text-dd-gold-400 hover:border-dd-gold-400/40">
              <b.icon className="w-4 h-4" /> {b.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-foreground-muted">
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" defaultChecked={exportDialogSkipped()} onChange={(e) => setSkipped(e.target.checked)} className="accent-[var(--dd-gold-400)]" />
            Don&apos;t show this again
          </label>
          <button onClick={onDownloadAgain} className="inline-flex items-center gap-1 hover:text-dd-gold-400">
            <Download className="w-3.5 h-3.5" /> Download again
          </button>
        </div>
      </div>
    </div>
  );
}
