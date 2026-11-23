import { ellipsePath, multiply, simplifyPath, IDENTITY } from "./geometry";
import { DEFAULT_LAYERS } from "./layers";
import type { ImportedDesign, ImportedItem, Matrix } from "./types";

/**
 * DXF importer (ASCII DXF, any version from R12 up).
 *
 * Reads LINE, LWPOLYLINE, POLYLINE (with arcs/bulges), CIRCLE, ARC, ELLIPSE,
 * SPLINE and INSERT (blocks, nested, scaled, rotated, arrayed). Everything is
 * converted to millimetres using $INSUNITS and flipped from DXF's y-up to the
 * Studio's y-down.
 *
 * DXF drawings are often made of hundreds of loose lines and arcs. Pieces
 * whose ends touch are joined into one continuous outline, so a box drawn as
 * four lines becomes one closed shape the laser can cut (or fill) in one go.
 */

type Pair = [number, string];

interface Entity {
  type: string;
  pairs: Pair[];
  vertices?: Entity[]; // POLYLINE → VERTEX records
}

interface Block {
  baseX: number;
  baseY: number;
  entities: Entity[];
}

interface DxfLayer {
  color: number;
  hidden: boolean;
}

interface Ctx {
  layerName: string;
  color: number;
}

/* ── tiny helpers ── */

const get = (e: Entity, code: number) => e.pairs.find((p) => p[0] === code)?.[1];
const num = (e: Entity, code: number, fallback = 0) => {
  const v = parseFloat(get(e, code) ?? "");
  return Number.isFinite(v) ? v : fallback;
};
const nums = (e: Entity, code: number) =>
  e.pairs.filter((p) => p[0] === code).map((p) => parseFloat(p[1])).filter(Number.isFinite);

const rotate = (deg: number): Matrix => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scale = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0];

/** Entities with a negative extrusion direction (mirrored in CAD) have their X axis flipped. */
const ocs = (e: Entity): Matrix => (num(e, 230, 1) < 0 ? [-1, 0, 0, 1, 0, 0] : IDENTITY);

const UNIT_TO_MM: Record<number, number> = {
  1: 25.4, // inches
  2: 304.8, // feet
  4: 1, // millimetres
  5: 10, // centimetres
  6: 1000, // metres
  8: 0.0000254, // microinches
  9: 0.0254, // mils
  10: 914.4, // yards
  14: 100, // decimetres
};

/* ── parsing ── */

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) throw new Error("This DXF file looks damaged (it couldn't be read line by line).");
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

/** Group the flat pair list into records that each start at a code-0 pair. */
function readRecords(pairs: Pair[]): Entity[] {
  const out: Entity[] = [];
  let cur: Entity | null = null;
  for (const p of pairs) {
    if (p[0] === 0) {
      cur = { type: p[1].toUpperCase(), pairs: [] };
      out.push(cur);
    } else if (cur) cur.pairs.push(p);
  }
  return out;
}

function parseDxf(text: string) {
  const records = readRecords(readPairs(text));
  const header = new Map<string, Pair[]>();
  const layers = new Map<string, DxfLayer>();
  const blocks = new Map<string, Block>();
  const entities: Entity[] = [];

  let section = "";
  let block: Block | null = null;
  let polyline: Entity | null = null;
  let inAttribs = false;

  for (const r of records) {
    if (r.type === "SECTION") {
      section = (get(r, 2) ?? "").toUpperCase();
      if (section === "HEADER") {
        let name = "";
        for (const p of r.pairs) {
          if (p[0] === 9) {
            name = p[1];
            header.set(name, []);
          } else if (name) header.get(name)!.push(p);
        }
      }
      continue;
    }
    if (r.type === "ENDSEC") { section = ""; continue; }

    if (section === "TABLES" && r.type === "LAYER") {
      const name = get(r, 2);
      if (name) {
        const color = num(r, 62, 7);
        layers.set(name, { color: Math.abs(color), hidden: color < 0 || (num(r, 70) & 1) === 1 });
      }
      continue;
    }

    if (section !== "BLOCKS" && section !== "ENTITIES") continue;

    if (r.type === "BLOCK") {
      block = { baseX: num(r, 10), baseY: num(r, 20), entities: [] };
      const name = get(r, 2);
      if (name) blocks.set(name, block);
      continue;
    }
    if (r.type === "ENDBLK") { block = null; continue; }

    // POLYLINE is followed by VERTEX records and closed by SEQEND.
    // INSERT may be followed by ATTRIB records, also closed by SEQEND.
    if (r.type === "VERTEX") { polyline?.vertices?.push(r); continue; }
    if (r.type === "ATTRIB") { inAttribs = true; continue; }
    if (r.type === "SEQEND") { polyline = null; inAttribs = false; continue; }
    if (inAttribs) continue;

    if (r.type === "POLYLINE") {
      r.vertices = [];
      polyline = r;
    }
    (block ? block.entities : entities).push(r);
  }

  return { header, layers, blocks, entities };
}

/* ── geometry → SVG path data (in the entity's own DXF coordinates, y-up) ── */

const f = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** One polyline segment, optionally curved by a DXF "bulge" (tan of a quarter of the arc angle). */
function bulgeSegment(x1: number, y1: number, x2: number, y2: number, bulge: number): string {
  const chord = Math.hypot(x2 - x1, y2 - y1);
  if (!bulge || Math.abs(bulge) < 1e-9 || chord < 1e-12) return `L ${f(x2)} ${f(y2)}`;
  const theta = 4 * Math.atan(Math.abs(bulge));
  const r = chord / (2 * Math.sin(theta / 2));
  return `A ${f(r)} ${f(r)} 0 ${theta > Math.PI ? 1 : 0} ${bulge > 0 ? 1 : 0} ${f(x2)} ${f(y2)}`;
}

function polylinePath(pts: { x: number; y: number; bulge: number }[], closed: boolean): string {
  if (pts.length < 2) return "";
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += " " + bulgeSegment(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, pts[i - 1].bulge);
  if (closed) {
    const a = pts[pts.length - 1], b = pts[0];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9 || a.bulge) d += " " + bulgeSegment(a.x, a.y, b.x, b.y, a.bulge);
    d += " Z";
  }
  return d;
}

function lwPolylinePoints(e: Entity) {
  const pts: { x: number; y: number; bulge: number }[] = [];
  for (const [code, v] of e.pairs) {
    if (code === 10) pts.push({ x: parseFloat(v), y: 0, bulge: 0 });
    else if (code === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v);
    else if (code === 42 && pts.length) pts[pts.length - 1].bulge = parseFloat(v) || 0;
  }
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Evaluate a (possibly rational) B-spline with de Boor's algorithm. */
function splinePoints(e: Entity): number[] | null {
  const degree = Math.max(1, Math.round(num(e, 71, 3)));
  const knots = nums(e, 40);
  const xs = nums(e, 10), ys = nums(e, 20);
  const weights = nums(e, 41);
  const n = Math.min(xs.length, ys.length);

  if (n >= degree + 1 && knots.length === n + degree + 1) {
    const ctrl = Array.from({ length: n }, (_, i) => {
      const w = weights.length === n && weights[i] > 0 ? weights[i] : 1;
      return [xs[i] * w, ys[i] * w, w];
    });
    const t0 = knots[degree], t1 = knots[n];
    if (!(t1 > t0)) return null;
    const samples = Math.min(4000, Math.max(24, (n - degree) * 16));
    const out: number[] = [];
    for (let s = 0; s <= samples; s++) {
      const t = t0 + ((t1 - t0) * s) / samples;
      let k = degree;
      while (k < n - 1 && !(t < knots[k + 1])) k++;
      const d = Array.from({ length: degree + 1 }, (_, j) => [...ctrl[k - degree + j]]);
      for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
          const i = k - degree + j;
          const den = knots[i + degree - r + 1] - knots[i];
          const a = den ? (t - knots[i]) / den : 0;
          for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
        }
      }
      const [hx, hy, hw] = d[degree];
      out.push(hx / hw, hy / hw);
    }
    return out;
  }

  // No usable control points: fall back to the fit points the curve passes through.
  const fx = nums(e, 11), fy = nums(e, 21);
  const m = Math.min(fx.length, fy.length);
  if (m >= 2) return Array.from({ length: m * 2 }, (_, i) => (i % 2 ? fy[(i - 1) / 2] : fx[i / 2]));
  return null;
}

/** Path data for one simple entity, or null if it isn't drawable geometry. */
function entityPath(e: Entity): string | null {
  switch (e.type) {
    case "LINE":
      return `M ${f(num(e, 10))} ${f(num(e, 20))} L ${f(num(e, 11))} ${f(num(e, 21))}`;
    case "LWPOLYLINE":
      return polylinePath(lwPolylinePoints(e), (num(e, 70) & 1) === 1) || null;
    case "POLYLINE": {
      const flags = num(e, 70);
      if (flags & (16 | 64)) return null; // 3D mesh / polyface: not 2D artwork
      const pts = (e.vertices ?? [])
        .filter((v) => !(num(v, 70) & 16)) // spline frame control points aren't on the curve
        .map((v) => ({ x: num(v, 10), y: num(v, 20), bulge: num(v, 42) }));
      return polylinePath(pts, (flags & 1) === 1) || null;
    }
    case "CIRCLE": {
      const r = num(e, 40);
      return r > 0 ? ellipsePath(num(e, 10), num(e, 20), r, r) : null;
    }
    case "ARC": {
      const cx = num(e, 10), cy = num(e, 20), r = num(e, 40);
      if (!(r > 0)) return null;
      const s = num(e, 50), en = num(e, 51, 360);
      const sweep = (((en - s) % 360) + 360) % 360;
      if (sweep < 1e-9) return ellipsePath(cx, cy, r, r);
      const a = (s * Math.PI) / 180, b = (en * Math.PI) / 180;
      return `M ${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))} A ${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(cx + r * Math.cos(b))} ${f(cy + r * Math.sin(b))}`;
    }
    case "ELLIPSE": {
      const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21);
      const ratio = num(e, 40, 1);
      const rx = Math.hypot(mx, my), ry = rx * ratio;
      if (!(rx > 0) || !(ry > 0)) return null;
      const rot = (Math.atan2(my, mx) * 180) / Math.PI;
      const pt = (t: number) => [cx + mx * Math.cos(t) - ratio * my * Math.sin(t), cy + my * Math.cos(t) + ratio * mx * Math.sin(t)];
      const s = num(e, 41, 0), en = num(e, 42, 2 * Math.PI);
      let span = (((en - s) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const full = span < 1e-9;
      if (full) span = 2 * Math.PI;
      const [x0, y0] = pt(s), [xm, ym] = pt(s + span / 2), [x1, y1] = pt(s + span);
      // Two half-arcs: always safe, even for a full ellipse.
      const arc = (x: number, y: number) => `A ${f(rx)} ${f(ry)} ${f(rot)} 0 1 ${f(x)} ${f(y)}`;
      return `M ${f(x0)} ${f(y0)} ${arc(xm, ym)} ${arc(x1, y1)}${full ? " Z" : ""}`;
    }
    case "SPLINE": {
      const pts = splinePoints(e);
      if (!pts || pts.length < 4) return null;
      let d = `M ${f(pts[0])} ${f(pts[1])}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${f(pts[i])} ${f(pts[i + 1])}`;
      return (num(e, 70) & 1) === 1 ? d + " Z" : d;
    }
  }
  return null;
}

/* ── pieces, joining and output ── */

type Seg = { op: "L" | "C" | "Q"; pts: number[] }; // pts = control points then end point
interface Piece { start: [number, number]; segs: Seg[]; closed: boolean; layerId: string }

function toPieces(d: string, m: Matrix, layerId: string): Piece[] {
  const [a, b, c, dd, e, ff] = m;
  const tx = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + dd * y + ff];
  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  for (const cmd of simplifyPath(d)) {
    const op = String(cmd[0]).toUpperCase();
    const raw = cmd.slice(1).map(Number);
    const pts: number[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) pts.push(...tx(raw[i], raw[i + 1]));
    if (op === "M") {
      cur = { start: [pts[0], pts[1]], segs: [], closed: false, layerId };
      pieces.push(cur);
    } else if (op === "Z") {
      if (cur) cur.closed = true;
    } else if (cur && (op === "L" || op === "C" || op === "Q") && pts.every(Number.isFinite)) {
      cur.segs.push({ op, pts });
    }
  }
  return pieces.filter((p) => p.segs.length && p.start.every(Number.isFinite));
}

const endOf = (p: Piece): [number, number] => {
  const s = p.segs[p.segs.length - 1].pts;
  return [s[s.length - 2], s[s.length - 1]];
};

function reversed(p: Piece): Piece {
  const points: [number, number][] = [p.start, ...p.segs.map((s) => [s.pts[s.pts.length - 2], s.pts[s.pts.length - 1]] as [number, number])];
  const segs: Seg[] = [];
  for (let i = p.segs.length - 1; i >= 0; i--) {
    const s = p.segs[i];
    const to = points[i];
    const ctrl: number[] = [];
    for (let j = s.pts.length - 4; j >= 0; j -= 2) ctrl.push(s.pts[j], s.pts[j + 1]);
    segs.push({ op: s.op, pts: [...ctrl, ...to] });
  }
  return { start: endOf(p), segs, closed: p.closed, layerId: p.layerId };
}

const TOL = 0.01; // mm: ends closer than this count as touching
const key = (x: number, y: number) => `${Math.round(x / TOL)},${Math.round(y / TOL)}`;
const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL;

/** Join open pieces on the same layer whose ends touch into longer (often closed) outlines. */
function joinPieces(pieces: Piece[]): Piece[] {
  const out = pieces.filter((p) => p.closed);
  const open = pieces.filter((p) => !p.closed);
  const used = new Uint8Array(open.length);
  const byEnd = new Map<string, number[]>();
  const index = (pt: [number, number], i: number) => {
    const k = key(pt[0], pt[1]);
    const list = byEnd.get(k);
    if (list) list.push(i);
    else byEnd.set(k, [i]);
  };
  open.forEach((p, i) => { index(p.start, i); index(endOf(p), i); });

  const take = (pt: [number, number], layerId: string): { piece: Piece; atStart: boolean } | null => {
    for (const i of byEnd.get(key(pt[0], pt[1])) ?? []) {
      if (used[i] || open[i].layerId !== layerId) continue;
      if (same(open[i].start, pt)) { used[i] = 1; return { piece: open[i], atStart: true }; }
      if (same(endOf(open[i]), pt)) { used[i] = 1; return { piece: open[i], atStart: false }; }
    }
    return null;
  };

  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain: Piece = { ...open[i], segs: [...open[i].segs] };
    // Grow forwards from the end…
    for (let next = take(endOf(chain), chain.layerId); next; next = take(endOf(chain), chain.layerId)) {
      const p = next.atStart ? next.piece : reversed(next.piece);
      chain.segs.push(...p.segs);
      if (same(endOf(chain), chain.start)) break;
    }
    // …then backwards from the start.
    if (!same(endOf(chain), chain.start)) {
      for (let prev = take(chain.start, chain.layerId); prev; prev = take(chain.start, chain.layerId)) {
        const p = prev.atStart ? reversed(prev.piece) : prev.piece; // p must END at chain.start
        chain = { ...chain, start: p.start, segs: [...p.segs, ...chain.segs] };
        if (same(endOf(chain), chain.start)) break;
      }
    }
    if (chain.segs.length > 1 && same(endOf(chain), chain.start)) chain.closed = true;
    out.push(chain);
  }
  return out;
}

const r3 = (n: number) => {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? "0" : String(v);
};

function pieceToPath(p: Piece): string {
  let d = `M ${r3(p.start[0])} ${r3(p.start[1])}`;
  for (const s of p.segs) d += ` ${s.op} ${s.pts.map(r3).join(" ")}`;
  return p.closed ? d + " Z" : d;
}

/* ── layers ── */

/** Pick a Studio layer from the DXF layer name, then its colour (blue = Score, like the SVG importer). */
function studioLayerFor(layerName: string, color: number): string {
  const n = layerName.toLowerCase();
  if (/score|line.?engrav|etch/.test(n)) return "score";
  if (/engrav|fill|raster/.test(n)) return "engrave";
  if (/cut|outline/.test(n)) return "cut";
  if (color === 5) return "score";
  return "cut";
}

const SKIP_LABELS: Record<string, string> = {
  TEXT: "text", MTEXT: "text", ATTDEF: "text",
  HATCH: "hatch fill", SOLID: "solid fill",
  DIMENSION: "dimension", LEADER: "leader", MLEADER: "leader", MULTILEADER: "leader",
  IMAGE: "linked image",
};
const IGNORE = new Set(["POINT", "VIEWPORT", "XLINE", "RAY", "WIPEOUT", "OLE2FRAME", "ACAD_TABLE", "TOLERANCE"]);

/* ── entry point ── */

export async function importDxf(file: File | Blob, fileName = "DXF design"): Promise<ImportedDesign> {
  const text = await file.text();
  if (text.startsWith("AutoCAD Binary DXF")) {
    throw new Error("This is a binary DXF. Save it as an ASCII (text) DXF in your CAD program and open it again.");
  }
  if (!/(^|\n)\s*0\s*\r?\n\s*SECTION/.test(text.slice(0, 5000))) {
    throw new Error("This doesn't look like a DXF file.");
  }

  const { header, layers, blocks, entities } = parseDxf(text);

  const insUnits = parseInt(header.get("$INSUNITS")?.find((p) => p[0] === 70)?.[1] ?? "0", 10);
  const unitMm = UNIT_TO_MM[insUnits];
  const k = unitMm ?? 1;
  // DXF is y-up; the Studio is y-down.
  const world: Matrix = [k, 0, 0, -k, 0, 0];

  const pieces: Piece[] = [];
  const skipped = new Map<string, number>();
  let hiddenSkipped = 0;
  const MAX_PIECES = 200_000;

  const walk = (list: Entity[], m: Matrix, parent: Ctx | null, depth: number) => {
    for (const e of list) {
      if (pieces.length > MAX_PIECES) return;
      if (num(e, 67) === 1) continue; // paper space (title blocks, sheet borders)
      if (num(e, 60) === 1) continue; // invisible entity

      let layerName = get(e, 8) ?? "0";
      if (layerName === "0" && parent) layerName = parent.layerName; // block entities on layer 0 take the insert's layer
      const layer = layers.get(layerName);
      if (layer?.hidden) { hiddenSkipped++; continue; }
      const rawColor = num(e, 62, 256);
      const color = rawColor === 0 ? parent?.color ?? 7 : rawColor === 256 ? layer?.color ?? 7 : Math.abs(rawColor);

      if (e.type === "INSERT") {
        const blk = blocks.get(get(e, 2) ?? "");
        if (!blk || depth > 16) continue;
        const cols = Math.max(1, Math.round(num(e, 70, 1))), rows = Math.max(1, Math.round(num(e, 71, 1)));
        const base = multiply(
          multiply(ocs(e), translate(num(e, 10), num(e, 20))),
          rotate(num(e, 50)),
        );
        const inner = multiply(scale(num(e, 41, 1) || 1, num(e, 42, 1) || 1), translate(-blk.baseX, -blk.baseY));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const t = multiply(multiply(base, translate(c * num(e, 44), r * num(e, 45))), inner);
            walk(blk.entities, multiply(m, t), { layerName, color }, depth + 1);
          }
        }
        continue;
      }

      const d = entityPath(e);
      if (!d) {
        if (!IGNORE.has(e.type)) {
          const label = SKIP_LABELS[e.type] ?? e.type;
          skipped.set(label, (skipped.get(label) ?? 0) + 1);
        }
        continue;
      }
      // LINE, SPLINE, ELLIPSE and 3D polylines use world coordinates; the rest use the entity's own (OCS).
      const worldCoords = e.type === "LINE" || e.type === "SPLINE" || e.type === "ELLIPSE" || (e.type === "POLYLINE" && num(e, 70) & 8);
      const own = worldCoords ? IDENTITY : ocs(e);
      try {
        pieces.push(...toPieces(d, multiply(m, own), studioLayerFor(layerName, color)));
      } catch {
        // one malformed entity shouldn't sink the whole drawing
      }
    }
  };
  walk(entities, world, null, 0);

  const joined = joinPieces(pieces);
  const items: ImportedItem[] = joined.map((p) => ({
    kind: "path",
    d: pieceToPath(p),
    layerId: p.layerId,
    fillRule: "evenodd",
  }));

  const warnings: string[] = [];
  if (!items.length) {
    const why = skipped.size ? ` It only has ${[...skipped.keys()].join(", ")} objects, which the Studio can't open yet.` : "";
    throw new Error(`No shapes could be read from this DXF.${why}`);
  }

  if (!unitMm) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of joined) {
      for (const pt of [p.start, ...p.segs.map((s) => s.pts.slice(-2))]) {
        minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
        minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
      }
    }
    const w = Math.round(maxX - minX), h = Math.round(maxY - minY);
    warnings.push(`This DXF doesn't say which units it uses, so it was opened as millimetres (${w} × ${h} mm). If it was drawn in inches, it will look 25.4 times too small: resize it in the side panel.`);
  }
  for (const [label, n] of skipped) {
    const extra = label === "text" ? " Convert text to outlines (explode it) in your CAD program, or retype it here with the Text tool." : "";
    warnings.push(`${n} ${label} object${n > 1 ? "s were" : " was"} left out.${extra}`);
  }
  if (hiddenSkipped) warnings.push(`${hiddenSkipped} object${hiddenSkipped > 1 ? "s" : ""} on hidden or frozen layers ${hiddenSkipped > 1 ? "were" : "was"} left out.`);
  if (pieces.length > MAX_PIECES) warnings.push("This drawing is very large, so only part of it was opened.");

  return {
    name: fileName.replace(/\.dxf$/i, "").replace(/\+/g, " "),
    items,
    layers: DEFAULT_LAYERS,
    warnings,
  };
}
