"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { UploadCloud, ImageIcon, ScanSearch, Check, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import TuningPanel from "./TuningPanel";
import { traceImageToSVG } from "@/lib/vectorizer/imagetracer-wrapper";
import { detectImageColors, type DetectedColor } from "@/lib/vectorizer/color-detect";
import { removeBackground } from "@/lib/vectorizer/background-remove";
import { useAuth } from "@/components/auth/AuthContext";
import { logVectorization } from "@/lib/firebase/users";

export default function Workspace() {
  const { user } = useAuth();
  const {
    originalImage, setOriginalImage,
    isProcessing, setIsProcessing,
    loadingMessage, setLoadingMessage,
    resultSvg, setResultSvg,
    options, setOptions,
  } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [displaySvg, setDisplaySvg] = useState<string | null>(null);

  // Auto-detect state
  const [detectedColors, setDetectedColors] = useState<DetectedColor[]>([]);
  const [selectedColors, setSelectedColors] = useState<Set<number>>(new Set());
  const [showDetection, setShowDetection] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (event.target?.result) {
        const imgUrl = event.target.result as string;
        setOriginalImage(imgUrl);
        setResultSvg(null);
        setDisplaySvg(null);
        setShowDetection(true);
        setIsDetecting(true);

        // Run auto-detect
        const colors = await detectImageColors(imgUrl);
        setDetectedColors(colors);
        setIsDetecting(false);

        // Select all detected colors by default
        if (colors.length > 0) {
          const allSelected = new Set(colors.map((_, i) => i));
          setSelectedColors(allSelected);
          setOptions({
            numberOfColors: colors.length,
            customPalette: colors.map((c) => ({ r: c.r, g: c.g, b: c.b })),
          });
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const runTrace = async (imgUrl: string) => {
    setIsProcessing(true);
    setShowDetection(false);
    setLoadingMessage("Vectorizing layers...");

    try {
      const svg = await traceImageToSVG(imgUrl, options);
      setResultSvg(svg);
      setDisplaySvg(svg);
      if (user?.uid) {
        logVectorization(user.uid).catch(() => {});
      }
    } catch (error) {
      console.error("Tracing failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerTrace = () => {
    if (originalImage) runTrace(originalImage);
  };

  const toggleColorSelection = (index: number) => {
    const next = new Set(selectedColors);
    if (next.has(index)) {
      if (next.size <= 1) return;
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedColors(next);

    // Update palette to match
    const selected = detectedColors.filter((_, i) => next.has(i));
    setOptions({
      numberOfColors: selected.length,
      customPalette: selected.map((c) => ({ r: c.r, g: c.g, b: c.b })),
    });
  };

  const selectedCount = selectedColors.size;

  const handleAcceptDetection = () => {
    if (originalImage) runTrace(originalImage);
  };

  const handleAdjustManually = () => {
    setShowDetection(false);
    setOptions({ customPalette: null });
  };

  const handleRemoveBackground = async () => {
    if (!originalImage) return;
    setIsRemovingBg(true);
    try {
      const result = await removeBackground(originalImage, (msg) => {
        setLoadingMessage(msg);
      });
      setOriginalImage(result);
      setResultSvg(null);
      setDisplaySvg(null);
      // Re-detect colors on the new image
      setShowDetection(true);
      setIsDetecting(true);
      const colors = await detectImageColors(result);
      setDetectedColors(colors);
      setIsDetecting(false);
      if (colors.length > 0) {
        const allSelected = new Set(colors.map((_: DetectedColor, i: number) => i));
        setSelectedColors(allSelected);
        setOptions({
          numberOfColors: colors.length,
          customPalette: colors.map((c: DetectedColor) => ({ r: c.r, g: c.g, b: c.b })),
        });
      }
    } catch (err) {
      console.error("Background removal failed:", err);
    } finally {
      setIsRemovingBg(false);
    }
  };

  const handleFilteredSvgChange = (filtered: string) => {
    setDisplaySvg(filtered);
  };

  const svgToShow = displaySvg || resultSvg;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 h-[calc(100vh-5rem)]">
      {/* ── Canvas Area ── */}
      <div className="relative rounded-2xl border border-border bg-card overflow-hidden flex flex-col min-h-0">
        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-background/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />
            <p className="mt-4 text-sm font-medium text-dd-gold-400">{loadingMessage}</p>
          </div>
        )}

        {!originalImage ? (
          /* ── Upload Zone ── */
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`flex-1 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
              isDragging
                ? "bg-dd-gold-400/[0.06] border-2 border-dashed border-dd-gold-400/40"
                : "bg-background/40"
            }`}
          >
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300 ${
              isDragging
                ? "bg-dd-gold-400/15 text-dd-gold-400 scale-110"
                : "bg-dd-gold-400/[0.06] text-foreground-muted"
            }`}>
              <UploadCloud className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold mb-1.5">
              {isDragging ? "Drop it here" : "Upload your image"}
            </h3>
            <p className="text-sm text-foreground-muted text-center max-w-sm px-4">
              Drag and drop, or click to browse. PNG, JPEG, WEBP supported.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-foreground-muted">
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Processed locally — your images never leave this device</span>
            </div>
            <input
              type="file"
              className="hidden"
              ref={fileInputRef}
              accept="image/png, image/jpeg, image/webp"
              onChange={handleFileUpload}
            />
          </div>
        ) : (
          /* ── Preview ── */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground-muted">
                {resultSvg ? "Vector Preview" : showDetection ? "Analyzing Image..." : "Original Image"}
              </h3>
              <button
                onClick={() => {
                  setOriginalImage(null);
                  setResultSvg(null);
                  setDisplaySvg(null);
                  setShowDetection(false);
                  setDetectedColors([]);
                }}
                className="text-xs font-medium text-foreground-muted hover:text-dd-gold-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-dd-gold-400/10"
              >
                Clear
              </button>
            </div>

            <div className="flex-1 overflow-auto checkered-bg flex items-center justify-center min-h-0 relative">
              {/* Show the image */}
              {svgToShow ? (
                <div
                  className="w-full h-full flex items-center justify-center p-6 [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svgToShow }}
                />
              ) : (
                <img
                  src={originalImage}
                  alt="Original"
                  className={`max-w-full max-h-full object-contain p-6 ${showDetection ? "opacity-30" : "opacity-40"}`}
                />
              )}

              {/* ── Detection Overlay ── */}
              {showDetection && !resultSvg && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <div className="w-full max-w-sm mx-6 rounded-2xl border border-dd-gold-400/30 bg-card p-6 glow-gold">
                    {isDetecting ? (
                      <div className="flex flex-col items-center py-4">
                        <ScanSearch className="w-8 h-8 text-dd-gold-400 mb-3 animate-pulse-glow" />
                        <p className="text-sm font-medium">Scanning colors...</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <ScanSearch className="w-4 h-4 text-dd-gold-400" />
                          <h3 className="text-sm font-bold">Colors Detected</h3>
                        </div>
                        <p className="text-xs text-foreground-muted mb-4">
                          We found <span className="text-dd-gold-400 font-semibold">{detectedColors.length} distinct color{detectedColors.length !== 1 ? "s" : ""}</span> in your image
                        </p>

                        {/* Color swatches with checkmarks */}
                        <div className="space-y-1.5 mb-5">
                          {detectedColors.map((color, i) => {
                            const isSelected = selectedColors.has(i);
                            return (
                              <button
                                key={i}
                                onClick={() => toggleColorSelection(i)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-left ${
                                  isSelected
                                    ? "bg-background-overlay/80 border border-dd-gold-400/20"
                                    : "bg-background-overlay/30 border border-transparent opacity-50"
                                }`}
                              >
                                {/* Checkbox */}
                                <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-all ${
                                  isSelected
                                    ? "bg-dd-gold-400 text-[#080B12]"
                                    : "border border-foreground-muted/30"
                                }`}>
                                  {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                                </div>
                                {/* Color swatch */}
                                <div
                                  className="w-6 h-6 rounded-md border border-white/10 shadow-sm flex-shrink-0"
                                  style={{ backgroundColor: color.hex }}
                                />
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-medium">{color.name}</span>
                                  <span className="text-[10px] font-mono text-foreground-muted ml-1.5">{color.hex}</span>
                                </div>
                                <span className="text-[10px] text-foreground-muted font-mono">{color.percentage}%</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Actions */}
                        <div className="space-y-2">
                          <button
                            onClick={handleAcceptDetection}
                            disabled={selectedCount === 0}
                            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg glow-gold-strong hover:shadow-xl transition-all hover:scale-[1.01] disabled:opacity-40"
                          >
                            <Check className="w-4 h-4" />
                            Vectorize with {selectedCount} layer{selectedCount !== 1 ? "s" : ""}
                          </button>
                          <button
                            onClick={handleAdjustManually}
                            className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-blue-400/30 hover:text-dd-blue-400 transition-all"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            Adjust manually
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Tuning + Layers ── */}
      <div className="min-h-0 overflow-y-auto">
        <TuningPanel onTraceTrigger={triggerTrace} onRemoveBackground={handleRemoveBackground} isRemovingBg={isRemovingBg} disabled={!originalImage || isProcessing} onFilteredSvgChange={handleFilteredSvgChange} />
      </div>
    </div>
  );
}
