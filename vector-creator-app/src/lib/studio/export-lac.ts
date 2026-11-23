import JSZip from "jszip";
import { simplifyPath } from "./geometry";
import { parseColor } from "./layers";

/**
 * Bambu Suite .lac writer. Format reverse-engineered from Bambu Suite 01.06
 * (see import-lac.ts and VectorEase_PROJECT_STATUS.md § 7) and confirmed by
 * opening the output in Bambu Suite 01.06 on 2026-11-23.
 *
 * Minimum package Bambu Suite accepts:
 *   [Content_Types].xml, _rels/.rels
 *   2D/2dmodel.json            objects (PathObject) + canvas components
 *   2D/entry.json              title
 *   Metadata2D/project_settings.json  per-object process type + a making
 *                              batch (material). Without the batch Suite
 *                              refuses the file ("can not find making_batch_list").
 * Coordinates are millimetres, y-down. Cubic curves are written
 * "C endX endY c1x c1y c2x c2y" (end point first), unlike SVG.
 */

export type LacOperation = "cut" | "score" | "engrave";

export interface LacShape {
  /** SVG path data in millimetres, y-down. */
  d: string;
  operation: LacOperation;
  /** Display colour (#RRGGBB) shown in Bambu Suite. */
  color: string;
  name?: string;
}

const PROCESS: Record<LacOperation, string> = {
  cut: "LaserLineCut",
  score: "LaserLineEngrave",
  engrave: "LaserFillEngrave",
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>
`;

const f = (n: number) => {
  const v = Math.round(n * 1e6) / 1e6;
  return Object.is(v, -0) ? "0" : String(v);
};

interface SubPath { data: string; closed: boolean }

/** Split SVG path data into LAC-style sub-paths (M/L/C only, curves end-point first, no Z). */
function toLacSubPaths(d: string): SubPath[] {
  const out: SubPath[] = [];
  let cur: string[] = [];
  let closed = false;
  let x = 0, y = 0, sx = 0, sy = 0;
  const flush = () => {
    if (cur.length > 1) out.push({ data: cur.join(" "), closed });
    cur = [];
    closed = false;
  };
  for (const cmd of simplifyPath(d)) {
    const op = String(cmd[0]).toUpperCase();
    const n = cmd.slice(1).map(Number);
    if (!n.every(Number.isFinite)) continue;
    if (op === "M") {
      flush();
      [x, y] = n; sx = x; sy = y;
      cur.push(`M ${f(x)} ${f(y)}`);
    } else if (op === "L") {
      [x, y] = n;
      cur.push(`L ${f(x)} ${f(y)}`);
    } else if (op === "C") {
      const [c1x, c1y, c2x, c2y, ex, ey] = n;
      cur.push(`C ${f(ex)} ${f(ey)} ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)}`);
      x = ex; y = ey;
    } else if (op === "Q") {
      // Quadratic → cubic (Bambu only uses cubics).
      const [qx, qy, ex, ey] = n;
      const c1x = x + (2 / 3) * (qx - x), c1y = y + (2 / 3) * (qy - y);
      const c2x = ex + (2 / 3) * (qx - ex), c2y = ey + (2 / 3) * (qy - ey);
      cur.push(`C ${f(ex)} ${f(ey)} ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)}`);
      x = ex; y = ey;
    } else if (op === "Z") {
      // Bambu closes the shape itself when is_closed is true; make sure it ends where it began.
      if (Math.abs(x - sx) > 1e-6 || Math.abs(y - sy) > 1e-6) cur.push(`L ${f(sx)} ${f(sy)}`);
      closed = true;
      x = sx; y = sy;
    }
  }
  flush();
  return out;
}

function rgba(hex: string): string {
  const c = parseColor(hex) ?? [0, 0, 0];
  return `${c[0]} ${c[1]} ${c[2]} 255`;
}

/** Build a .lac file. Returns null when there is nothing to write. */
export async function buildLac(opts: { title: string; shapes: LacShape[] }): Promise<{ blob: Blob; objectCount: number } | null> {
  const objects: Record<string, unknown>[] = [];
  const settings: { obj_id: number; process_type: string }[] = [];
  let id = 16;

  for (const s of opts.shapes) {
    let subs: SubPath[];
    try {
      subs = toLacSubPaths(s.d);
    } catch {
      continue;
    }
    // Closed outlines stay together (so holes in letters stay holes); open lines are separate objects.
    const closed = subs.filter((p) => p.closed);
    const groups: SubPath[][] = closed.length ? [closed] : [];
    for (const p of subs) if (!p.closed) groups.push([p]);

    for (const g of groups) {
      const objId = id++;
      objects.push({
        color: rgba(s.color),
        flags: ["FreeAspectRatio"],
        is_closed: g[0].closed,
        name: s.name || `${s.operation[0].toUpperCase()}${s.operation.slice(1)} ${objId - 15}`,
        obj_id: objId,
        path_data: g.map((p) => p.data).join(" "),
        type: "PathObject",
      });
      settings.push({ obj_id: objId, process_type: PROCESS[s.operation] });
    }
  }
  if (!objects.length) return null;

  const ids = objects.map((o) => o.obj_id as number);
  const today = new Date().toISOString().slice(0, 10);

  const model = {
    Application: "Bambu Suite",
    FileVersion: "01.06.00.00",
    canvas_list: [{
      components: ids.map((obj_id) => ({ obj_id, transform: "1 0 0 1 0 0" })),
      index: 1,
      name: "",
      obj_list: objects,
    }],
  };

  const projectSettings = {
    canvas_settings: [{
      index: 1,
      making_batch_list: [{
        auto_arranged: false,
        batch_settings: { classVersion: 3, processing_mode: "PLANE" },
        making_plate_list: [{ components: [], name: "", obj_id: 14, plate_mirror: false, plate_settings: { classVersion: 3 } }],
        // A starting material; the user picks their own in Bambu Suite.
        material_id: "B-YA-B-A-X0",
        material_name: "3mm Birch Plywood",
        material_settings_name: "3mm Birch Plywood",
        name: "",
        obj_id: 10,
        process_category: 1,
        unarranged_list: ids,
      }],
      object_settings: settings,
    }],
    project_settings: { classVersion: 3, version: null },
  };

  const entry = {
    Application: "Bambu Suite",
    FileVersion: "01.06.00.00",
    Title: opts.title,
    CreationDate: today,
    ModificationDate: today,
  };

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("2D/2dmodel.json", JSON.stringify(model));
  zip.file("2D/entry.json", JSON.stringify(entry));
  zip.file("Metadata2D/project_settings.json", JSON.stringify(projectSettings));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, objectCount: objects.length };
}
