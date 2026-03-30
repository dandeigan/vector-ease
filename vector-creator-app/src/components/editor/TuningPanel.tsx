"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { Download, Play, Wand2, Layers, Spline, Droplets } from "lucide-react";

interface TuningPanelProps {
  onTraceTrigger: () => void;
  disabled: boolean;
}

export default function TuningPanel({ onTraceTrigger, disabled }: TuningPanelProps) {
  const { options, setOptions, resultSvg } = useEditorStore();

  const handleDownloadSVG = () => {
    if (!resultSvg) return;
    const blob = new Blob([resultSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vectorease-output.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-border bg-card flex flex-col h-full">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-bold text-dd-gold-400 uppercase tracking-wider">Layer Tuning</h3>
        <p className="text-xs text-foreground-muted mt-0.5">Dial in your laser settings</p>
      </div>

      {/* ── Controls ── */}
      <div className="px-5 py-5 space-y-6 flex-1">
        {/* Colors / Layers */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-3.5 h-3.5 text-dd-gold-400" />
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Laser Layers</label>
            <span className="ml-auto text-sm font-mono font-bold text-dd-gold-400">{options.numberOfColors}</span>
          </div>
          <input
            type="range"
            min="2" max="16" step="1"
            value={options.numberOfColors}
            onChange={(e) => setOptions({ numberOfColors: parseInt(e.target.value) })}
            disabled={disabled}
          />
          <p className="text-[11px] text-foreground-muted mt-1.5">Each color becomes a separate LightBurn layer</p>
        </div>

        {/* Smoothness */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Spline className="w-3.5 h-3.5 text-dd-blue-400" />
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Path Style</label>
            <span className="ml-auto text-xs font-medium text-dd-blue-400">
              {options.smoothness === 1 ? "Curved" : "Angular"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOptions({ smoothness: 0 })}
              disabled={disabled}
              className={`text-xs font-medium py-2.5 rounded-lg border transition-all duration-200 ${
                options.smoothness === 0
                  ? "border-dd-blue-400/40 bg-dd-blue-400/10 text-dd-blue-400"
                  : "border-border text-foreground-muted hover:border-border hover:bg-card-hover"
              } disabled:opacity-40`}
            >
              Angular
            </button>
            <button
              onClick={() => setOptions({ smoothness: 1 })}
              disabled={disabled}
              className={`text-xs font-medium py-2.5 rounded-lg border transition-all duration-200 ${
                options.smoothness === 1
                  ? "border-dd-blue-400/40 bg-dd-blue-400/10 text-dd-blue-400"
                  : "border-border text-foreground-muted hover:border-border hover:bg-card-hover"
              } disabled:opacity-40`}
            >
              Curved
            </button>
          </div>
        </div>

        {/* Blur / Noise */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Droplets className="w-3.5 h-3.5 text-dd-gold-400" />
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Noise Reduction</label>
            <span className="ml-auto text-sm font-mono font-bold text-dd-gold-400">{options.blurRadius}px</span>
          </div>
          <input
            type="range"
            min="0" max="10" step="1"
            value={options.blurRadius}
            onChange={(e) => setOptions({ blurRadius: parseInt(e.target.value) })}
            disabled={disabled}
          />
          <p className="text-[11px] text-foreground-muted mt-1.5">Higher values smooth out small artifacts</p>
        </div>

        {/* Apply */}
        <button
          onClick={onTraceTrigger}
          disabled={disabled}
          className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300 bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg hover:shadow-xl disabled:opacity-40 disabled:shadow-none glow-gold hover:scale-[1.01]"
        >
          <Play className="w-4 h-4" fill="currentColor" />
          Apply & Vectorize
        </button>
      </div>

      {/* ── Pro Tools ── */}
      <div className="px-5 py-4 border-t border-border">
        <button
          disabled={disabled}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-blue-400/30 hover:text-dd-blue-400 hover:bg-dd-blue-400/[0.05] transition-all duration-200 disabled:opacity-30 disabled:hover:border-border disabled:hover:text-foreground-muted disabled:hover:bg-transparent"
        >
          <Wand2 className="w-3.5 h-3.5" />
          AI Remove Background
        </button>
      </div>

      {/* ── Export ── */}
      <div className="px-5 py-4 border-t border-border space-y-2">
        <button
          disabled={!resultSvg}
          onClick={handleDownloadSVG}
          className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300 bg-dd-blue-500 hover:bg-dd-blue-400 text-white shadow-lg hover:shadow-xl disabled:opacity-30 disabled:shadow-none glow-blue hover:scale-[1.01]"
        >
          <Download className="w-4 h-4" />
          Export Layered SVG
        </button>
        <button
          disabled={!resultSvg}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-gold-400/30 hover:text-dd-gold-400 transition-all duration-200 disabled:opacity-30"
        >
          <Download className="w-3.5 h-3.5" />
          Export DXF
        </button>
      </div>
    </div>
  );
}
