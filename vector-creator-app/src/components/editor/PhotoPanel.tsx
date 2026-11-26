"use client";

import { useEffect, useState } from "react";
import { Wand2, Ruler, Sun, Contrast, Mountain, Focus, Grip, FlipVertical2, RotateCcw, Info, Sparkles, Type, Flame, Download } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { DEFAULT_ENGRAVE, DITHERS, DPI_CHOICES, MATERIALS, materialById, type MaterialId } from "@/lib/photo/engrave";
import { removeBackground, loadImage } from "@/lib/vectorizer/background-remove";
import { buildTestCard, busiestSquare, cardCropPx } from "@/lib/photo/test-card";
import { setPngDpi } from "@/lib/photo/png-dpi";
import { engraveDefaultsWithMemory, rememberedSpread } from "@/lib/photo/engrave-memory";

// Saved wood/laser settings are applied once per page load (the store starts
// with plain defaults so the server render matches). New images get them from
// resetWorkspace.
let memoryApplied = false;

/** Convert's side panel in Photo engrave mode. */
export default function PhotoPanel({ disabled }: { disabled: boolean }) {
  const { originalImage, cutoutImage, setCutoutImage, engrave, setEngrave, photoOutput } = useEditorStore();
  const [bgBusy, setBgBusy] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const mat = materialById(engrave.material);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  /** Burn spread test card: rows 0-5 of the user's photo crop plus grey steps, as a laser PNG. */
  const downloadTestCard = async () => {
    const source = engrave.removeBackground ? cutoutImage : originalImage;
    if (!source) return;
    setCardBusy(true);
    setCardError(null);
    try {
      const img = await loadImage(source);
      // Find the busiest mid-tone square (usually the eyes) on a small copy.
      const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
      const sc = document.createElement("canvas");
      sc.width = Math.max(1, Math.round(img.naturalWidth * k));
      sc.height = Math.max(1, Math.round(img.naturalHeight * k));
      const sctx = sc.getContext("2d", { willReadFrequently: true })!;
      if (!engrave.removeBackground) { sctx.fillStyle = "#ffffff"; sctx.fillRect(0, 0, sc.width, sc.height); }
      sctx.drawImage(img, 0, 0, sc.width, sc.height);
      const sq = busiestSquare(sctx.getImageData(0, 0, sc.width, sc.height).data, sc.width, sc.height);
      const side = sq.side * Math.min(img.naturalWidth, img.naturalHeight);
      const cs = cardCropPx(engrave.dpi);
      const c = document.createElement("canvas");
      c.width = c.height = cs;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = "high";
      if (!engrave.removeBackground) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cs, cs); }
      ctx.drawImage(img, sq.x * img.naturalWidth, sq.y * img.naturalHeight, side, side, 0, 0, cs, cs);
      const card = buildTestCard(ctx.getImageData(0, 0, cs, cs).data, engrave);
      const out = document.createElement("canvas");
      out.width = card.w;
      out.height = card.h;
      const octx = out.getContext("2d")!;
      const id = octx.createImageData(card.w, card.h);
      for (let p = 0, i = 0; p < card.pixels.length; p++, i += 4) {
        id.data[i] = id.data[i + 1] = id.data[i + 2] = card.pixels[p];
        id.data[i + 3] = 255;
      }
      octx.putImageData(id, 0, 0);
      const raw = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("PNG failed"))), "image/png"));
      const blob = new Blob([setPngDpi(new Uint8Array(await raw.arrayBuffer()), engrave.dpi) as BlobPart], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vectorease-test-card-${engrave.material}-${engrave.dpi}dpi.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Couldn't make the test card.");
    } finally {
      setCardBusy(false);
    }
  };

  const toggleBackground = async () => {
    if (engrave.removeBackground) { setEngrave({ removeBackground: false }); return; }
    if (cutoutImage) { setEngrave({ removeBackground: true }); return; }
    if (!originalImage) return;
    setBgError(null);
    setBgBusy("Loading the AI model...");
    try {
      const url = await removeBackground(originalImage, setBgBusy);
      setCutoutImage(url);
      setEngrave({ removeBackground: true });
    } catch (err) {
      setBgError(err instanceof Error ? err.message : "Background removal failed.");
    } finally {
      setBgBusy(null);
    }
  };

  const pickMaterial = (id: MaterialId) => {
    const m = materialById(id);
    setEngrave({ material: id, invert: m.invert, dither: m.dither, burnSpread: rememberedSpread(id) });
  };

  useEffect(() => {
    if (memoryApplied) return;
    memoryApplied = true;
    const mem = engraveDefaultsWithMemory();
    const cur = useEditorStore.getState().engrave;
    // Only if the user hasn't changed these yet on this page.
    if (cur.material === DEFAULT_ENGRAVE.material && cur.dpi === DEFAULT_ENGRAVE.dpi && (cur.burnSpread ?? 0) === 0) {
      setEngrave({ material: mem.material, invert: mem.invert, dither: mem.dither, dpi: mem.dpi, burnSpread: mem.burnSpread });
    }
  }, [setEngrave]);

  const heightMm = photoOutput ? Math.round((photoOutput.h / photoOutput.w) * engrave.widthMm) : null;
  const interval = (25.4 / engrave.dpi).toFixed(2);

  return (
    <div className="px-5 py-5 space-y-6">
      {/* Background */}
      <div className={`rounded-xl border p-3 ${engrave.removeBackground ? "border-dd-gold-400/40 bg-dd-gold-400/[0.04]" : "border-border"}`}>
        <div className="flex items-center gap-2">
          <Wand2 className="w-3.5 h-3.5 text-dd-gold-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Remove background</span>
          <Switch on={engrave.removeBackground} onClick={toggleBackground} disabled={disabled || !!bgBusy} label="Remove background" />
        </div>
        <p className="text-[11px] text-foreground-muted mt-1.5 leading-relaxed">
          {bgBusy ?? "AI keeps the person, pet or object and leaves the rest unburned. Runs on your computer; the first time downloads a 44 MB model."}
        </p>
        {bgBusy && <div className="mt-2 h-1 rounded-full bg-border overflow-hidden"><div className="h-full w-1/3 bg-dd-gold-400 animate-pulse" /></div>}
        {bgError && <p className="mt-2 text-[11px] text-red-400">{bgError}</p>}
        {engrave.removeBackground && (
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-foreground mb-1.5">Keep</div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { main: true, label: "Main subject" },
                { main: false, label: "Everything it found" },
              ].map((k) => (
                <button
                  key={k.label}
                  onClick={() => setEngrave({ mainSubjectOnly: k.main })}
                  disabled={disabled}
                  className={`py-1.5 px-1 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-40 ${
                    (engrave.mainSubjectOnly ?? true) === k.main ? "border-dd-gold-400/50 bg-dd-gold-400/10 text-dd-gold-400" : "border-border text-foreground-muted hover:bg-card-hover"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-foreground-muted mt-1.5 leading-relaxed">
              Main subject keeps only the person or pet. Everything also keeps other objects, and burns white text and logos dark so they show on bare wood. For dark posters with white text, leave Remove background off: the burned background makes the white parts stand out.
            </p>
          </div>
        )}
      </div>

      {/* Material */}
      <div>
        <Label icon={Grip} text="Material" />
        <div className="grid grid-cols-3 gap-1.5">
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              onClick={() => pickMaterial(m.id)}
              disabled={disabled}
              className={`py-1.5 px-1 rounded-lg text-[11px] font-medium border flex items-center gap-1.5 justify-center transition-all disabled:opacity-40 ${
                engrave.material === m.id ? "border-dd-gold-400/50 bg-dd-gold-400/10 text-dd-gold-400" : "border-border text-foreground-muted hover:bg-card-hover"
              }`}
            >
              <span className="w-3 h-3 rounded-sm border border-white/10 shrink-0" style={{ background: m.base }} />
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-foreground-muted mt-1.5 leading-relaxed">{mat.hint}</p>
      </div>

      {/* Size */}
      <div>
        <Label icon={Ruler} text="Size" />
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={1000}
            value={engrave.widthMm}
            onChange={(e) => setEngrave({ widthMm: Math.max(10, Math.min(1000, Number(e.target.value) || 10)) })}
            disabled={disabled}
            aria-label="Width in millimetres"
            className="w-20 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50"
          />
          <span className="text-xs text-foreground-muted">mm wide{heightMm ? ` × ${heightMm} mm tall` : ""}</span>
        </div>
        <select
          value={engrave.dpi}
          onChange={(e) => setEngrave({ dpi: Number(e.target.value) })}
          disabled={disabled}
          aria-label="Laser resolution"
          className="mt-2 w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50"
        >
          {DPI_CHOICES.map((d) => <option key={d.dpi} value={d.dpi}>{d.label}: {d.hint}</option>)}
        </select>
      </div>

      {/* Tone */}
      <div className="space-y-4">
        <Slider icon={Sun} label="Brightness" value={engrave.brightness} min={-50} max={50} onChange={(v) => setEngrave({ brightness: v })} disabled={disabled} />
        <Slider icon={Contrast} label="Contrast" value={engrave.contrast} min={-50} max={50} onChange={(v) => setEngrave({ contrast: v })} disabled={disabled} />
        <Slider icon={Mountain} label="Depth" hint="Brings out shadows and highlights in faces and fur" value={engrave.depth} min={0} max={100} onChange={(v) => setEngrave({ depth: v })} disabled={disabled} />
        <Slider icon={Focus} label="Sharpness" value={engrave.detail} min={0} max={100} onChange={(v) => setEngrave({ detail: v })} disabled={disabled} />
      </div>

      {/* Burn spread */}
      <div className="rounded-xl border border-border p-3">
        <Slider
          icon={Flame}
          label="Burn spread"
          hint="If eyes and skin burn too dark, raise this. Each laser dot burns wider than it should on many woods, so the mid-tones fill in. Higher fires fewer dots in the mid-tones; pure black and white stay the same. 0 = off. Remembered for each material, so set it once per wood."
          value={engrave.burnSpread ?? 0}
          min={0}
          max={5}
          onChange={(v) => setEngrave({ burnSpread: v })}
          disabled={disabled}
        />
        <button
          onClick={downloadTestCard}
          disabled={disabled || cardBusy || !originalImage}
          className="mt-3 w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-dd-gold-400/40 text-dd-gold-400 hover:bg-dd-gold-400/10 disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" /> {cardBusy ? "Making test card..." : "Download test card"}
        </button>
        <p className="text-[10px] text-foreground-muted mt-1.5 leading-relaxed">
          Burn this small strip on a scrap of the same wood first, with the same laser settings. Rows 0 to 5 are each Burn spread level, with a crop of your photo and five grey steps. Pick the row that looks most like the photo and set Burn spread to that number.
        </p>
        {cardError && <p className="mt-1.5 text-[11px] text-red-400">{cardError}</p>}
      </div>

      {/* Dots */}
      <div>
        <Label icon={Grip} text="Dot style" />
        <select
          value={engrave.dither}
          onChange={(e) => setEngrave({ dither: e.target.value as typeof engrave.dither })}
          disabled={disabled}
          aria-label="Dot style"
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50"
        >
          {DITHERS.map((d) => <option key={d.id} value={d.id}>{d.label}: {d.hint}</option>)}
        </select>
        <label className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <FlipVertical2 className="w-3.5 h-3.5 text-dd-gold-400" />
          Flip light and dark
          <Switch on={engrave.invert} onClick={() => setEngrave({ invert: !engrave.invert })} disabled={disabled} label="Flip light and dark" />
        </label>
        <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">On for slate and dark metal, where the laser makes light marks.</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <Type className="w-3.5 h-3.5 text-dd-gold-400" />
          Crisp text and logos
          <Switch on={engrave.crispGraphics ?? false} onClick={() => setEngrave({ crispGraphics: !(engrave.crispGraphics ?? false) })} disabled={disabled} label="Crisp text and logos" />
        </label>
        <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">Experimental, off by default. Burns sharp lettering and logos solid instead of as dots; can also harden parts of the photo.</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <Sparkles className="w-3.5 h-3.5 text-dd-gold-400" />
          Clean up lone dots
          <Switch on={engrave.cleanDots ?? true} onClick={() => setEngrave({ cleanDots: !(engrave.cleanDots ?? true) })} disabled={disabled} label="Clean up lone dots" />
        </label>
        <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">Removes single stray dots in light areas. They burn shallow and sand off unevenly, so light areas stay clean.</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <Sparkles className="w-3.5 h-3.5 text-dd-gold-400" />
          Solid black backgrounds
          <Switch on={engrave.solidBlacks ?? true} onClick={() => setEngrave({ solidBlacks: !(engrave.solidBlacks ?? true) })} disabled={disabled} label="Solid black backgrounds" />
        </label>
        <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">Black areas of the photo burn as one even fill instead of a scatter of light dots. Turn off to keep faint texture in dark backgrounds.</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <Contrast className="w-3.5 h-3.5 text-dd-gold-400" />
          Invert background
          <Switch on={!!engrave.invertBackground} onClick={() => setEngrave({ invertBackground: !engrave.invertBackground })} disabled={disabled || engrave.removeBackground} label="Invert background" />
        </label>
        <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">{engrave.removeBackground ? "Turn off Remove background to use this." : "For quote posters on a plain black background: the background stays bare wood, the white lettering burns dark, and the photo stays as it is. Faster to burn too."}</p>
      </div>

      <button
        onClick={() => setEngrave({ ...DEFAULT_ENGRAVE, removeBackground: engrave.removeBackground, mainSubjectOnly: engrave.mainSubjectOnly, widthMm: engrave.widthMm, dpi: engrave.dpi, burnSpread: engrave.burnSpread, material: engrave.material, invert: mat.invert, dither: mat.dither })}
        disabled={disabled}
        className="w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:text-foreground disabled:opacity-40"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset adjustments
      </button>

      <div className="rounded-lg border border-dd-blue-400/20 bg-dd-blue-400/[0.04] p-3 text-[11px] text-foreground-muted leading-relaxed">
        <Info className="inline w-3.5 h-3.5 text-dd-blue-400 mr-1 -mt-0.5" />
        The PNG opens at {engrave.widthMm} mm wide. In LightBurn, set the image mode to <b className="text-foreground">Passthrough</b> and the line interval to <b className="text-foreground">{interval} mm</b>. The dots are already done for you.
      </div>
    </div>
  );
}

function Label({ icon: Icon, text }: { icon: typeof Sun; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5 text-dd-gold-400" />
      <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{text}</span>
    </div>
  );
}

function Switch({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`ml-auto relative w-9 h-5 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-dd-gold-400" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

function Slider({ icon: Icon, label, hint, value, min, max, onChange, disabled }: {
  icon: typeof Sun; label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-dd-gold-400" />
        <span className="text-[11px] font-semibold text-foreground">{label}</span>
        <span className="ml-auto text-[10px] font-mono text-dd-gold-400">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(parseInt(e.target.value))} disabled={disabled} aria-label={label} />
      {hint && <p className="text-[10px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  );
}
