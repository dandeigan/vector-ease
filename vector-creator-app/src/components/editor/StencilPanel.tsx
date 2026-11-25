"use client";

import { useState } from "react";
import { Wand2, Layers, SunDim, Focus, Link2, Spline, Play, Info } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { stencilPalette } from "@/lib/photo/stencil";
import { removeBackground } from "@/lib/vectorizer/background-remove";
import { traceStencilToSVG } from "@/lib/vectorizer/imagetracer-wrapper";
import { useAuth } from "@/components/auth/AuthContext";
import { logVectorization } from "@/lib/firebase/users";

/** Convert's side panel in Stencil mode. */
export default function StencilPanel({ disabled }: { disabled: boolean }) {
  const { user } = useAuth();
  const { originalImage, cutoutImage, setCutoutImage, stencil, setStencil, stencilFlat, setResultSvg, setResultFrom, setTraceError, isProcessing, setIsProcessing, setLoadingMessage } = useEditorStore();
  const [bgBusy, setBgBusy] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const toggleBackground = async () => {
    if (stencil.removeBackground) { setStencil({ removeBackground: false }); return; }
    if (cutoutImage) { setStencil({ removeBackground: true }); return; }
    if (!originalImage) return;
    setBgError(null);
    setBgBusy("Loading the AI model...");
    try {
      setCutoutImage(await removeBackground(originalImage, setBgBusy));
      setStencil({ removeBackground: true });
    } catch (err) {
      setBgError(err instanceof Error ? err.message : "Background removal failed.");
    } finally {
      setBgBusy(null);
    }
  };

  const makeStencil = async () => {
    if (!stencilFlat) return;
    setIsProcessing(true);
    setLoadingMessage("Making stencil vectors...");
    setTraceError(null);
    try {
      const svg = await traceStencilToSVG(stencilFlat, stencilPalette(stencil.tones), stencil.smoothness);
      setResultFrom("stencil");
      setResultSvg(svg);
      if (user?.uid) logVectorization(user.uid).catch(() => {});
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : "Making the stencil failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="px-5 py-5 space-y-6">
      {/* Background */}
      <div className={`rounded-xl border p-3 ${stencil.removeBackground ? "border-dd-gold-400/40 bg-dd-gold-400/[0.04]" : "border-border"}`}>
        <div className="flex items-center gap-2">
          <Wand2 className="w-3.5 h-3.5 text-dd-gold-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Remove background</span>
          <Switch on={stencil.removeBackground} onClick={toggleBackground} disabled={disabled || !!bgBusy} label="Remove background" />
        </div>
        <p className="text-[11px] text-foreground-muted mt-1.5 leading-relaxed">
          {bgBusy ?? "Recommended for photos: only the person, pet or object becomes stencil."}
        </p>
        {bgError && <p className="mt-2 text-[11px] text-red-400">{bgError}</p>}
      </div>

      {/* Tones */}
      <div>
        <Label icon={Layers} text="Layers" />
        <div className="grid grid-cols-3 gap-1.5">
          {([2, 3, 4] as const).map((t) => (
            <button
              key={t}
              onClick={() => setStencil({ tones: t })}
              disabled={disabled}
              className={`py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-40 ${
                stencil.tones === t ? "border-dd-gold-400/50 bg-dd-gold-400/10 text-dd-gold-400" : "border-border text-foreground-muted hover:bg-card-hover"
              }`}
            >
              {t - 1} {t === 2 ? "layer" : "layers"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-foreground-muted mt-1.5 leading-relaxed">
          {stencil.tones === 2 ? "Classic one-colour stencil: black on white." : `${stencil.tones - 1} tones, darkest first. Each becomes its own layer (or its own stencil sheet to spray).`}
        </p>
      </div>

      <Slider icon={SunDim} label="Threshold" left="Less ink" right="More ink" value={stencil.threshold} min={-50} max={50} onChange={(v) => setStencil({ threshold: v })} disabled={disabled} />
      <Slider icon={Focus} label="Detail" left="Bold shapes" right="Fine detail" value={stencil.detail} min={0} max={100} onChange={(v) => setStencil({ detail: v })} disabled={disabled} />

      {/* Bridges */}
      <div className={`rounded-xl border p-3 ${stencil.bridges ? "border-dd-gold-400/40 bg-dd-gold-400/[0.04]" : "border-border"}`}>
        <div className="flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5 text-dd-gold-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Bridges</span>
          <Switch on={stencil.bridges} onClick={() => setStencil({ bridges: !stencil.bridges })} disabled={disabled} label="Bridges" />
        </div>
        <p className="text-[11px] text-foreground-muted mt-1.5 leading-relaxed">
          Thin strips that hold loose pieces (the middle of an O, an eye highlight) so they don&apos;t fall out when you cut the stencil.
        </p>
        {stencil.bridges && (
          <div className="mt-3">
            <Slider label="Bridge width" left="Thin" right="Thick" value={stencil.bridgeWidth} min={1} max={10} onChange={(v) => setStencil({ bridgeWidth: v })} disabled={disabled} />
          </div>
        )}
      </div>

      {/* Path style */}
      <div>
        <Label icon={Spline} text="Path style" />
        <div className="grid grid-cols-2 gap-2">
          {([[0, "Angular"], [1, "Curved"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStencil({ smoothness: v })}
              disabled={disabled}
              className={`text-xs font-medium py-2 rounded-lg border transition-all disabled:opacity-40 ${
                stencil.smoothness === v ? "border-dd-blue-400/40 bg-dd-blue-400/10 text-dd-blue-400" : "border-border text-foreground-muted hover:bg-card-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={makeStencil}
        disabled={disabled || !stencilFlat || isProcessing}
        className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300 bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg hover:shadow-xl disabled:opacity-40 glow-gold hover:scale-[1.01]"
      >
        <Play className="w-4 h-4" fill="currentColor" />
        Make stencil
      </button>

      <div className="rounded-lg border border-dd-blue-400/20 bg-dd-blue-400/[0.04] p-3 text-[11px] text-foreground-muted leading-relaxed">
        <Info className="inline w-3.5 h-3.5 text-dd-blue-400 mr-1 -mt-0.5" />
        Export as usual. Set layers to Line to cut a stencil sheet, or Fill to engrave the stencil look.
      </div>
    </div>
  );
}

function Label({ icon: Icon, text }: { icon: typeof Layers; text: string }) {
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

function Slider({ icon: Icon, label, left, right, value, min, max, onChange, disabled }: {
  icon?: typeof Layers; label: string; left: string; right: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-dd-gold-400" />}
        <span className="text-[11px] font-semibold text-foreground">{label}</span>
        <span className="ml-auto text-[10px] font-mono text-dd-gold-400">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(parseInt(e.target.value))} disabled={disabled} aria-label={label} />
      <div className="flex justify-between text-[10px] text-foreground-muted mt-1"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}
