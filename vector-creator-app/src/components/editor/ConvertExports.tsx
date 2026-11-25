"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, FileCode2, FilePlus, Flame, FolderOpen, ImagePlus, LayoutTemplate } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { useAuth } from "@/components/auth/AuthContext";
import PricingDialog from "@/components/PricingDialog";
import ExportDoneDialog, { exportDialogSkipped, type ExportInfo } from "@/components/studio/ExportDoneDialog";
import { importSvg } from "@/lib/studio/import-svg";
import { buildLac, type LacShape } from "@/lib/studio/export-lac";
import { setPendingStudioFiles } from "@/lib/studio/handoff";
import { svgToDxf } from "@/lib/vectorizer/svg-to-dxf";
import { svgToLbrn2, defaultPresetForMode } from "@/lib/vectorizer/svg-to-lbrn2";
import { colorName, parseLayers, stripHiddenLayers } from "@/lib/vectorizer/svg-layers";
import { setPngDpi } from "@/lib/photo/png-dpi";
import {
  computeImageFingerprint,
  evaluateDownload,
  markImageDownloaded,
  getVectorizationsRemaining,
  FREE_VECTORIZATIONS,
} from "@/lib/firebase/users";

/** Longest side of a Convert result when it opens in the Studio (the user can resize it there). */
const STUDIO_SIZE_MM = 200;

function saveBlob(blob: Blob, file: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Kind = ExportInfo["kind"];

/**
 * Convert's export buttons, in the top bar like the Studio's:
 * Open in Studio · Export SVG · Export .lac · More (LightBurn, DXF).
 * Every export goes through the free-trial check (5 free images, then the paywall).
 */
export default function ConvertExports() {
  const router = useRouter();
  const { user, userRecord } = useAuth();
  const { resultSvg, layerSettings, hiddenLayers, originalImage, requestOpen, requestClear, convertMode, photoOutput } = useEditorStore();
  const photo = convertMode === "photo";
  const [busy, setBusy] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exported, setExported] = useState<ExportInfo | null>(null);
  const lastExport = useRef<{ blob: Blob; file: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isPaidOrAdmin = userRecord?.role === "superadmin" || userRecord?.subscriptionStatus === "active";
  const remaining = userRecord ? getVectorizationsRemaining(userRecord) : 0;
  const layers = useMemo(() => (resultSvg ? parseLayers(resultSvg) : []), [resultSvg]);
  const visibleLayers = layers.filter((l) => !hiddenLayers.has(l.color));
  const ready = !!resultSvg && visibleLayers.length > 0 && !busy;
  const photoReady = !!photoOutput && !busy;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const layerName = (hex: string) => layerSettings[hex]?.name ?? colorName(hex);
  const exportSvg = () => stripHiddenLayers(resultSvg ?? "", hiddenLayers);

  /** Free-trial gate: same image downloaded again in another format counts once. */
  const gated = async (fn: () => Promise<void> | void) => {
    if (busy || (photo ? !photoOutput : !resultSvg)) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      if (!user || !user.email || !userRecord || !originalImage) {
        await fn();
        return;
      }
      const fingerprint = await computeImageFingerprint(originalImage);
      const decision = evaluateDownload(userRecord, fingerprint);
      if (!decision.allow) {
        setShowPaywall(true);
        return;
      }
      await fn();
      if (!decision.alreadyDownloaded) {
        markImageDownloaded(user.uid, user.email, fingerprint).catch((err) =>
          console.error("[ConvertExports] markImageDownloaded failed", err)
        );
      }
    } catch (err) {
      console.error("[ConvertExports]", err);
      alert("Sorry, that export didn't work. Try Export SVG, which opens in almost every laser program.");
    } finally {
      setBusy(false);
    }
  };

  const finish = (kind: Kind, file: string, blob: Blob) => {
    lastExport.current = { blob, file };
    saveBlob(blob, file);
    if (exportDialogSkipped()) return;
    const shapeCount = visibleLayers.reduce((n, l) => n + l.pathCount, 0);
    setExported({
      kind,
      file,
      shapeCount,
      layers: visibleLayers.map((l) => ({ id: l.color, name: layerName(l.color), color: l.color, operation: "engrave", visible: true, count: l.pathCount })),
      hiddenLayerNames: layers.filter((l) => hiddenLayers.has(l.color)).map((l) => layerName(l.color)),
    });
  };

  /** Photo engrave: the dotted image as a PNG that opens at the chosen size (DPI stamped in). */
  const photoPngBlob = async (): Promise<Blob> => {
    if (!photoOutput) throw new Error("No photo engrave yet");
    const { pixels, w, h, dpi } = photoOutput;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let p = 0, i = 0; p < pixels.length; p++, i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = pixels[p];
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const raw = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG failed"))), "image/png"));
    const stamped = setPngDpi(new Uint8Array(await raw.arrayBuffer()), dpi);
    return new Blob([stamped as BlobPart], { type: "image/png" });
  };

  const doPng = async () => {
    if (!photoOutput) return;
    const blob = await photoPngBlob();
    const file = "vectorease-photo-engrave.png";
    lastExport.current = { blob, file };
    saveBlob(blob, file);
    if (exportDialogSkipped()) return;
    setExported({
      kind: "png",
      file,
      shapeCount: 0,
      board: { w: Math.round(photoOutput.widthMm), h: Math.round((photoOutput.h / photoOutput.w) * photoOutput.widthMm) },
      layers: [],
      hiddenLayerNames: [],
    });
  };

  /** Photo engrave into the Studio as an image engrave, at its real size. */
  const doPhotoToStudio = async () => {
    if (!photoOutput) return;
    const blob = await photoPngBlob();
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
    const wMm = +photoOutput.widthMm.toFixed(2);
    const hMm = +((photoOutput.h / photoOutput.w) * photoOutput.widthMm).toFixed(2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}"><image href="${dataUrl}" x="0" y="0" width="${wMm}" height="${hMm}"/></svg>`;
    setPendingStudioFiles([new File([svg], "Photo engrave.svg", { type: "image/svg+xml" })]);
    router.push("/studio");
  };

  const doSvg = () => finish("svg", "vectorease-design.svg", new Blob([exportSvg()], { type: "image/svg+xml" }));

  const doLbrn2 = () => {
    const configs = visibleLayers.map((l) => {
      const s = layerSettings[l.color];
      const preset = defaultPresetForMode("Line");
      return {
        color: l.color,
        name: s?.name ?? colorName(l.color),
        mode: s?.mode ?? "Line",
        speedMmMin: s?.speedMmMin ?? preset.speedMmMin,
        powerPct: s?.powerPct ?? preset.powerPct,
      };
    });
    finish("lbrn2", "vectorease-design.lbrn2", new Blob([svgToLbrn2(exportSvg(), { layers: configs })], { type: "application/xml" }));
  };

  const doDxf = () => finish("dxf", "vectorease-design.dxf", new Blob([svgToDxf(exportSvg())], { type: "application/dxf" }));

  /** Bambu Suite: layers in Line mode become Laser Line (score); Fill modes become Laser Fill (engrave). */
  const doLac = async () => {
    const design = await importSvg(new Blob([exportSvg()], { type: "image/svg+xml" }), "vectorease-design.svg");
    const shapes: LacShape[] = [];
    for (const item of design.items) {
      if (item.kind !== "path") continue;
      const color = (item.sourceColor ?? "#000000").toUpperCase();
      const mode = layerSettings[color]?.mode ?? "Line";
      shapes.push({ d: item.d, operation: mode === "Line" ? "score" : "engrave", color, name: layerName(color) });
    }
    const result = await buildLac({ title: "VectorEase design", shapes });
    if (!result) throw new Error("Nothing to put in the .lac file");
    finish("lac", "vectorease-design.lac", result.blob);
  };

  /** Send the result to the Studio, one Studio layer per colour, sized to 200 mm on its longest side. */
  const doOpenInStudio = () => {
    let svg = exportSvg();
    const vb = svg.match(/viewBox="([\d.\s-]+)"/)?.[1].trim().split(/\s+/).map(Number);
    if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      const k = STUDIO_SIZE_MM / Math.max(vb[2], vb[3]);
      const w = +(vb[2] * k).toFixed(2), h = +(vb[3] * k).toFixed(2);
      svg = svg.replace(/(<svg[^>]*?)\swidth="[^"]*"/, `$1 width="${w}mm"`).replace(/(<svg[^>]*?)\sheight="[^"]*"/, `$1 height="${h}mm"`);
    }
    const layerColors: Record<string, { name: string; operation: "score" | "engrave" }> = {};
    for (const l of visibleLayers) {
      layerColors[l.color] = { name: layerName(l.color), operation: (layerSettings[l.color]?.mode ?? "Line") === "Line" ? "score" : "engrave" };
    }
    setPendingStudioFiles([new File([svg], "Converted design.svg", { type: "image/svg+xml" })], { layerColors });
    router.push("/studio");
  };

  const why = !resultSvg ? "Upload an image and click Apply & Vectorize first" : visibleLayers.length ? undefined : "Every layer is hidden";

  return (
    <>
      {!isPaidOrAdmin && userRecord && (
        <span className={`hidden lg:inline text-[11px] font-medium whitespace-nowrap ${remaining <= 1 ? "text-dd-gold-400" : "text-foreground-muted"}`}>
          {remaining} of {FREE_VECTORIZATIONS} free left
        </span>
      )}
      <button onClick={() => requestClear()} disabled={!originalImage || busy} className="btn-ghost" title="Start over with a new image">
        <FilePlus className="w-4 h-4" /> <span className="hidden md:inline">New</span>
      </button>
      <button onClick={() => requestOpen()} disabled={busy} className="btn-ghost" title="Open an image (or a .lac, .svg, .dxf laser file)">
        <FolderOpen className="w-4 h-4" /> <span className="hidden md:inline">Open</span>
      </button>
      {photo ? (
        <>
          <button onClick={() => gated(doPhotoToStudio)} disabled={!photoReady} className="btn-ghost" title={photoOutput ? "Add names, dates, shapes or a cut-out border in the Studio" : "Upload a photo first"}>
            <LayoutTemplate className="w-4 h-4" /> <span className="hidden lg:inline">Open in Studio</span>
          </button>
          <button onClick={() => gated(doPng)} disabled={!photoReady} className="btn-export" title={photoOutput ? "Laser-ready PNG for LightBurn, xTool, Bambu Suite…" : "Upload a photo first"}>
            <Download className="w-4 h-4" /> Export PNG
          </button>
        </>
      ) : (<>
      <button onClick={() => gated(doOpenInStudio)} disabled={!ready} className="btn-ghost" title={why ?? "Add names, dates, shapes or a cut line in the Studio"}>
        <LayoutTemplate className="w-4 h-4" /> <span className="hidden lg:inline">Open in Studio</span>
      </button>
      <button onClick={() => gated(doSvg)} disabled={!ready} className="btn-export" title={why ?? "Export SVG for LightBurn, xTool, Glowforge…"}>
        <Download className="w-4 h-4" /> Export SVG
      </button>
      <button onClick={() => gated(doLac)} disabled={!ready} className="btn-export" title={why ?? "Export a Bambu Suite project (.lac)"}>
        <Download className="w-4 h-4" /> Export .lac
      </button>
      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenuOpen((o) => !o)} disabled={!ready} className="btn-export px-3" aria-haspopup="menu" aria-expanded={menuOpen} title={why ?? "More export formats"}>
          More <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-background-raised shadow-2xl p-1.5 z-50">
            <MenuItem icon={Flame} label="LightBurn (.lbrn2)" hint="Layer names, speed and power already set" onClick={() => gated(doLbrn2)} />
            <MenuItem icon={FileCode2} label="DXF" hint="For CAD software and older laser programs" onClick={() => gated(doDxf)} />
          </div>
        )}
      </div>
      </>)}

      {exported && (
        <ExportDoneDialog
          info={exported}
          onClose={() => setExported(null)}
          onDownloadAgain={() => lastExport.current && saveBlob(lastExport.current.blob, lastExport.current.file)}
          primaryLabel="Keep tuning"
          actions={[
            { label: "Open in Studio", icon: LayoutTemplate, onClick: () => { setExported(null); if (photo) doPhotoToStudio(); else doOpenInStudio(); } },
            { label: "Convert another image", icon: ImagePlus, onClick: () => { setExported(null); requestClear(); } },
          ]}
        />
      )}

      {showPaywall && (
        <PricingDialog
          onClose={() => setShowPaywall(false)}
          title={`You've used your ${FREE_VECTORIZATIONS} free images`}
          subtitle="Keep going with unlimited images and every export."
        />
      )}
    </>
  );
}

function MenuItem({ icon: Icon, label, hint, onClick }: { icon: typeof Flame; label: string; hint: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-dd-gold-400/10">
      <Icon className="w-4 h-4 text-dd-gold-400 mt-0.5 shrink-0" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px] text-foreground-muted leading-snug">{hint}</span>
      </span>
    </button>
  );
}
