import { create } from "zustand";

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
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

  resetWorkspace: () => set({
    originalImage: null,
    resultSvg: null,
    isProcessing: false,
    options: defaultOptions
  }),
}));
