"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { UploadCloud, ImageIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import TuningPanel from "./TuningPanel";
import { traceImageToSVG } from "@/lib/vectorizer/imagetracer-wrapper";
import { useAuth } from "@/components/auth/AuthContext";
import { logVectorization } from "@/lib/firebase/users";

export default function Workspace() {
  const { user } = useAuth();
  const {
    originalImage, setOriginalImage,
    isProcessing, setIsProcessing,
    loadingMessage, setLoadingMessage,
    resultSvg, setResultSvg,
    options,
  } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [displaySvg, setDisplaySvg] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setOriginalImage(event.target.result as string);
        setResultSvg(null);
        setDisplaySvg(null);
        runTrace(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const runTrace = async (imgUrl: string) => {
    setIsProcessing(true);
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

  const handleFilteredSvgChange = (filtered: string) => {
    setDisplaySvg(filtered);
  };

  // When resultSvg changes externally (re-trace), sync displaySvg
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
                {resultSvg ? "Vector Preview" : "Original Image"}
              </h3>
              <button
                onClick={() => { setOriginalImage(null); setResultSvg(null); setDisplaySvg(null); }}
                className="text-xs font-medium text-foreground-muted hover:text-dd-gold-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-dd-gold-400/10"
              >
                Clear
              </button>
            </div>

            <div className="flex-1 overflow-auto checkered-bg p-6 flex items-center justify-center min-h-0">
              {svgToShow ? (
                <div
                  className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svgToShow }}
                />
              ) : (
                <img
                  src={originalImage}
                  alt="Original"
                  className="max-w-full max-h-full object-contain opacity-40"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Tuning + Layers ── */}
      <div className="min-h-0 overflow-y-auto">
        <TuningPanel onTraceTrigger={triggerTrace} disabled={!originalImage || isProcessing} onFilteredSvgChange={handleFilteredSvgChange} />
      </div>
    </div>
  );
}
