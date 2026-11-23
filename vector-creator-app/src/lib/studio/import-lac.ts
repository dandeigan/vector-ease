import JSZip from "jszip";
import { bakePath, ellipsePath, multiply, parseMatrixString, IDENTITY } from "./geometry";
import { DEFAULT_LAYERS, IMAGE_LAYER } from "./layers";
import type { ImportedDesign, ImportedItem, Matrix } from "./types";

/**
 * Bambu Suite .lac importer (format reverse-engineered from Bambu Suite 01.06).
 *
 * A .lac is a zip:
 *   2D/entry.json                  MakerWorld metadata (Title, Designer…)
 *   2D/2dmodel.json                canvas_list[].obj_list[] + components tree
 *   2D/Objects/<file>              embedded raster images
 *   Metadata2D/project_settings.json  per-object process_type (cut / engrave…)
 * Coordinates are millimetres, y-down, transforms are "a b c d e f".
 */

interface LacComponent { obj_id: number; transform?: string }
interface LacObject {
  obj_id: number;
  type: string;
  name?: string;
  path_data?: string;
  is_closed?: boolean;
  center_x?: number; center_y?: number; radius_x?: number; radius_y?: number;
  file_name?: string; width?: number; height?: number;
  components?: LacComponent[];
}
interface LacCanvas { components?: LacComponent[]; obj_list?: LacObject[] }

/**
 * Convert Bambu path_data to standard SVG path data.
 *
 * Bambu writes cubic curves as "C endX endY c1x c1y c2x c2y" (end point
 * FIRST), where SVG expects "C c1x c1y c2x c2y endX endY". Verified on a
 * circle in My First Christmas.lac. Seen commands: M, L, C, Z (absolute).
 * When the object is marked closed, every sub-path gets a Z.
 */
export function lacPathToSvg(pathData: string, isClosed: boolean): string {
  const tokens = pathData.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const out: string[] = [];
  let i = 0;
  let open = false; // a sub-path is in progress and not yet closed
  const nums = (n: number) => {
    const v = tokens.slice(i, i + n).map(Number);
    i += n;
    return v.length === n && v.every(Number.isFinite) ? v : null;
  };
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case "M": {
        if (open && isClosed) out.push("Z");
        const p = nums(2);
        if (!p) return out.join(" ");
        out.push(`M ${p[0]} ${p[1]}`);
        open = true;
        while (isNum()) { // implicit line-tos
          const q = nums(2);
          if (q) out.push(`L ${q[0]} ${q[1]}`);
        }
        break;
      }
      case "L":
        do {
          const p = nums(2);
          if (p) out.push(`L ${p[0]} ${p[1]}`);
        } while (isNum());
        break;
      case "C":
        do {
          const p = nums(6);
          if (p) out.push(`C ${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[0]} ${p[1]}`);
        } while (isNum());
        break;
      case "Z":
      case "z":
        out.push("Z");
        open = false;
        break;
      default:
        // Unknown command: skip its numbers rather than guess.
        while (isNum()) i++;
    }
  }
  if (open && isClosed) out.push("Z");
  return out.join(" ");
}

function layerForProcess(processType: string | undefined): string {
  const p = (processType || "").toLowerCase();
  if (p.includes("image")) return "image";
  if (p.includes("cut")) return "cut";
  if (p.includes("fill")) return "engrave";
  if (p.includes("line")) return "score";
  return "cut";
}

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "bmp") return "image/bmp";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export async function importLac(file: File | Blob, fileName = "Bambu design"): Promise<ImportedDesign> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("This doesn't look like a Bambu Suite .lac file (it isn't a valid zip).");
  }

  const modelFile = zip.file("2D/2dmodel.json");
  if (!modelFile) throw new Error("This .lac file has no 2D design inside (2D/2dmodel.json is missing).");
  const model = JSON.parse(await modelFile.async("string"));

  let title = fileName.replace(/\.lac$/i, "").replace(/\+/g, " ");
  const entryFile = zip.file("2D/entry.json");
  if (entryFile) {
    try {
      const entry = JSON.parse(await entryFile.async("string"));
      if (entry.Title) title = entry.Title;
    } catch { /* metadata is optional */ }
  }

  // obj_id → process type (which laser operation)
  const processById = new Map<number, string>();
  const settingsFile = zip.file("Metadata2D/project_settings.json");
  if (settingsFile) {
    try {
      const settings = JSON.parse(await settingsFile.async("string"));
      for (const cs of settings.canvas_settings ?? []) {
        for (const os of cs.object_settings ?? []) processById.set(os.obj_id, os.process_type);
      }
    } catch { /* fall back to defaults */ }
  }

  const canvases: LacCanvas[] = model.canvas_list ?? [];
  if (!canvases.length) throw new Error("This .lac file has an empty design.");
  const warnings: string[] = [];
  if (canvases.length > 1) warnings.push(`This file has ${canvases.length} canvases. Only the first one was opened.`);

  const canvas = canvases[0];
  const objects = new Map<number, LacObject>();
  for (const o of canvas.obj_list ?? []) objects.set(o.obj_id, o);

  const items: ImportedItem[] = [];
  const skipped = new Map<string, number>();
  let usesImageLayer = false;

  const visit = async (id: number, parent: Matrix, depth: number) => {
    const obj = objects.get(id);
    if (!obj || depth > 32) return;
    const layerId = layerForProcess(processById.get(id));

    if (obj.components && obj.components.length) {
      for (const c of obj.components) await visit(c.obj_id, multiply(parent, parseMatrixString(c.transform)), depth + 1);
      return;
    }

    if (obj.path_data) {
      const d = lacPathToSvg(obj.path_data, obj.is_closed !== false);
      if (d) items.push({ kind: "path", d: bakePath(d, parent), layerId, name: obj.name, fillRule: "evenodd" });
    } else if (obj.type === "EllipseObject" && obj.radius_x && obj.radius_y) {
      const d = ellipsePath(obj.center_x ?? obj.radius_x, obj.center_y ?? obj.radius_y, obj.radius_x, obj.radius_y);
      items.push({ kind: "path", d: bakePath(d, parent), layerId, name: obj.name, fillRule: "evenodd" });
    } else if (obj.type === "RasterImage" && obj.file_name && obj.width && obj.height) {
      const imgFile =
        zip.file(`2D/Objects/${obj.file_name}`) ||
        zip.file(new RegExp(obj.file_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"))[0];
      if (!imgFile) {
        skipped.set("missing image", (skipped.get("missing image") ?? 0) + 1);
        return;
      }
      const b64 = await imgFile.async("base64");
      usesImageLayer = true;
      items.push({
        kind: "image",
        dataUrl: `data:${mimeFor(obj.file_name)};base64,${b64}`,
        width: obj.width,
        height: obj.height,
        transform: parent,
        layerId: "image",
        name: obj.name,
      });
    } else {
      skipped.set(obj.type, (skipped.get(obj.type) ?? 0) + 1);
    }
  };

  const roots: LacComponent[] = canvas.components?.length
    ? canvas.components
    : (canvas.obj_list ?? []).filter((o) => o.type !== "AttachedGroup").map((o) => ({ obj_id: o.obj_id }));
  for (const r of roots) await visit(r.obj_id, multiply(IDENTITY, parseMatrixString(r.transform)), 0);

  for (const [type, n] of skipped) warnings.push(`${n} object${n > 1 ? "s" : ""} of type "${type}" couldn't be opened yet and ${n > 1 ? "were" : "was"} skipped.`);
  if (!items.length) throw new Error("No shapes could be read from this .lac file.");

  return {
    name: title,
    items,
    layers: usesImageLayer ? [...DEFAULT_LAYERS, IMAGE_LAYER] : DEFAULT_LAYERS,
    warnings,
  };
}
