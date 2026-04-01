"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { Download, Play, Wand2, Layers, Spline, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { svgToDxf } from "@/lib/vectorizer/svg-to-dxf";

interface TuningPanelProps {
  onTraceTrigger: () => void;
  onRemoveBackground?: () => void;
  isRemovingBg?: boolean;
  disabled: boolean;
  onFilteredSvgChange?: (svg: string) => void;
}

/* ── Layer parsing helpers ── */
interface LayerInfo {
  color: string;
  pathCount: number;
}

/** Convert rgb(r,g,b) string to #RRGGBB */
function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return rgb;
  const [, r, g, b] = m;
  return "#" + [r, g, b].map((v) => parseInt(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function parseLayers(svg: string): LayerInfo[] {
  // Match both rgb() and hex fill formats
  const fillRegex = /fill="(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-fA-F]{6})"/g;
  const counts = new Map<string, number>();
  let m;
  while ((m = fillRegex.exec(svg)) !== null) {
    const c = rgbToHex(m[1]).toUpperCase();
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([color, pathCount]) => ({ color, pathCount }))
    .sort((a, b) => b.pathCount - a.pathCount);
}

function filterSvg(svg: string, hidden: Set<string>): string {
  if (hidden.size === 0) return svg;
  return svg.replace(
    /(<path[^>]*fill=")(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-fA-F]{6})("[^>]*)(\/?>)/gi,
    (full, pre, color, mid, close) =>
      hidden.has(rgbToHex(color).toUpperCase())
        ? `${pre}${color}"${mid} style="opacity:0.06"${close}`
        : full
  );
}

function colorName(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness > 240) return "White";
  if (brightness < 30) return "Black";
  if (r > 180 && g < 80 && b < 80) return "Red";
  if (r < 80 && g > 150 && b < 80) return "Green";
  if (r < 80 && g < 80 && b > 180) return "Blue";
  if (r > 180 && g > 150 && b < 80) return "Yellow";
  if (r > 180 && g > 100 && b < 80) return "Orange";
  if (r > 150 && g > 150 && b > 150) return "Light Gray";
  if (r > 80 && g > 80 && b > 80) return "Gray";
  return "Color";
}

export default function TuningPanel({ onTraceTrigger, onRemoveBackground, isRemovingBg, disabled, onFilteredSvgChange }: TuningPanelProps) {
  const { options, setOptions, resultSvg } = useEditorStore();
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());

  const layers = useMemo(() => (resultSvg ? parseLayers(resultSvg) : []), [resultSvg]);

  // Sync filtered SVG to parent whenever hiddenLayers changes
  useEffect(() => {
    if (!resultSvg || !onFilteredSvgChange) return;
    onFilteredSvgChange(filterSvg(resultSvg, hiddenLayers));
  }, [hiddenLayers, resultSvg]);

  // Reset hidden layers when a new trace is generated
  useEffect(() => {
    setHiddenLayers(new Set());
  }, [resultSvg]);

  const toggleLayer = (color: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      next.has(color) ? next.delete(color) : next.add(color);
      return next;
    });
  };

  const isolateLayer = (color: string) => {
    setHiddenLayers(new Set(layers.map((l) => l.color).filter((c) => c !== color)));
  };

  const showAll = () => {
    setHiddenLayers(new Set());
  };

  /** Remove hidden layers from SVG before export */
  const getExportSvg = (): string => {
    if (!resultSvg) return "";
    if (hiddenLayers.size === 0) return resultSvg;
    // Remove paths whose fill color is hidden (not just opacity — fully remove)
    return resultSvg.replace(
      /<path[^>]*fill="(rgb\([^)]+\)|#[0-9a-fA-F]{6})"[^>]*\/?>(\s*<\/path>)?/gi,
      (full, color) => {
        const hex = color.startsWith("rgb") ? rgbToHex(color).toUpperCase() : color.toUpperCase();
        return hiddenLayers.has(hex) ? "" : full;
      }
    );
  };

  const handleDownloadSVG = () => {
    const svg = getExportSvg();
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vectorease-output.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadDXF = () => {
    const svg = getExportSvg();
    if (!svg) return;
    const dxfString = svgToDxf(svg);
    const blob = new Blob([dxfString], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vectorease-output.dxf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-border bg-card flex flex-col">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-bold text-dd-gold-400 uppercase tracking-wider">Layer Tuning</h3>
        <p className="text-xs text-foreground-muted mt-0.5">Dial in your laser settings</p>
      </div>

      {/* ── Controls ── */}
      <div className="px-5 py-5 space-y-6">
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

      {/* ── Layer Inspector ── */}
      {layers.length > 0 && (
        <div className="border-t border-border">
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-dd-blue-400" />
              <span className="text-xs font-bold text-dd-blue-400 uppercase tracking-wider">
                Layers ({layers.length})
              </span>
            </div>
            {hiddenLayers.size > 0 && (
              <button
                onClick={showAll}
                className="text-[10px] font-medium text-dd-gold-400 hover:text-dd-gold-300 transition-colors"
              >
                Show All
              </button>
            )}
          </div>
          <div className="px-4 pb-4 space-y-1">
            {layers.map((layer) => {
              const isHidden = hiddenLayers.has(layer.color);
              return (
                <div
                  key={layer.color}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 group cursor-pointer ${
                    isHidden
                      ? "opacity-35"
                      : "bg-background-overlay/50 hover:bg-background-overlay"
                  }`}
                  onClick={() => toggleLayer(layer.color)}
                >
                  <div
                    className="w-5 h-5 rounded-md border border-white/10 flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: layer.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{colorName(layer.color)}</span>
                      <span className="text-[10px] font-mono text-foreground-muted">{layer.color}</span>
                    </div>
                    <span className="text-[10px] text-foreground-muted">{layer.pathCount} paths</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); isolateLayer(layer.color); }}
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-foreground-muted hover:text-dd-gold-400 hover:bg-dd-gold-400/10 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    Solo
                  </button>
                  {isHidden ? (
                    <EyeOff className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-foreground-muted group-hover:text-dd-blue-400 transition-colors flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Pro Tools ── */}
      <div className="px-5 py-4 border-t border-border">
        <button
          disabled={disabled || isRemovingBg}
          onClick={onRemoveBackground}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-blue-400/30 hover:text-dd-blue-400 hover:bg-dd-blue-400/[0.05] transition-all duration-200 disabled:opacity-30 disabled:hover:border-border disabled:hover:text-foreground-muted disabled:hover:bg-transparent"
        >
          {isRemovingBg ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-dd-blue-400 border-t-transparent rounded-full animate-smooth-spin" />
              Removing Background...
            </>
          ) : (
            <>
              <Wand2 className="w-3.5 h-3.5" />
              AI Remove Background
            </>
          )}
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
          onClick={handleDownloadDXF}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-gold-400/30 hover:text-dd-gold-400 transition-all duration-200 disabled:opacity-30"
        >
          <Download className="w-3.5 h-3.5" />
          Export DXF
        </button>
      </div>
    </div>
  );
}
