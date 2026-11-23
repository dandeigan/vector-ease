import { util } from "fabric";
import type { Matrix } from "./types";

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a × b (apply b first, then a). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return util.multiplyTransformMatrices(a, b) as Matrix;
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function scaleMatrix(s: number): Matrix {
  return [s, 0, 0, s, 0, 0];
}

/** Parse "a b c d e f" (Bambu / Qt order, same as SVG matrix()). */
export function parseMatrixString(s: string | undefined): Matrix {
  if (!s) return IDENTITY;
  const n = s.trim().split(/[\s,]+/).map(Number);
  return n.length === 6 && n.every(Number.isFinite) ? (n as Matrix) : IDENTITY;
}

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

type SimpleCommand = (string | number)[];

/** Normalise any SVG path data into absolute M/L/C/Q/Z commands. */
export function simplifyPath(d: string): SimpleCommand[] {
  return util.makePathSimpler(util.parsePath(d)) as unknown as SimpleCommand[];
}

/** Apply a matrix to every point of simplified path commands and return path data. */
export function bakeCommands(cmds: SimpleCommand[], m: Matrix): string {
  const [a, b, c, d, e, f] = m;
  const out: string[] = [];
  for (const cmd of cmds) {
    const op = cmd[0] as string;
    const pts: string[] = [];
    for (let i = 1; i + 1 < cmd.length; i += 2) {
      const x = cmd[i] as number;
      const y = cmd[i + 1] as number;
      pts.push(fmt(a * x + c * y + e), fmt(b * x + d * y + f));
    }
    out.push(pts.length ? `${op} ${pts.join(" ")}` : op);
  }
  return out.join(" ");
}

/** Bake a matrix into raw path data. */
export function bakePath(d: string, m: Matrix): string {
  return bakeCommands(simplifyPath(d), m);
}

/** Bounding box of simplified commands (control points included: a safe over-estimate). */
export function commandBounds(cmds: SimpleCommand[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cmd of cmds) {
    for (let i = 1; i + 1 < cmd.length; i += 2) {
      const x = cmd[i] as number, y = cmd[i + 1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/* ── Primitive shapes as path data ── */

const K = 0.5522847498; // cubic bezier circle constant

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const ox = rx * K, oy = ry * K;
  return [
    `M ${fmt(cx + rx)} ${fmt(cy)}`,
    `C ${fmt(cx + rx)} ${fmt(cy + oy)} ${fmt(cx + ox)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)}`,
    `C ${fmt(cx - ox)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + oy)} ${fmt(cx - rx)} ${fmt(cy)}`,
    `C ${fmt(cx - rx)} ${fmt(cy - oy)} ${fmt(cx - ox)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)}`,
    `C ${fmt(cx + ox)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - oy)} ${fmt(cx + rx)} ${fmt(cy)}`,
    "Z",
  ].join(" ");
}

export function rectPath(x: number, y: number, w: number, h: number, rx = 0, ry = rx): string {
  rx = Math.min(Math.max(0, rx), w / 2);
  ry = Math.min(Math.max(0, ry), h / 2);
  if (!rx || !ry) return `M ${fmt(x)} ${fmt(y)} H ${fmt(x + w)} V ${fmt(y + h)} H ${fmt(x)} Z`;
  return [
    `M ${fmt(x + rx)} ${fmt(y)}`,
    `H ${fmt(x + w - rx)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)}`,
    `V ${fmt(y + h - ry)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w - rx)} ${fmt(y + h)}`,
    `H ${fmt(x + rx)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)}`,
    `V ${fmt(y + ry)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + rx)} ${fmt(y)}`,
    "Z",
  ].join(" ");
}

export function polyPath(points: number[], closed: boolean): string {
  if (points.length < 4) return "";
  let d = `M ${fmt(points[0])} ${fmt(points[1])}`;
  for (let i = 2; i + 1 < points.length; i += 2) d += ` L ${fmt(points[i])} ${fmt(points[i + 1])}`;
  return closed ? d + " Z" : d;
}

/** Heart, 100 × 90 units, top-left at 0,0. */
export function heartPath(size: number): string {
  const s = size / 100;
  const p = (x: number, y: number) => `${fmt(x * s)} ${fmt(y * s)}`;
  return [
    `M ${p(50, 90)}`,
    `C ${p(20, 68)} ${p(0, 50)} ${p(0, 28)}`,
    `C ${p(0, 12)} ${p(12, 0)} ${p(27, 0)}`,
    `C ${p(38, 0)} ${p(46, 6)} ${p(50, 15)}`,
    `C ${p(54, 6)} ${p(62, 0)} ${p(73, 0)}`,
    `C ${p(88, 0)} ${p(100, 12)} ${p(100, 28)}`,
    `C ${p(100, 50)} ${p(80, 68)} ${p(50, 90)}`,
    "Z",
  ].join(" ");
}

export function starPath(size: number, points = 5, innerRatio = 0.45): string {
  const r = size / 2;
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * innerRatio;
    const ang = (Math.PI * i) / points - Math.PI / 2;
    pts.push(r + rad * Math.cos(ang), r + rad * Math.sin(ang));
  }
  return polyPath(pts, true);
}
