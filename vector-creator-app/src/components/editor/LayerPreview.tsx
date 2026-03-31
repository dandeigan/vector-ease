"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Layers } from "lucide-react";

interface LayerInfo {
  color: string;
  index: number;
  pathCount: number;
}

interface LayerPreviewProps {
  svgString: string;
  onFilteredSvgChange: (svg: string) => void;
}

/**
 * Parses an imagetracerjs SVG and extracts unique fill colors as "layers".
 * Each color group = one laser operation layer.
 */
function parseLayers(svgString: string): LayerInfo[] {
  const fillRegex = /fill="(#[0-9a-fA-F]{6})"/g;
  const colorCounts = new Map<string, number>();

  let match;
  while ((match = fillRegex.exec(svgString)) !== null) {
    const color = match[1].toUpperCase();
    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
  }

  return Array.from(colorCounts.entries())
    .map(([color, pathCount], index) => ({ color, index, pathCount }))
    .sort((a, b) => b.pathCount - a.pathCount);
}

/**
 * Rebuilds the SVG string with hidden layers set to display:none.
 */
function filterSvg(svgString: string, hiddenColors: Set<string>): string {
  if (hiddenColors.size === 0) return svgString;

  return svgString.replace(
    /(<path[^>]*fill=")(#[0-9a-fA-F]{6})("[^>]*)(\/?>)/gi,
    (full, pre, color, mid, close) => {
      if (hiddenColors.has(color.toUpperCase())) {
        return `${pre}${color}"${mid} style="display:none"${close}`;
      }
      return full;
    }
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
  if (r > 100 && g < 80 && b > 100) return "Purple";
  if (r > 150 && g > 150 && b > 150) return "Light Gray";
  if (r > 80 && g > 80 && b > 80) return "Gray";
  return "Color";
}

export default function LayerPreview({ svgString, onFilteredSvgChange }: LayerPreviewProps) {
  const layers = useMemo(() => parseLayers(svgString), [svgString]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());

  const toggleLayer = (color: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(color)) {
        next.delete(color);
      } else {
        next.add(color);
      }
      onFilteredSvgChange(filterSvg(svgString, next));
      return next;
    });
  };

  const showAll = () => {
    setHiddenLayers(new Set());
    onFilteredSvgChange(svgString);
  };

  const isolateLayer = (color: string) => {
    const allOthers = new Set(layers.map((l) => l.color).filter((c) => c !== color));
    setHiddenLayers(allOthers);
    onFilteredSvgChange(filterSvg(svgString, allOthers));
  };

  if (layers.length === 0) return null;

  return (
    <div>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-dd-gold-400" />
          <h3 className="text-sm font-bold text-dd-gold-400 uppercase tracking-wider">
            Layers ({layers.length})
          </h3>
        </div>
        {hiddenLayers.size > 0 && (
          <button
            onClick={showAll}
            className="text-[10px] font-medium text-dd-blue-400 hover:text-dd-blue-300 transition-colors"
          >
            Show All
          </button>
        )}
      </div>

      <div className="px-4 pb-3 space-y-1">
        {layers.map((layer) => {
          const isHidden = hiddenLayers.has(layer.color);
          return (
            <div
              key={layer.color}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 group cursor-pointer ${
                isHidden
                  ? "opacity-40 bg-transparent"
                  : "bg-background-overlay/50 hover:bg-background-overlay"
              }`}
              onClick={() => toggleLayer(layer.color)}
            >
              {/* Color swatch */}
              <div
                className="w-5 h-5 rounded-md border border-white/10 flex-shrink-0 shadow-sm"
                style={{ backgroundColor: layer.color }}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{colorName(layer.color)}</span>
                  <span className="text-[10px] font-mono text-foreground-muted">{layer.color}</span>
                </div>
                <span className="text-[10px] text-foreground-muted">{layer.pathCount} paths</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    isolateLayer(layer.color);
                  }}
                  className="p-1 rounded text-[10px] font-medium text-foreground-muted hover:text-dd-gold-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Solo this layer"
                >
                  Solo
                </button>
                {isHidden ? (
                  <EyeOff className="w-3.5 h-3.5 text-foreground-muted" />
                ) : (
                  <Eye className="w-3.5 h-3.5 text-foreground-muted group-hover:text-dd-blue-400 transition-colors" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
