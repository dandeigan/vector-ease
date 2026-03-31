"use client";

/**
 * Converts an SVG string (from imagetracerjs) to a DXF string.
 * Each fill color becomes a separate DXF layer.
 * Paths are converted to polylines for LightBurn/Falcon compatibility.
 */

interface ParsedPath {
  color: string;
  points: [number, number][];
  closed: boolean;
}

/** Map common colors to AutoCAD ACI color indices */
function colorToACI(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  if (brightness > 230) return 7; // WHITE
  if (brightness < 30) return 0;  // BLACK (by layer)
  if (r > 170 && g < 90 && b < 90) return 1;  // RED
  if (r > 170 && g > 140 && b < 60) return 2;  // YELLOW
  if (r < 90 && g > 150 && b < 90) return 3;   // GREEN
  if (r < 90 && g > 140 && b > 140) return 4;   // CYAN
  if (r < 90 && g < 90 && b > 170) return 5;    // BLUE
  if (r > 140 && g < 70 && b > 140) return 6;   // MAGENTA
  return 7; // Default WHITE
}

/** Convert rgb(r,g,b) to #RRGGBB */
function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return rgb;
  return "#" + [m[1], m[2], m[3]].map((v) => parseInt(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Parse SVG path d attribute into simple point arrays.
 * Handles M, L, Q, Z commands (what imagetracerjs outputs).
 */
function parseSvgPath(d: string): { points: [number, number][]; closed: boolean } {
  const points: [number, number][] = [];
  let closed = false;

  // Normalize — insert spaces around letters
  const normalized = d.replace(/([a-zA-Z])/g, " $1 ").trim();
  const tokens = normalized.split(/[\s,]+/).filter(Boolean);

  let i = 0;
  let cx = 0, cy = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];

    if (cmd === "M" || cmd === "m") {
      const x = parseFloat(tokens[++i]);
      const y = parseFloat(tokens[++i]);
      cx = cmd === "M" ? x : cx + x;
      cy = cmd === "M" ? y : cy + y;
      points.push([cx, cy]);
      i++;
    } else if (cmd === "L" || cmd === "l") {
      const x = parseFloat(tokens[++i]);
      const y = parseFloat(tokens[++i]);
      cx = cmd === "L" ? x : cx + x;
      cy = cmd === "L" ? y : cy + y;
      points.push([cx, cy]);
      i++;
    } else if (cmd === "Q" || cmd === "q") {
      // Quadratic bezier — approximate with midpoint + endpoint
      const cpx = parseFloat(tokens[++i]);
      const cpy = parseFloat(tokens[++i]);
      const ex = parseFloat(tokens[++i]);
      const ey = parseFloat(tokens[++i]);

      if (cmd === "Q") {
        // Add a few interpolated points for curve approximation
        for (let t = 0.25; t <= 1; t += 0.25) {
          const px = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * cpx + t * t * ex;
          const py = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * cpy + t * t * ey;
          points.push([px, py]);
        }
        cx = ex;
        cy = ey;
      } else {
        const absCpx = cx + cpx;
        const absCpy = cy + cpy;
        const absEx = cx + ex;
        const absEy = cy + ey;
        for (let t = 0.25; t <= 1; t += 0.25) {
          const px = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * absCpx + t * t * absEx;
          const py = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * absCpy + t * t * absEy;
          points.push([px, py]);
        }
        cx = absEx;
        cy = absEy;
      }
      i++;
    } else if (cmd === "Z" || cmd === "z") {
      closed = true;
      i++;
    } else if (cmd === "H" || cmd === "h") {
      const x = parseFloat(tokens[++i]);
      cx = cmd === "H" ? x : cx + x;
      points.push([cx, cy]);
      i++;
    } else if (cmd === "V" || cmd === "v") {
      const y = parseFloat(tokens[++i]);
      cy = cmd === "V" ? y : cy + y;
      points.push([cx, cy]);
      i++;
    } else {
      // Try parsing as a number (implicit L command)
      const val = parseFloat(cmd);
      if (!isNaN(val) && i + 1 < tokens.length) {
        const y = parseFloat(tokens[++i]);
        cx = val;
        cy = y;
        points.push([cx, cy]);
      }
      i++;
    }
  }

  return { points, closed };
}

/**
 * Extract all paths with their colors from an SVG string.
 */
function extractPaths(svgString: string): ParsedPath[] {
  const paths: ParsedPath[] = [];
  const pathRegex = /<path[^>]*>/gi;
  let match;

  while ((match = pathRegex.exec(svgString)) !== null) {
    const tag = match[0];

    // Extract fill color
    const fillMatch = tag.match(/fill="(rgb\([^)]+\)|#[0-9a-fA-F]{6})"/i);
    if (!fillMatch) continue;
    const color = rgbToHex(fillMatch[1]).toUpperCase();

    // Extract d attribute
    const dMatch = tag.match(/d="([^"]+)"/);
    if (!dMatch) continue;

    const { points, closed } = parseSvgPath(dMatch[1]);
    if (points.length < 2) continue;

    paths.push({ color, points, closed });
  }

  return paths;
}

/**
 * Get SVG viewBox dimensions for Y-axis flipping.
 */
function getSvgDimensions(svgString: string): { width: number; height: number } {
  const vbMatch = svgString.match(/viewBox="([^"]+)"/);
  if (vbMatch) {
    const parts = vbMatch[1].split(/[\s,]+/).map(Number);
    return { width: parts[2] || 100, height: parts[3] || 100 };
  }
  const wMatch = svgString.match(/width="(\d+)"/);
  const hMatch = svgString.match(/height="(\d+)"/);
  return {
    width: wMatch ? parseInt(wMatch[1]) : 100,
    height: hMatch ? parseInt(hMatch[1]) : 100,
  };
}

/**
 * Convert SVG string to DXF string.
 * Each color becomes a layer. Paths become polylines.
 */
export function svgToDxf(svgString: string): string {
  // Dynamic import won't work client-side for CommonJS, so we build DXF manually
  const paths = extractPaths(svgString);
  const { height } = getSvgDimensions(svgString);

  // Group by color
  const colorGroups = new Map<string, ParsedPath[]>();
  for (const path of paths) {
    const group = colorGroups.get(path.color) || [];
    group.push(path);
    colorGroups.set(path.color, group);
  }

  // Build DXF string manually (dxf-writer is CommonJS, hard to use client-side)
  let layerIdx = 0;
  const layers: { name: string; color: number; aci: number }[] = [];
  const colorToLayer = new Map<string, string>();

  for (const [color] of colorGroups) {
    const name = `Layer_${layerIdx}`;
    layers.push({ name, color: layerIdx, aci: colorToACI(color) });
    colorToLayer.set(color, name);
    layerIdx++;
  }

  // DXF sections
  const dxf: string[] = [];

  // HEADER
  dxf.push("0", "SECTION", "2", "HEADER");
  dxf.push("9", "$ACADVER", "1", "AC1015"); // AutoCAD 2000
  dxf.push("9", "$INSUNITS", "70", "4"); // Millimeters
  dxf.push("0", "ENDSEC");

  // TABLES — layers
  dxf.push("0", "SECTION", "2", "TABLES");
  dxf.push("0", "TABLE", "2", "LAYER", "70", String(layers.length));
  for (const layer of layers) {
    dxf.push("0", "LAYER");
    dxf.push("2", layer.name);
    dxf.push("70", "0");
    dxf.push("62", String(layer.aci));
    dxf.push("6", "CONTINUOUS");
  }
  dxf.push("0", "ENDTAB");
  dxf.push("0", "ENDSEC");

  // ENTITIES — polylines
  dxf.push("0", "SECTION", "2", "ENTITIES");

  for (const [color, group] of colorGroups) {
    const layerName = colorToLayer.get(color)!;
    for (const path of group) {
      if (path.points.length < 2) continue;

      // LWPOLYLINE (lightweight polyline)
      dxf.push("0", "LWPOLYLINE");
      dxf.push("8", layerName); // Layer
      dxf.push("90", String(path.points.length)); // Number of vertices
      dxf.push("70", path.closed ? "1" : "0"); // Closed flag

      for (const [x, y] of path.points) {
        // Flip Y axis (SVG Y is top-down, DXF Y is bottom-up)
        dxf.push("10", String(x));
        dxf.push("20", String(height - y));
      }
    }
  }

  dxf.push("0", "ENDSEC");

  // EOF
  dxf.push("0", "EOF");

  return dxf.join("\n");
}
