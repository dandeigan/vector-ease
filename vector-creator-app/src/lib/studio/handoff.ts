/**
 * Files picked on another page (e.g. a .lac dropped on Convert) waiting to be
 * opened in the Studio. Module state survives client-side navigation.
 */

export const STUDIO_EXTENSIONS = ["lac", "svg", "dxf"];

export function isStudioFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return STUDIO_EXTENSIONS.includes(ext) || file.type === "image/svg+xml";
}

let pending: File[] = [];

export function setPendingStudioFiles(files: File[]) {
  pending = files;
}

export function takePendingStudioFiles(): File[] {
  const out = pending;
  pending = [];
  return out;
}
