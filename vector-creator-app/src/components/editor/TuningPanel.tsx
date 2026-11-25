"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { Play, Wand2, Layers, Spline, Eye, EyeOff, Sparkles, AlertTriangle, PenTool } from "lucide-react";
import { useEffect, useMemo } from "react";
import { defaultPresetForMode, type LightBurnMode } from "@/lib/vectorizer/svg-to-lbrn2";
import { colorName, filterSvg, parseLayers } from "@/lib/vectorizer/svg-layers";

interface TuningPanelProps {
  onTraceTrigger: () => void;
  onRemoveBackground?: () => void;
  isRemovingBg?: boolean;
  disabled: boolean;
  onFilteredSvgChange?: (svg: string) => void;
}

export default function TuningPanel({ onTraceTrigger, onRemoveBackground, isRemovingBg, disabled, onFilteredSvgChange }: TuningPanelProps) {
  const { options, setOptions, resultSvg, layerSettings, updateLayerSettings, ensureLayerSettings, hiddenLayers, setHiddenLayers, looksLikeDrawing } = useEditorStore();

  /**
   * One-click presets for common input types.
   * Each tunes the layer count + smoothness for the typical case.
   * Users can still adjust manually below — these are just starting points.
   */
  const applyPreset = (preset: "logo" | "sticker" | "detail" | "lineart") => {
    switch (preset) {
      case "logo":
        // Clean logos / wordmarks / simple silhouettes — few colors, smooth curves.
        setOptions({ numberOfColors: 3, smoothness: 1, customPalette: null, lineArt: false });
        break;
      case "sticker":
        // Text-heavy stickers — angular preserves sharp letterforms; few colors.
        setOptions({ numberOfColors: 3, smoothness: 0, customPalette: null, lineArt: false });
        break;
      case "detail":
        // Intricate designs — more layers preserve fine elements; smooth curves.
        setOptions({ numberOfColors: 7, smoothness: 1, customPalette: null, lineArt: false });
        break;
      case "lineart":
        // Drawings, engravings, sketches: ink on paper. Keeps fine lines, drops the paper.
        setOptions({ lineArt: true, inkTones: 1, inkSensitivity: 50, smoothness: 1 });
        break;
    }
  };

  const layers = useMemo(() => (resultSvg ? parseLayers(resultSvg) : []), [resultSvg]);

  // Seed LightBurn settings for any newly-discovered color layer
  useEffect(() => {
    layers.forEach((layer) => {
      const preset = defaultPresetForMode("Line");
      ensureLayerSettings(layer.color, {
        name: colorName(layer.color),
        mode: "Line",
        speedMmMin: preset.speedMmMin,
        powerPct: preset.powerPct,
      });
    });
  }, [layers, ensureLayerSettings]);

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
    const next = new Set(hiddenLayers);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    setHiddenLayers(next);
  };

  const isolateLayer = (color: string) => {
    setHiddenLayers(new Set(layers.map((l) => l.color).filter((c) => c !== color)));
  };

  const showAll = () => {
    setHiddenLayers(new Set());
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
        {/* Quick Presets — one-click starting points for common input types.
            Saves users from manual tuning when they're unsure what to pick. */}
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-dd-gold-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-dd-gold-400">Quick Start</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => applyPreset("logo")}
              disabled={disabled}
              className="py-2 rounded-lg text-[11px] font-medium border border-border bg-background/40 text-foreground-muted hover:border-dd-gold-400/40 hover:text-dd-gold-400 hover:bg-dd-gold-400/[0.04] transition-all duration-150 disabled:opacity-30"
              title="Clean logos, silhouettes, simple shapes"
            >
              Logo
            </button>
            <button
              onClick={() => applyPreset("sticker")}
              disabled={disabled}
              className="py-2 rounded-lg text-[11px] font-medium border border-border bg-background/40 text-foreground-muted hover:border-dd-gold-400/40 hover:text-dd-gold-400 hover:bg-dd-gold-400/[0.04] transition-all duration-150 disabled:opacity-30"
              title="Text-heavy stickers — preserves sharp letterforms"
            >
              Sticker
            </button>
            <button
              onClick={() => applyPreset("detail")}
              disabled={disabled}
              className="py-2 rounded-lg text-[11px] font-medium border border-border bg-background/40 text-foreground-muted hover:border-dd-gold-400/40 hover:text-dd-gold-400 hover:bg-dd-gold-400/[0.04] transition-all duration-150 disabled:opacity-30"
              title="Intricate designs with multiple elements"
            >
              Detail
            </button>
            <button
              onClick={() => applyPreset("lineart")}
              disabled={disabled}
              className={`py-2 rounded-lg text-[11px] font-medium border transition-all duration-150 disabled:opacity-30 ${
                options.lineArt
                  ? "border-dd-gold-400/50 text-dd-gold-400 bg-dd-gold-400/[0.06]"
                  : "border-border bg-background/40 text-foreground-muted hover:border-dd-gold-400/40 hover:text-dd-gold-400 hover:bg-dd-gold-400/[0.04]"
              }`}
              title="Drawings, engravings and sketches: one ink on paper"
            >
              Line art
            </button>
          </div>
          <p className="text-[10px] text-foreground-muted mt-2 leading-relaxed">
            Pick a starting point, then fine-tune below if needed.
          </p>
          {looksLikeDrawing && !options.lineArt && (
            <div className="mt-3 rounded-lg border border-dd-gold-400/40 bg-dd-gold-400/[0.06] p-3">
              <p className="text-xs text-foreground leading-relaxed">
                <PenTool className="inline w-3.5 h-3.5 text-dd-gold-400 mr-1 -mt-0.5" />
                This looks like a drawing. Line art keeps every line crisp and drops the paper.
              </p>
              <button
                onClick={() => { applyPreset("lineart"); onTraceTrigger(); }}
                disabled={disabled}
                className="mt-2 w-full py-1.5 rounded-md text-xs font-semibold bg-dd-gold-400 text-[#080B12] hover:bg-dd-gold-300 disabled:opacity-40"
              >
                Use Line art
              </button>
            </div>
          )}
        </div>

        {/* Line art mode */}
        <div className={`rounded-xl border p-3 ${options.lineArt ? "border-dd-gold-400/40 bg-dd-gold-400/[0.04]" : "border-border"}`}>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <PenTool className="w-3.5 h-3.5 text-dd-gold-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Line art mode</span>
            <button
              type="button"
              role="switch"
              aria-checked={options.lineArt}
              aria-label="Line art mode"
              onClick={() => setOptions({ lineArt: !options.lineArt })}
              disabled={disabled}
              className={`ml-auto relative w-9 h-5 rounded-full transition-colors disabled:opacity-40 ${options.lineArt ? "bg-dd-gold-400" : "bg-border"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${options.lineArt ? "translate-x-4" : ""}`} />
            </button>
          </label>
          <p className="text-[11px] text-foreground-muted mt-1.5 leading-relaxed">
            For drawings, engravings and sketches. Keeps fine lines and leaves the paper out.
          </p>

          {options.lineArt && (
            <div className="mt-3 space-y-4">
              <div>
                <div className="text-[11px] font-semibold text-foreground mb-1.5">Ink layers</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[1, 2, 3].map((t) => (
                    <button
                      key={t}
                      onClick={() => setOptions({ inkTones: t })}
                      disabled={disabled}
                      className={`py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-40 ${
                        options.inkTones === t
                          ? "border-dd-gold-400/50 bg-dd-gold-400/10 text-dd-gold-400"
                          : "border-border text-foreground-muted hover:bg-card-hover"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-foreground-muted mt-1.5 leading-relaxed">
                  {options.inkTones === 1
                    ? "All lines on one layer."
                    : `Lines split by darkness into ${options.inkTones} layers, darkest first. Give lighter ones less power for shading.`}
                </p>
              </div>
              <div>
                <div className="flex items-center mb-1.5">
                  <span className="text-[11px] font-semibold text-foreground">Faint lines</span>
                  <span className="ml-auto text-[10px] font-mono text-dd-gold-400">
                    {options.inkSensitivity === 50 ? "Auto" : options.inkSensitivity < 50 ? "Fewer" : "More"}
                  </span>
                </div>
                <input
                  type="range"
                  min="0" max="100" step="5"
                  value={options.inkSensitivity}
                  onChange={(e) => setOptions({ inkSensitivity: parseInt(e.target.value) })}
                  disabled={disabled}
                  aria-label="Faint lines"
                />
                <div className="flex justify-between text-[10px] text-foreground-muted mt-1">
                  <span>Strong lines only</span>
                  <span>Pick up faint lines</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Colors / Layers */}
        {!options.lineArt && (
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
        )}

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
          <div className="px-4 pb-4 space-y-2">
            {layers.map((layer) => {
              const isHidden = hiddenLayers.has(layer.color);
              const key = layer.color.toUpperCase();
              const settings = layerSettings[key];
              const handleModeChange = (mode: LightBurnMode) => {
                const preset = defaultPresetForMode(mode);
                updateLayerSettings(layer.color, { mode, speedMmMin: preset.speedMmMin, powerPct: preset.powerPct });
              };
              return (
                <div
                  key={layer.color}
                  className={`px-3 py-2.5 rounded-lg transition-all duration-150 ${
                    isHidden ? "opacity-35 bg-background-overlay/30" : "bg-background-overlay/50"
                  }`}
                >
                  {/* Row 1 — swatch + name input + visibility toggles */}
                  <div className="flex items-center gap-2.5 group">
                    <div
                      className="w-5 h-5 rounded-md border border-white/10 flex-shrink-0 shadow-sm"
                      style={{ backgroundColor: layer.color }}
                    />
                    <input
                      type="text"
                      value={settings?.name ?? colorName(layer.color)}
                      onChange={(e) => updateLayerSettings(layer.color, { name: e.target.value })}
                      className="flex-1 min-w-0 bg-transparent text-xs font-medium focus:outline-none focus:ring-1 focus:ring-dd-gold-400/30 rounded px-1 py-0.5"
                      placeholder="Layer name"
                    />
                    <span className="text-[10px] font-mono text-foreground-muted flex-shrink-0">{layer.color}</span>
                    <button
                      onClick={() => isolateLayer(layer.color)}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-foreground-muted hover:text-dd-gold-400 hover:bg-dd-gold-400/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      Solo
                    </button>
                    <button
                      onClick={() => toggleLayer(layer.color)}
                      className="flex-shrink-0"
                      title={isHidden ? "Show layer" : "Hide layer"}
                    >
                      {isHidden ? (
                        <EyeOff className="w-3.5 h-3.5 text-foreground-muted" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-foreground-muted hover:text-dd-blue-400 transition-colors" />
                      )}
                    </button>
                  </div>

                  {/* Row 2 — LightBurn export settings */}
                  {settings && (
                    <div className="flex items-center gap-2 mt-2 pl-7.5" style={{ paddingLeft: "1.875rem" }}>
                      <select
                        value={settings.mode}
                        onChange={(e) => handleModeChange(e.target.value as LightBurnMode)}
                        className="bg-background border border-border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-dd-gold-400/50"
                      >
                        <option value="Line">Line</option>
                        <option value="Fill">Fill</option>
                        <option value="Offset Fill">Offset Fill</option>
                      </select>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={settings.speedMmMin}
                          onChange={(e) => updateLayerSettings(layer.color, { speedMmMin: Math.max(1, parseInt(e.target.value) || 0) })}
                          className="w-14 bg-background border border-border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-dd-gold-400/50"
                        />
                        <span className="text-[9px] text-foreground-muted">mm/m</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={settings.powerPct}
                          onChange={(e) => updateLayerSettings(layer.color, { powerPct: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                          className="w-10 bg-background border border-border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-dd-gold-400/50"
                        />
                        <span className="text-[9px] text-foreground-muted">%</span>
                      </div>
                      <span className="text-[9px] text-foreground-muted ml-auto">{layer.pathCount} paths</span>
                    </div>
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

      {/* ── Quality Warning ── shown when result layer count is outside the sweet spot.
          Helps users understand why a result looks bad without forcing them to download + see. */}
      {resultSvg && (layers.length < 2 || layers.length > 15) && (
        <div className="mx-5 mb-3 rounded-xl border border-dd-gold-400/30 bg-dd-gold-400/[0.05] p-3.5">
          <div className="flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-dd-gold-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-semibold text-dd-gold-400 mb-1">
                {layers.length < 2 ? "Result looks too simple" : `${layers.length} layers detected — may be too many for clean laser output`}
              </p>
              <p className="text-[10px] text-foreground-muted leading-relaxed">
                {layers.length < 2
                  ? "Try a different image with more visible color contrast, or use the Detail preset above."
                  : "Try the Logo or Sticker preset above to reduce layer count. Fewer layers = cleaner laser cuts."}
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
