/**
 * Photo engrave settings that belong to the user's wood and laser, not to one
 * image: the material they last used, the DPI, and the Burn spread they found
 * for each material with the test card. Kept in this browser so a new image
 * starts with them. Everything is optional: no storage = plain defaults.
 */
import { DEFAULT_ENGRAVE, materialById, MATERIALS, type EngraveOptions, type MaterialId } from "./engrave";

const KEY = "vectorease.engraveMemory.v1";

interface Memory {
  material?: MaterialId;
  dpi?: number;
  burnSpread?: Partial<Record<MaterialId, number>>;
}

function read(): Memory {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(KEY);
    const m = raw ? JSON.parse(raw) : {};
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/** Remember the material, DPI and that material's Burn spread. */
export function saveEngraveMemory(o: EngraveOptions) {
  try {
    if (typeof window === "undefined") return;
    const m = read();
    const next: Memory = {
      material: o.material,
      dpi: o.dpi,
      burnSpread: { ...(m.burnSpread ?? {}), [o.material]: o.burnSpread ?? 0 },
    };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: nothing to remember */
  }
}

/** The Burn spread remembered for a material (0 if none). */
export function rememberedSpread(material: MaterialId): number {
  const v = read().burnSpread?.[material];
  return typeof v === "number" && v >= 0 && v <= 5 ? v : 0;
}

/** Default settings with the remembered material, DPI and Burn spread applied. */
export function engraveDefaultsWithMemory(): EngraveOptions {
  const m = read();
  const material = m.material && MATERIALS.some((x) => x.id === m.material) ? m.material : DEFAULT_ENGRAVE.material;
  const mat = materialById(material);
  const dpi = typeof m.dpi === "number" && m.dpi >= 50 && m.dpi <= 1200 ? m.dpi : DEFAULT_ENGRAVE.dpi;
  return { ...DEFAULT_ENGRAVE, material, invert: mat.invert, dither: mat.dither, dpi, burnSpread: rememberedSpread(material) };
}
