import { create } from "zustand";
import type { LightBurnMode } from "@/lib/vectorizer/svg-to-lbrn2";

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

export interface LayerSettings {
  name: string;
  mode: LightBurnMode;
  speedMmMin: number;
  powerPct: number;
}

export interface TracingOptions {
  numberOfColors: number;
  minColorRatio: number;
  colorQuantCycles: number;
  blurRadius: number;
  blurDelta: number;
  pathOmit: number;
  smoothness: number;
  customPalette: PaletteColor[] | null;
  /** Line-art mode: ink vs paper by brightness, paper left out. */
  lineArt: boolean;
  /** Line-art ink layers, darkest first (1–3). */
  inkTones: number;
  /** Line-art faint-line pickup, 0–100 (50 = automatic). */
  inkSensitivity: number;
}

const defaultOptions: TracingOptions = {
  numberOfColors: 8, // 8 colors for good layer separation on most images
  minColorRatio: 0,
  colorQuantCycles: 6,  // More iterations = better color accuracy
  blurRadius: 1,     // Minimal blur to smooth JPEG compression artifacts
  blurDelta: 20,
  pathOmit: 4,       // Lower threshold — keep smaller detail paths
  smoothness: 1,     // 0 = linear, 1 = smooth curves
  customPalette: null,
  lineArt: false,
  inkTones: 1,
  inkSensitivity: 50,
};

interface EditorState {
  // Input
  originalImage: string | null;
  setOriginalImage: (imgUrl: string | null) => void;

  // Options
  options: TracingOptions;
  setOptions: (options: Partial<TracingOptions>) => void;

  // Status
  isProcessing: boolean;
  setIsProcessing: (status: boolean) => void;
  loadingMessage: string;
  setLoadingMessage: (msg: string) => void;

  // Output
  resultSvg: string | null;
  setResultSvg: (svg: string | null) => void;

  // Per-layer LightBurn export settings (keyed by uppercase hex color)
  layerSettings: Record<string, LayerSettings>;
  updateLayerSettings: (color: string, patch: Partial<LayerSettings>) => void;
  ensureLayerSettings: (color: string, defaults: LayerSettings) => void;

  // Layers hidden on the Convert preview (left out of every export), keyed by uppercase hex.
  hiddenLayers: Set<string>;
  setHiddenLayers: (next: Set<string>) => void;

  // Header buttons on Convert ask the workspace to do things it owns.
  // Each is a counter: a new value means "do it now".
  openRequest: number;
  requestOpen: () => void;
  clearRequest: number;
  requestClear: () => void;

  // Global actions
  resetWorkspace: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  originalImage: null,
  setOriginalImage: (imgUrl) => set({ originalImage: imgUrl }),

  options: defaultOptions,
  setOptions: (newOptions) => set((state) => ({ options: { ...state.options, ...newOptions } })),

  isProcessing: false,
  setIsProcessing: (status) => set({ isProcessing: status }),
  loadingMessage: "Processing...",
  setLoadingMessage: (msg) => set({ loadingMessage: msg }),

  resultSvg: null,
  setResultSvg: (svg) => set({ resultSvg: svg }),

  layerSettings: {},
  updateLayerSettings: (color, patch) =>
    set((state) => {
      const key = color.toUpperCase();
      const current = state.layerSettings[key];
      if (!current) return state;
      return {
        layerSettings: {
          ...state.layerSettings,
          [key]: { ...current, ...patch },
        },
      };
    }),
  ensureLayerSettings: (color, defaults) =>
    set((state) => {
      const key = color.toUpperCase();
      if (state.layerSettings[key]) return state;
      return { layerSettings: { ...state.layerSettings, [key]: defaults } };
    }),

  hiddenLayers: new Set(),
  setHiddenLayers: (next) => set({ hiddenLayers: next }),

  openRequest: 0,
  requestOpen: () => set((st) => ({ openRequest: st.openRequest + 1 })),
  clearRequest: 0,
  requestClear: () => set((st) => ({ clearRequest: st.clearRequest + 1 })),

  resetWorkspace: () => set({
    originalImage: null,
    resultSvg: null,
    isProcessing: false,
    options: defaultOptions,
    layerSettings: {},
    hiddenLayers: new Set(),
  }),
}));
