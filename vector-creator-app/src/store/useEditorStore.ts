import { create } from "zustand";
import type { LightBurnMode } from "@/lib/vectorizer/svg-to-lbrn2";
import { DEFAULT_ENGRAVE, type EngraveOptions } from "@/lib/photo/engrave";
import { engraveDefaultsWithMemory, saveEngraveMemory } from "@/lib/photo/engrave-memory";
import { DEFAULT_STENCIL, type StencilOptions } from "@/lib/photo/stencil";

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

  // Set on upload: the image looks like a drawing (Convert suggests Line art).
  looksLikeDrawing: boolean;
  setLooksLikeDrawing: (v: boolean) => void;

  // Last vectorize failure, shown over the preview. Cleared on the next try.
  traceError: string | null;
  setTraceError: (msg: string | null) => void;

  // Convert makes either vector layers or a Photo engrave (laser-ready dotted image).
  convertMode: "vector" | "photo" | "stencil";
  setConvertMode: (m: "vector" | "photo" | "stencil") => void;
  // Which mode made resultSvg (a vector trace and a stencil share the exports).
  resultFrom: "vector" | "stencil";
  setResultFrom: (m: "vector" | "stencil") => void;
  stencil: StencilOptions;
  setStencil: (patch: Partial<StencilOptions>) => void;
  // The flat stencil image (PNG data URL) that gets vectorized.
  stencilFlat: string | null;
  setStencilFlat: (url: string | null) => void;
  // Set on upload: the image looks like a real photo (Convert suggests Photo engrave).
  looksLikePhoto: boolean;
  setLooksLikePhoto: (v: boolean) => void;
  engrave: EngraveOptions;
  setEngrave: (patch: Partial<EngraveOptions>) => void;
  // The upload with its background removed (AI), kept so it can be toggled on and off.
  cutoutImage: string | null;
  setCutoutImage: (url: string | null) => void;
  // The finished Photo engrave: one byte per laser dot, 0 = burn.
  photoOutput: { pixels: Uint8ClampedArray; w: number; h: number; dpi: number; widthMm: number } | null;
  setPhotoOutput: (o: EditorState["photoOutput"]) => void;
  // Photo engrave touch-up brush: painted masks (alpha) for darken / lighten / sharpen logo,
  // tied to the image they were painted on. touchVersion bumps after each stroke.
  touchLayers: { forImage: string; darken: HTMLCanvasElement; lighten: HTMLCanvasElement; crisp: HTMLCanvasElement } | null;
  setTouchLayers: (t: EditorState["touchLayers"]) => void;
  touchVersion: number;
  bumpTouch: () => void;

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

  looksLikeDrawing: false,
  setLooksLikeDrawing: (v) => set({ looksLikeDrawing: v }),
  traceError: null,
  setTraceError: (msg) => set({ traceError: msg }),

  convertMode: "vector",
  // Switching between Vector and Stencil drops the other one's result, so the
  // preview and exports always match the tab you're on.
  setConvertMode: (m) => set((st) => ({
    convertMode: m,
    resultSvg: m === "photo" || st.resultFrom === m ? st.resultSvg : null,
  })),
  resultFrom: "vector",
  setResultFrom: (m) => set({ resultFrom: m }),
  stencil: DEFAULT_STENCIL,
  setStencil: (patch) => set((st) => ({ stencil: { ...st.stencil, ...patch } })),
  stencilFlat: null,
  setStencilFlat: (url) => set({ stencilFlat: url }),
  looksLikePhoto: false,
  setLooksLikePhoto: (v) => set({ looksLikePhoto: v }),
  engrave: DEFAULT_ENGRAVE,
  setEngrave: (patch) => set((st) => {
    const engrave = { ...st.engrave, ...patch };
    if ("material" in patch || "dpi" in patch || "burnSpread" in patch) saveEngraveMemory(engrave);
    return { engrave };
  }),
  cutoutImage: null,
  setCutoutImage: (url) => set({ cutoutImage: url }),
  photoOutput: null,
  setPhotoOutput: (o) => set({ photoOutput: o }),
  touchLayers: null,
  setTouchLayers: (t) => set({ touchLayers: t }),
  touchVersion: 0,
  bumpTouch: () => set((st) => ({ touchVersion: st.touchVersion + 1 })),

  resetWorkspace: () => set({
    convertMode: "vector",
    resultFrom: "vector",
    stencil: DEFAULT_STENCIL,
    stencilFlat: null,
    looksLikePhoto: false,
    // A new image keeps the user's wood and laser settings (material, DPI, Burn spread).
    engrave: engraveDefaultsWithMemory(),
    cutoutImage: null,
    photoOutput: null,
    touchLayers: null,
    looksLikeDrawing: false,
    traceError: null,
    originalImage: null,
    resultSvg: null,
    isProcessing: false,
    options: defaultOptions,
    layerSettings: {},
    hiddenLayers: new Set(),
  }),
}));
