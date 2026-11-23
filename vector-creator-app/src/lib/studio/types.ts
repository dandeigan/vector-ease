/** Laser operation a layer performs. */
export type LayerOperation = "cut" | "score" | "engrave" | "image";

export interface StudioLayer {
  id: string;
  name: string;
  color: string; // #RRGGBB
  operation: LayerOperation;
  visible: boolean;
}

/** 2D affine matrix [a, b, c, d, e, f] (same order as SVG matrix()). */
export type Matrix = [number, number, number, number, number, number];

/** One vector shape coming out of an importer, already in world millimetres. */
export interface ImportedPath {
  kind: "path";
  d: string;
  layerId: string;
  name?: string;
  fillRule?: "nonzero" | "evenodd";
  /** Original fill (or outline) colour as #RRGGBB, when the source file had one. */
  sourceColor?: string;
}

/** One raster image coming out of an importer. `transform` maps 0..width × 0..height into mm. */
export interface ImportedImage {
  kind: "image";
  dataUrl: string;
  width: number;
  height: number;
  transform: Matrix;
  layerId: string;
  name?: string;
}

export type ImportedItem = ImportedPath | ImportedImage;

export interface ImportedDesign {
  name: string;
  items: ImportedItem[];
  /** Layers the importer needs (merged into the project by id). */
  layers: StudioLayer[];
  /** Plain-language notes for the user (e.g. "2 text elements skipped"). */
  warnings: string[];
}

/** Text settings stored on a Studio text object. */
export interface StudioTextSettings {
  text: string;
  fontId: string;
  sizeMm: number; // cap height-ish: the font size in mm
  align: "left" | "center" | "right";
  lineHeight: number; // multiple of size
  letterSpacing: number; // mm between letters
}
