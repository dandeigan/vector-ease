import { bakePath, ellipsePath, multiply, polyPath, rectPath, scaleMatrix, translate } from "./geometry";
import { DEFAULT_LAYERS, IMAGE_LAYER, guessLayerFromColors, parseColor } from "./layers";
import type { ImportedDesign, ImportedItem, Matrix } from "./types";

/**
 * SVG importer. Mounts the SVG off-screen and lets the browser resolve
 * transforms, viewBox, units and CSS, then reads every shape back out in
 * millimetres (96 CSS px = 1 inch, the SVG standard used by Inkscape,
 * Illustrator, LightBurn and Glowforge).
 */

const PX_TO_MM = 25.4 / 96;
const SHAPES = "path, rect, circle, ellipse, line, polyline, polygon, image";
const NON_RENDERED = "defs, clipPath, mask, symbol, marker, pattern, metadata, title, desc";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function num(el: Element, attr: string, fallback = 0): number {
  const v = parseFloat(el.getAttribute(attr) ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function shapeToPath(el: Element): string {
  switch (el.tagName.toLowerCase()) {
    case "path":
      return el.getAttribute("d") ?? "";
    case "rect": {
      const rxA = el.getAttribute("rx"), ryA = el.getAttribute("ry");
      const rx = rxA != null ? num(el, "rx") : ryA != null ? num(el, "ry") : 0;
      const ry = ryA != null ? num(el, "ry") : rx;
      return rectPath(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), rx, ry);
    }
    case "circle":
      return ellipsePath(num(el, "cx"), num(el, "cy"), num(el, "r"), num(el, "r"));
    case "ellipse":
      return ellipsePath(num(el, "cx"), num(el, "cy"), num(el, "rx"), num(el, "ry"));
    case "line":
      return polyPath([num(el, "x1"), num(el, "y1"), num(el, "x2"), num(el, "y2")], false);
    case "polyline":
    case "polygon": {
      const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      return polyPath(pts, el.tagName.toLowerCase() === "polygon");
    }
  }
  return "";
}

/** Remove anything executable before the SVG touches the live document. */
function sanitize(root: Element) {
  root.querySelectorAll("script, foreignObject, iframe").forEach((n) => n.remove());
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "xlink:href") && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
}

/** Replace <use> with a <g> holding a copy of what it points at. */
function inlineUses(root: Element) {
  for (let pass = 0; pass < 5; pass++) {
    const uses = Array.from(root.querySelectorAll("use"));
    if (!uses.length) return;
    for (const use of uses) {
      const href = use.getAttribute("href") || use.getAttributeNS(XLINK_NS, "href") || "";
      const target = href.startsWith("#") ? root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) : null;
      const g = root.ownerDocument.createElementNS(SVG_NS, "g");
      const tf = [use.getAttribute("transform") ?? "", `translate(${num(use, "x")} ${num(use, "y")})`].join(" ");
      g.setAttribute("transform", tf);
      for (const a of ["fill", "stroke", "style", "class"]) {
        const v = use.getAttribute(a);
        if (v) g.setAttribute(a, v);
      }
      if (target && !target.contains(use)) {
        if (target.tagName.toLowerCase() === "symbol") {
          for (const child of Array.from(target.childNodes)) g.appendChild(child.cloneNode(true));
        } else {
          const clone = target.cloneNode(true) as Element;
          clone.removeAttribute("id");
          g.appendChild(clone);
        }
      }
      use.replaceWith(g);
    }
  }
}

/** Layer hint from ancestor group names, e.g. <g id="CUT"> or inkscape:label="Engrave". */
function layerFromAncestors(el: Element, root: Element): string | null {
  for (let p: Element | null = el; p && p !== root; p = p.parentElement) {
    const label = `${p.getAttribute("id") ?? ""} ${p.getAttribute("inkscape:label") ?? ""} ${p.getAttribute("class") ?? ""}`.toLowerCase();
    if (/\bcut\b|cutting|outline/.test(label)) return "cut";
    if (/score|line.?engrave/.test(label)) return "score";
    if (/engrav|fill/.test(label)) return "engrave";
  }
  return null;
}

function toHex(c: string | null): string | undefined {
  const rgb = c ? parseColor(c) : null;
  return rgb ? "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
}

function toMatrix(m: DOMMatrix): Matrix {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

export async function importSvg(file: File | Blob, fileName = "SVG design"): Promise<ImportedDesign> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const parsed = doc.documentElement;
  if (!parsed || parsed.tagName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("This SVG file couldn't be read. It may be damaged or not really an SVG.");
  }

  sanitize(parsed);
  inlineUses(parsed);

  // Give the SVG a definite size. Without width/height, treat viewBox units as px (SVG default).
  const vb = (parsed.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  for (const [attr, idx] of [["width", 2], ["height", 3]] as const) {
    const v = parsed.getAttribute(attr);
    if (!v || v.trim().endsWith("%")) {
      if (hasVb) parsed.setAttribute(attr, String(vb[idx]));
      else parsed.removeAttribute(attr);
    }
  }

  const host = document.createElement("div");
  // opacity, not visibility: visibility is inherited and would make every shape look hidden.
  host.style.cssText = "position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;";
  const svg = document.importNode(parsed, true) as unknown as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);

  const items: ImportedItem[] = [];
  const warnings: string[] = [];
  let skippedText = 0, skippedInvisible = 0, skippedExternal = 0;
  let usesImageLayer = false;

  try {
    const rootRect = svg.getBoundingClientRect();
    const toRootMm: Matrix = multiply(scaleMatrix(PX_TO_MM), translate(-rootRect.left, -rootRect.top));

    skippedText = svg.querySelectorAll("text").length;

    for (const el of Array.from(svg.querySelectorAll(SHAPES))) {
      if (el.closest(NON_RENDERED)) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const screen = (el as SVGGraphicsElement).getScreenCTM();
      if (!screen) continue;
      const m = multiply(toRootMm, toMatrix(screen));
      const tag = el.tagName.toLowerCase();

      if (tag === "image") {
        const href = el.getAttribute("href") || el.getAttributeNS(XLINK_NS, "href") || "";
        if (!href.startsWith("data:image/")) {
          skippedExternal++;
          continue;
        }
        usesImageLayer = true;
        items.push({
          kind: "image",
          dataUrl: href,
          width: num(el, "width"),
          height: num(el, "height"),
          transform: multiply(m, translate(num(el, "x"), num(el, "y"))),
          layerId: "image",
        });
        continue;
      }

      const d = shapeToPath(el);
      if (!d.trim()) continue;

      const fill = style.fill && style.fill !== "none" && (style.fill.startsWith("url(") || parseColor(style.fill)) ? style.fill : null;
      const stroke = style.stroke && style.stroke !== "none" && parseColor(style.stroke) ? style.stroke : null;
      if (!fill && !stroke) {
        skippedInvisible++;
        continue;
      }
      const layerId = layerFromAncestors(el, svg) ?? guessLayerFromColors(tag === "line" || tag === "polyline" ? null : fill, stroke);

      try {
        items.push({
          kind: "path",
          d: bakePath(d, m),
          layerId,
          name: el.getAttribute("id") ?? undefined,
          fillRule: style.fillRule === "evenodd" ? "evenodd" : "nonzero",
          sourceColor: toHex(fill ?? stroke),
        });
      } catch {
        // A malformed path shouldn't sink the whole file.
      }
    }
  } finally {
    host.remove();
  }

  if (skippedText) warnings.push(`${skippedText} text element${skippedText > 1 ? "s were" : " was"} skipped. Convert text to outlines in the original program, or retype it here with the Text tool.`);
  if (skippedExternal) warnings.push(`${skippedExternal} linked image${skippedExternal > 1 ? "s" : ""} (stored outside the file) couldn't be opened.`);
  if (skippedInvisible && !items.length) warnings.push(`${skippedInvisible} shapes had no fill or outline and were skipped.`);
  if (!items.length) throw new Error("No shapes were found in this SVG.");

  return {
    name: fileName.replace(/\.svg$/i, "").replace(/\+/g, " "),
    items,
    layers: usesImageLayer ? [...DEFAULT_LAYERS, IMAGE_LAYER] : DEFAULT_LAYERS,
    warnings,
  };
}
