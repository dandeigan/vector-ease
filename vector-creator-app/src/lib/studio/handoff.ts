/**
 * Files picked on another page (e.g. a .lac dropped on Convert, or a finished
 * Convert result) waiting to be opened in the Studio. Module state survives
 * client-side navigation.
 */

import type { LayerOperation } from "./types";

export const STUDIO_EXTENSIONS = ["lac", "svg", "dxf"];

export function isStudioFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return STUDIO_EXTENSIONS.includes(ext) || file.type === "image/svg+xml";
}

/** Extra info that travels with a Convert result: one Studio layer per colour. */
export interface StudioHandoffMeta {
  /** Keyed by #RRGGBB (upper case). */
  layerColors?: Record<string, { name: string; operation: LayerOperation }>;
}

let pending: { files: File[]; meta?: StudioHandoffMeta } = { files: [] };

export function setPendingStudioFiles(files: File[], meta?: StudioHandoffMeta) {
  pending = { files, meta };
}

export function takePendingStudioFiles(): { files: File[]; meta?: StudioHandoffMeta } {
  const out = pending;
  pending = { files: [] };
  return out;
}
