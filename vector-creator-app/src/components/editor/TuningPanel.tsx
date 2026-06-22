"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { Download, Play, Wand2, Layers, Spline, Eye, EyeOff, Flame } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { svgToDxf } from "@/lib/vectorizer/svg-to-dxf";
import { svgToLbrn2, defaultPresetForMode, type LightBurnMode } from "@/lib/vectorizer/svg-to-lbrn2";
import { useAuth } from "@/components/auth/AuthContext";
import {
  computeImageFingerprint,
  evaluateDownload,
  markImageDownloaded,
  getVectorizationsRemaining,
} from "@/lib/firebase/users";

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
  const { options, setOptions, resultSvg, layerSettings, updateLayerSettings, ensureLayerSettings, originalImage } = useEditorStore();
  const { user, userRecord } = useAuth();
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showPaywall, setShowPaywall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const remaining = userRecord ? getVectorizationsRemaining(userRecord) : 0;
  const isPaidOrAdmin =
    userRecord?.role === "superadmin" || userRecord?.subscriptionStatus === "active";
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  /**
   * Trigger Stripe Checkout for the Founder's Lifetime Deal.
   * Uses Stripe's session.url redirect pattern (post-2025-09-30 — replaced
   * the deprecated stripe.redirectToCheckout()). Mirrors UpgradeButton.tsx.
   */
  const handleCheckout = async () => {
    if (!user) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/checkout_sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid }),
      });
      const data = await res.json();
      if (data.error) {
        console.error("[paywall checkout] API error:", data.error);
        setCheckoutLoading(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("[paywall checkout] No checkout URL returned from API");
        setCheckoutLoading(false);
      }
    } catch (err) {
      console.error("[paywall checkout] Failed:", err);
      setCheckoutLoading(false);
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

  /**
   * Gate every download through the quota check.
   * - Multi-format downloads of the same source image count as 1 (deduped by SHA-256 fingerprint).
   * - When the quota is exhausted, opens the paywall modal and aborts the download.
   * - Superadmins and paid users bypass all gating.
   * - Brevo VECTORIZATIONS_USED attribute is updated in the background after a decrement.
   */
  const gatedDownload = async (downloadFn: () => void) => {
    if (isDownloading) return;
    if (!user || !user.email || !userRecord || !originalImage) {
      // Safety: if context is missing, fall back to the raw download (don't block user).
      downloadFn();
      return;
    }
    setIsDownloading(true);
    try {
      const fingerprint = await computeImageFingerprint(originalImage);
      const decision = evaluateDownload(userRecord, fingerprint);

      if (!decision.allow) {
        setShowPaywall(true);
        return;
      }

      downloadFn();

      if (!decision.alreadyDownloaded) {
        // Persist decrement + push updated count to Brevo. Fire-and-forget — the download already happened.
        markImageDownloaded(user.uid, user.email, fingerprint).catch((err) =>
          console.error("[gatedDownload] markImageDownloaded failed", err)
        );
      }
    } finally {
      setIsDownloading(false);
    }
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

  const handleDownloadLbrn2 = () => {
    const svg = getExportSvg();
    if (!svg) return;
    const visibleLayers = layers.filter((l) => !hiddenLayers.has(l.color));
    const layerConfigs = visibleLayers.map((l) => {
      const s = layerSettings[l.color.toUpperCase()];
      const preset = defaultPresetForMode("Line");
      return {
        color: l.color,
        name: s?.name ?? colorName(l.color),
        mode: s?.mode ?? "Line",
        speedMmMin: s?.speedMmMin ?? preset.speedMmMin,
        powerPct: s?.powerPct ?? preset.powerPct,
      };
    });
    const lbrn = svgToLbrn2(svg, { layers: layerConfigs });
    const blob = new Blob([lbrn], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vectorease-output.lbrn2";
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

      {/* ── Export ── */}
      <div className="px-5 py-4 border-t border-border space-y-2">
        {/* Quota counter — only shown for trial users */}
        {!isPaidOrAdmin && userRecord && (
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-medium">
              Free Trial
            </span>
            <span className={`text-[11px] font-bold ${remaining <= 1 ? "text-dd-gold-400" : "text-foreground-muted"}`}>
              {remaining} of 5 left
            </span>
          </div>
        )}
        <button
          disabled={!resultSvg || isDownloading}
          onClick={() => gatedDownload(handleDownloadLbrn2)}
          className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300 bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg hover:shadow-xl disabled:opacity-30 disabled:shadow-none glow-gold-strong hover:scale-[1.01]"
        >
          <Flame className="w-4 h-4" />
          Export for LightBurn (.lbrn2)
        </button>
        <p className="text-[10px] text-foreground-muted text-center -mt-1">
          Opens in LightBurn with layer names, modes, speed &amp; power already set
        </p>

        <button
          disabled={!resultSvg || isDownloading}
          onClick={() => gatedDownload(handleDownloadSVG)}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-blue-400/30 hover:text-dd-blue-400 transition-all duration-200 disabled:opacity-30 mt-2"
        >
          <Download className="w-3.5 h-3.5" />
          Export Layered SVG
        </button>
        <button
          disabled={!resultSvg || isDownloading}
          onClick={() => gatedDownload(handleDownloadDXF)}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-gold-400/30 hover:text-dd-gold-400 transition-all duration-200 disabled:opacity-30"
        >
          <Download className="w-3.5 h-3.5" />
          Export DXF
        </button>
      </div>

      {/* ── Paywall Modal (Founder's Lifetime Deal upsell) ── */}
      {showPaywall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="max-w-md w-full rounded-2xl border border-dd-gold-400/30 bg-card p-8 glow-gold-strong">
            <div className="w-14 h-14 rounded-2xl bg-dd-gold-400/10 text-dd-gold-400 flex items-center justify-center mb-5 mx-auto">
              <Flame className="w-7 h-7" />
            </div>
            <h3 className="text-2xl font-bold text-center mb-2">You've used your 5 free vectorizations</h3>
            <p className="text-sm text-foreground-muted text-center mb-6 leading-relaxed">
              If VectorEase saved you time, the Founder's Lifetime Deal locks in $39 USD forever.
              No subscription. Capped at 100 customers, then $79.
            </p>
            <button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="block w-full py-3 rounded-xl text-sm font-semibold text-center bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg glow-gold-strong hover:scale-[1.01] transition-all duration-200 disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {checkoutLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#080B12]/30 border-t-[#080B12] rounded-full animate-smooth-spin" />
                  Opening checkout...
                </>
              ) : (
                "Claim Founder Seat — $39"
              )}
            </button>
            <button
              onClick={() => setShowPaywall(false)}
              className="block w-full mt-3 py-2 text-xs font-medium text-foreground-muted hover:text-dd-gold-400 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
