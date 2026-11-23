import opentype from "opentype.js";
import type { StudioTextSettings } from "./types";

/** Fonts bundled with the Studio (all SIL Open Font License, files in /public/fonts). */
export const FONTS = [
  { id: "great-vibes", label: "Great Vibes (script)", file: "great-vibes-latin-400-normal.woff" },
  { id: "dancing-script", label: "Dancing Script (script)", file: "dancing-script-latin-700-normal.woff" },
  { id: "pacifico", label: "Pacifico (rounded script)", file: "pacifico-latin-400-normal.woff" },
  { id: "montserrat-bold", label: "Montserrat Bold", file: "montserrat-latin-700-normal.woff" },
  { id: "montserrat", label: "Montserrat", file: "montserrat-latin-400-normal.woff" },
  { id: "playfair", label: "Playfair Display (serif)", file: "playfair-display-latin-700-normal.woff" },
  { id: "bebas", label: "Bebas Neue (tall caps)", file: "bebas-neue-latin-400-normal.woff" },
  { id: "amatic", label: "Amatic SC (hand-drawn)", file: "amatic-sc-latin-700-normal.woff" },
] as const;

export const DEFAULT_FONT_ID = "great-vibes";

type Font = ReturnType<typeof opentype.parse>;
const cache = new Map<string, Promise<Font>>();

export function loadFont(fontId: string): Promise<Font> {
  const def = FONTS.find((f) => f.id === fontId) ?? FONTS[0];
  let p = cache.get(def.id);
  if (!p) {
    p = fetch(`/fonts/${def.file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load the ${def.label} font.`);
        return r.arrayBuffer();
      })
      .then((buf) => opentype.parse(buf));
    p.catch(() => cache.delete(def.id));
    cache.set(def.id, p);
  }
  return p;
}

/** Register the bundled fonts with the browser so the font picker can preview them. */
export function registerFontFaces() {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  for (const f of FONTS) {
    const family = `studio-${f.id}`;
    if (Array.from(document.fonts).some((ff) => ff.family === family)) continue;
    const face = new FontFace(family, `url(/fonts/${f.file})`);
    document.fonts.add(face);
    face.load().catch(() => {});
  }
}

/**
 * Turn text into outline path data in millimetres, top-left at 0,0.
 * What you see in the Studio is exactly what gets exported: no font needed
 * on the laser computer.
 */
export async function textToPath(s: StudioTextSettings): Promise<string> {
  const font = await loadFont(s.fontId);
  const lines = (s.text || " ").split("\n");
  const size = Math.max(0.5, s.sizeMm);
  const lineGap = size * (s.lineHeight || 1.2);
  const scale = size / font.unitsPerEm;
  const ascender = font.ascender * scale;
  const spacing = s.letterSpacing || 0;

  // Simple glyph-by-glyph layout with kerning. We deliberately skip
  // opentype.js's shaping engine: it throws on some script fonts
  // (e.g. Great Vibes' contextual substitution tables).
  const layout = (line: string) => {
    const glyphs = Array.from(line).map((ch) => font.charToGlyph(ch));
    const xs: number[] = [];
    let x = 0;
    glyphs.forEach((g, i) => {
      xs.push(x);
      x += (Number(g.advanceWidth) || 0) * scale + spacing;
      const next = glyphs[i + 1];
      // Some fonts return undefined for certain pairs (e.g. Playfair GPOS);
      // an unguarded NaN here would corrupt every letter after it.
      if (next) x += (Number(font.getKerningValue(g, next)) || 0) * scale;
    });
    return { glyphs, xs, width: Math.max(0, x - spacing) };
  };

  const laid = lines.map(layout);
  const maxW = Math.max(...laid.map((l) => l.width), 0);

  const parts: string[] = [];
  laid.forEach(({ glyphs, xs, width }, i) => {
    const offset = s.align === "center" ? (maxW - width) / 2 : s.align === "right" ? maxW - width : 0;
    const baseline = ascender + i * lineGap;
    glyphs.forEach((g, j) => {
      const d = g.getPath(offset + xs[j], baseline, size).toPathData(3);
      if (d && !d.includes("NaN")) parts.push(d);
    });
  });
  return parts.join(" ") || `M 0 0`;
}
