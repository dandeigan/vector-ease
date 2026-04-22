"use client";

/**
 * Converts a VTracer SVG into a LightBurn .lbrn2 project file.
 *
 * Format reference: see loightburn-reference.lbrn2 at repo root.
 * - `CutSetting type="Cut"` = Line mode
 * - `CutSetting type="Scan"` = Fill mode
 * - `CutSetting type="Offset"` = Offset Fill mode
 * - LightBurn stores speed as mm/sec (UI shows mm/min) — divide by 60.
 * - LightBurn is Y-up; SVG is Y-down — Y-flip via XForm matrix on each Shape.
 * - 96dpi conversion (25.4/96 mm per SVG pixel) matches LightBurn's own SVG importer.
 */

export type LightBurnMode = "Line" | "Fill" | "Offset Fill";

export interface LbrnLayerConfig {
  color: string;          // hex #RRGGBB uppercase
  name: string;           // user-set layer name
  mode: LightBurnMode;
  speedMmMin: number;     // UI-facing unit
  powerPct: number;       // 0-100
}

interface Vertex {
  x: number;
  y: number;
  c0x?: number; c0y?: number;   // outgoing bezier handle
  c1x?: number; c1y?: number;   // incoming bezier handle
}

interface Segment {
  type: "L" | "B";
  from: number;
  to: number;
}

interface Subpath {
  color: string;
  vertices: Vertex[];
  segments: Segment[];
}

const MM_PER_SVG_PX = 25.4 / 96;  // LightBurn SVG importer convention
const EPS = 1e-4;

/* ─── SVG extraction ────────────────────────────────────────────── */

function rgbToHex(s: string): string {
  const m = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) {
    return "#" + [m[1], m[2], m[3]]
      .map((v) => parseInt(v).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return s.toUpperCase();
}

function getSvgViewBox(svg: string): { width: number; height: number } {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (vb) {
    const parts = vb[1].split(/[\s,]+/).map(Number);
    return { width: parts[2] || 100, height: parts[3] || 100 };
  }
  return { width: 100, height: 100 };
}

/** 2D affine transform as SVG matrix [a b c d e f] */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * Parse an SVG transform attribute into a composite matrix.
 * Supports translate(), scale(), and matrix(). VTracer only emits translate
 * in practice but we handle the common cases to be defensive.
 */
function parseTransform(attr: string | null | undefined): Matrix {
  if (!attr) return IDENTITY;
  let m: Matrix = [...IDENTITY] as Matrix;
  const re = /(matrix|translate|scale)\(([^)]+)\)/gi;
  let match;
  while ((match = re.exec(attr)) !== null) {
    const op = match[1].toLowerCase();
    const nums = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let next: Matrix;
    if (op === "translate") {
      next = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
    } else if (op === "scale") {
      const sx = nums[0] || 1;
      const sy = nums.length > 1 ? nums[1] : sx;
      next = [sx, 0, 0, sy, 0, 0];
    } else {
      next = [nums[0] || 1, nums[1] || 0, nums[2] || 0, nums[3] || 1, nums[4] || 0, nums[5] || 0];
    }
    m = multiplyMatrix(m, next);
  }
  return m;
}

/** Compose two 2D affine matrices: result = a * b (apply b first, then a). */
function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function extractPathTags(svg: string): { color: string; d: string; transform: Matrix }[] {
  const out: { color: string; d: string; transform: Matrix }[] = [];
  const re = /<path[^>]*>/gi;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const tag = m[0];
    const fill = tag.match(/fill="(rgb\([^)]+\)|#[0-9a-fA-F]{6})"/i);
    const d = tag.match(/d="([^"]+)"/);
    const tf = tag.match(/transform="([^"]+)"/);
    if (!fill || !d) continue;
    out.push({
      color: rgbToHex(fill[1]),
      d: d[1],
      transform: parseTransform(tf ? tf[1] : null),
    });
  }
  return out;
}

/** Apply a matrix to every vertex and bezier control point in a subpath. */
function transformSubpath(sub: Subpath, m: Matrix): void {
  for (const v of sub.vertices) {
    [v.x, v.y] = applyMatrix(m, v.x, v.y);
    if (v.c0x !== undefined && v.c0y !== undefined) {
      [v.c0x, v.c0y] = applyMatrix(m, v.c0x, v.c0y);
    }
    if (v.c1x !== undefined && v.c1y !== undefined) {
      [v.c1x, v.c1y] = applyMatrix(m, v.c1x, v.c1y);
    }
  }
}

/* ─── SVG path → subpaths ───────────────────────────────────────── */

/**
 * Parse an SVG `d` attribute into one or more subpaths.
 * Handles M, L, H, V, C, Z (plus lowercase relative variants).
 * VTracer only uses M/L/C/Z in practice.
 */
function parseSvgPathToSubpaths(d: string, color: string): Subpath[] {
  const subs: Subpath[] = [];
  let current: Subpath | null = null;
  const tokens = d.replace(/([a-zA-Z])/g, " $1 ").trim().split(/[\s,]+/).filter(Boolean);

  let i = 0;
  let cx = 0, cy = 0;           // current point
  let startX = 0, startY = 0;   // subpath start (for Z)
  let lastCmd = "";

  const beginSubpath = (x: number, y: number) => {
    current = { color, vertices: [{ x, y }], segments: [] };
    subs.push(current);
    startX = x;
    startY = y;
  };

  const addLineSegment = (x: number, y: number) => {
    if (!current) beginSubpath(cx, cy);
    const sub = current!;
    sub.vertices.push({ x, y });
    const to = sub.vertices.length - 1;
    sub.segments.push({ type: "L", from: to - 1, to });
  };

  const addCubicSegment = (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) => {
    if (!current) beginSubpath(cx, cy);
    const sub = current!;
    const lastV = sub.vertices[sub.vertices.length - 1];
    lastV.c0x = cp1x;
    lastV.c0y = cp1y;
    sub.vertices.push({ x, y, c1x: cp2x, c1y: cp2y });
    const to = sub.vertices.length - 1;
    sub.segments.push({ type: "B", from: to - 1, to });
  };

  const closeSubpath = () => {
    if (!current) return;
    const sub = current;
    const last = sub.vertices[sub.vertices.length - 1];
    // If the last vertex is essentially the start, merge: transfer its incoming
    // handle onto vertex 0 so the closing segment is still a bezier if needed.
    const distSq = (last.x - startX) ** 2 + (last.y - startY) ** 2;
    if (sub.vertices.length > 1 && distSq < EPS) {
      const first = sub.vertices[0];
      if (last.c1x !== undefined) first.c1x = last.c1x;
      if (last.c1y !== undefined) first.c1y = last.c1y;
      // Re-point any segment that landed on the duplicate last vertex to 0
      const droppedIdx = sub.vertices.length - 1;
      for (const seg of sub.segments) {
        if (seg.to === droppedIdx) seg.to = 0;
        if (seg.from === droppedIdx) seg.from = 0;
      }
      sub.vertices.pop();
    } else {
      // Add an explicit line back to the start to close
      sub.segments.push({ type: "L", from: sub.vertices.length - 1, to: 0 });
    }
    current = null;
  };

  while (i < tokens.length) {
    let cmd = tokens[i];
    const isNumber = !isNaN(parseFloat(cmd));

    // Implicit command repeat — reuse last command letter for bare numbers.
    if (isNumber) {
      cmd = lastCmd === "M" ? "L" : lastCmd === "m" ? "l" : lastCmd;
    } else {
      i++;
    }

    if (cmd === "M" || cmd === "m") {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      cx = cmd === "M" ? x : cx + x;
      cy = cmd === "M" ? y : cy + y;
      beginSubpath(cx, cy);
    } else if (cmd === "L" || cmd === "l") {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      cx = cmd === "L" ? x : cx + x;
      cy = cmd === "L" ? y : cy + y;
      addLineSegment(cx, cy);
    } else if (cmd === "H" || cmd === "h") {
      const x = parseFloat(tokens[i++]);
      cx = cmd === "H" ? x : cx + x;
      addLineSegment(cx, cy);
    } else if (cmd === "V" || cmd === "v") {
      const y = parseFloat(tokens[i++]);
      cy = cmd === "V" ? y : cy + y;
      addLineSegment(cx, cy);
    } else if (cmd === "C" || cmd === "c") {
      const cp1x = parseFloat(tokens[i++]);
      const cp1y = parseFloat(tokens[i++]);
      const cp2x = parseFloat(tokens[i++]);
      const cp2y = parseFloat(tokens[i++]);
      const ex = parseFloat(tokens[i++]);
      const ey = parseFloat(tokens[i++]);
      if (cmd === "C") {
        addCubicSegment(cp1x, cp1y, cp2x, cp2y, ex, ey);
        cx = ex; cy = ey;
      } else {
        addCubicSegment(cx + cp1x, cy + cp1y, cx + cp2x, cy + cp2y, cx + ex, cy + ey);
        cx += ex; cy += ey;
      }
    } else if (cmd === "Z" || cmd === "z") {
      closeSubpath();
      cx = startX; cy = startY;
    } else {
      // Unknown command — skip one token to avoid infinite loop
    }

    if (!isNumber) lastCmd = cmd;
  }

  // Auto-close any dangling subpath (VTracer usually emits explicit Z, but be defensive)
  if (current) closeSubpath();

  return subs;
}

/* ─── Subpath → VertList / PrimList encoding ────────────────────── */

function fmt(n: number): string {
  // Trim trailing zeros; keep up to 6 decimals
  return Number(n.toFixed(6)).toString();
}

function emitVertex(v: Vertex): string {
  // All VTracer vertices are sharp (handles not constrained to be collinear).
  // `S` prefix prevents LightBurn from auto-straightening bezier handles.
  let s = `SV${fmt(v.x)} ${fmt(v.y)}`;
  if (v.c0x !== undefined && v.c0y !== undefined) {
    s += `c0x${fmt(v.c0x)}c0y${fmt(v.c0y)}`;
  } else {
    s += `c0x1`;
  }
  if (v.c1x !== undefined && v.c1y !== undefined) {
    s += `c1x${fmt(v.c1x)}c1y${fmt(v.c1y)}`;
  } else {
    s += `c1x1`;
  }
  return s;
}

function encodeSubpath(sub: Subpath): { vertList: string; primList: string } {
  const vertList = sub.vertices.map(emitVertex).join("");
  const primList = sub.segments.map((s) => `${s.type}${s.from} ${s.to}`).join("");
  return { vertList, primList };
}

/* ─── XML escaping ──────────────────────────────────────────────── */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── Mode mapping ──────────────────────────────────────────────── */

function modeToType(mode: LightBurnMode): string {
  switch (mode) {
    case "Line": return "Cut";
    case "Fill": return "Scan";
    case "Offset Fill": return "Offset";
  }
}

/* ─── Public API ────────────────────────────────────────────────── */

export interface SvgToLbrn2Options {
  /**
   * Ordered list of layer configs. First entry = CutIndex 0, etc.
   * Only colors listed here are exported; others are skipped.
   */
  layers: LbrnLayerConfig[];
  /** Output width in mm. If not provided, uses 96dpi SVG convention. */
  widthMm?: number;
}

export function svgToLbrn2(svg: string, options: SvgToLbrn2Options): string {
  const { width: vbW, height: vbH } = getSvgViewBox(svg);
  const scale = options.widthMm ? options.widthMm / vbW : MM_PER_SVG_PX;
  const heightMm = vbH * scale;

  // Map each color to a CutIndex by the order of options.layers
  const colorToCutIndex = new Map<string, number>();
  options.layers.forEach((l, idx) => colorToCutIndex.set(l.color.toUpperCase(), idx));

  // Extract all paths, split into subpaths, group by color
  const pathTags = extractPathTags(svg);
  const subpathsByColor = new Map<string, Subpath[]>();
  for (const p of pathTags) {
    const color = p.color.toUpperCase();
    if (!colorToCutIndex.has(color)) continue;
    const subs = parseSvgPathToSubpaths(p.d, color);
    // Bake the path's transform into the subpath coords so the XForm stays uniform.
    for (const sub of subs) transformSubpath(sub, p.transform);
    const arr = subpathsByColor.get(color) ?? [];
    arr.push(...subs);
    subpathsByColor.set(color, arr);
  }

  // Build XML
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<LightBurnProject AppVersion="2.0.05" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`);

  // CutSettings (one per configured layer)
  options.layers.forEach((layer, idx) => {
    const type = modeToType(layer.mode);
    const speedMmSec = layer.speedMmMin / 60;
    lines.push(`    <CutSetting type="${type}">`);
    lines.push(`        <index Value="${idx}"/>`);
    lines.push(`        <name Value="${xmlEscape(layer.name)}"/>`);
    lines.push(`        <maxPower Value="${layer.powerPct}"/>`);
    lines.push(`        <maxPower2 Value="${layer.powerPct}"/>`);
    lines.push(`        <speed Value="${fmt(speedMmSec)}"/>`);
    lines.push(`        <priority Value="${idx}"/>`);
    lines.push(`    </CutSetting>`);
  });

  // Shapes — one per subpath
  // XForm: scale X by `scale`, flip Y by `-scale`, translate by (0, heightMm).
  const xform = `${fmt(scale)} 0 0 ${fmt(-scale)} 0 ${fmt(heightMm)}`;

  for (const layer of options.layers) {
    const color = layer.color.toUpperCase();
    const cutIdx = colorToCutIndex.get(color)!;
    const subs = subpathsByColor.get(color) ?? [];
    for (const sub of subs) {
      if (sub.vertices.length < 2) continue;
      const { vertList, primList } = encodeSubpath(sub);
      lines.push(`    <Shape Type="Path" CutIndex="${cutIdx}">`);
      lines.push(`        <XForm>${xform}</XForm>`);
      lines.push(`        <VertList>${vertList}</VertList>`);
      lines.push(`        <PrimList>${primList}</PrimList>`);
      lines.push(`    </Shape>`);
    }
  }

  lines.push(`</LightBurnProject>`);
  return lines.join("\n");
}

/* ─── Default per-mode presets (Dan's hardwood settings) ────────── */

export function defaultPresetForMode(mode: LightBurnMode): { speedMmMin: number; powerPct: number } {
  switch (mode) {
    case "Line":        return { speedMmMin: 6000, powerPct: 20 };
    case "Fill":        return { speedMmMin: 8000, powerPct: 90 };
    case "Offset Fill": return { speedMmMin: 6000, powerPct: 20 };
  }
}
