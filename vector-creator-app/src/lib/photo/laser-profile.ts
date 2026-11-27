/**
 * "My laser": the user's machine, used to suggest a starting speed and power
 * for Photo engrave, the Material Test ranges to try, and to warn when a saved
 * setting looks far too hot for a photo.
 *
 * These are estimates, not answers. How dark one dot burns comes mostly from
 * the energy per millimetre of travel: watts x power% / speed. We scale one
 * calibrated starting point (a 22 W diode on maple at 6,000 mm/min and 25%)
 * by wattage, laser type and material. Users then confirm with a Material
 * Test and save what worked, which replaces the estimate from then on.
 *
 * Kept in this browser (localStorage), like the engrave memory.
 */
import type { MaterialId } from "./engrave";

export type LaserKind = "diode" | "co2";

export interface LaserModel {
  id: string;
  label: string;
  kind: LaserKind;
  /** Optical output, W. */
  watts: number;
  /** Top speed, mm/min. Only used to cap the suggestion. */
  maxSpeed: number;
}

/** Popular machines. Watts are optical output; speeds are approximate. */
export const LASER_MODELS: LaserModel[] = [
  { id: "falcon2-12", label: "Creality Falcon2 12W", kind: "diode", watts: 12, maxSpeed: 25000 },
  { id: "falcon2-22", label: "Creality Falcon2 22W", kind: "diode", watts: 22, maxSpeed: 25000 },
  { id: "falcon2-40", label: "Creality Falcon2 40W", kind: "diode", watts: 40, maxSpeed: 25000 },
  { id: "xtool-d1pro-10", label: "xTool D1 Pro 10W", kind: "diode", watts: 10, maxSpeed: 24000 },
  { id: "xtool-d1pro-20", label: "xTool D1 Pro 20W", kind: "diode", watts: 20, maxSpeed: 24000 },
  { id: "xtool-s1-20", label: "xTool S1 20W", kind: "diode", watts: 20, maxSpeed: 36000 },
  { id: "xtool-s1-40", label: "xTool S1 40W", kind: "diode", watts: 40, maxSpeed: 36000 },
  { id: "ortur-lm3-10", label: "Ortur Laser Master 3 10W", kind: "diode", watts: 10, maxSpeed: 20000 },
  { id: "sculpfun-s30-20", label: "Sculpfun S30 Pro Max 20W", kind: "diode", watts: 20, maxSpeed: 36000 },
  { id: "bambu-10", label: "Bambu Lab H2D laser 10W", kind: "diode", watts: 10, maxSpeed: 30000 },
  { id: "bambu-40", label: "Bambu Lab H2D laser 40W", kind: "diode", watts: 40, maxSpeed: 30000 },
  { id: "xtool-p2-55", label: "xTool P2 55W (CO2)", kind: "co2", watts: 55, maxSpeed: 36000 },
  { id: "co2-40", label: "CO2 40W (K40 style)", kind: "co2", watts: 40, maxSpeed: 24000 },
  { id: "co2-60", label: "CO2 60W", kind: "co2", watts: 60, maxSpeed: 30000 },
  { id: "co2-80", label: "CO2 80W", kind: "co2", watts: 80, maxSpeed: 30000 },
  { id: "co2-100", label: "CO2 100W", kind: "co2", watts: 100, maxSpeed: 30000 },
];

export interface LaserProfile {
  /** A LASER_MODELS id, or "other". */
  modelId: string;
  kind: LaserKind;
  watts: number;
  maxSpeed: number;
  /** What worked in the user's own Material Test, per material. */
  saved?: Partial<Record<MaterialId, LaserSetting>>;
}

export interface LaserSetting {
  /** mm/min */
  speed: number;
  /** 0..100 */
  power: number;
}

/** Energy per mm (J/mm) for a photo on maple with a diode. 22 W x 25% at 100 mm/s. */
const BASE_DOSE = 0.055;
/** How much energy each material needs compared with maple. */
const MATERIAL_DOSE: Record<MaterialId, number> = {
  hardwood: 1, wood: 0.85, softwood: 0.8, leather: 0.6, paper: 0.35, slate: 1.3, darkmetal: 1.6,
};
/** CO2 light soaks into wood better than diode light. */
const KIND_DOSE: Record<LaserKind, number> = { diode: 1, co2: 0.8 };
const PREFERRED_SPEED: Record<LaserKind, number> = { diode: 6000, co2: 18000 };
const MIN_POWER: Record<LaserKind, number> = { diode: 5, co2: 10 };
const MAX_POWER = 60;

const roundSpeed = (s: number) => Math.max(500, Math.round(s / 500) * 500);
const powerAt = (dose: number, speed: number, watts: number) => (100 * dose * (speed / 60)) / watts;

/** Suggested starting speed (mm/min) and power (%) for a photo on this material. */
export function recommendPhoto(laser: Pick<LaserProfile, "kind" | "watts" | "maxSpeed">, material: MaterialId): LaserSetting {
  const watts = Math.max(1, laser.watts);
  const dose = BASE_DOSE * (MATERIAL_DOSE[material] ?? 1) * KIND_DOSE[laser.kind];
  let speed = Math.min(PREFERRED_SPEED[laser.kind], laser.maxSpeed * 0.6);
  let power = powerAt(dose, speed, watts);
  if (power > MAX_POWER) {
    // Not enough laser for this speed: slow down instead of maxing out power.
    speed = (MAX_POWER * watts * 60) / (100 * dose);
  } else if (power < MIN_POWER[laser.kind]) {
    // Very strong laser: go faster, up to its top speed.
    speed = Math.min(laser.maxSpeed * 0.8, (MIN_POWER[laser.kind] * watts * 60) / (100 * dose));
  }
  speed = Math.min(roundSpeed(speed), laser.maxSpeed);
  power = powerAt(dose, speed, watts);
  return { speed, power: Math.max(MIN_POWER[laser.kind], Math.min(100, Math.round(power))) };
}

/** Ranges for LightBurn's Material Test grid around a setting. */
export function materialTestRange(s: LaserSetting, maxSpeed: number) {
  return {
    speedLo: roundSpeed(s.speed / 2),
    speedHi: Math.min(roundSpeed(s.speed * 2), maxSpeed),
    powerLo: Math.max(5, Math.round(s.power / 2 / 5) * 5),
    powerHi: Math.min(100, Math.round((s.power * 2) / 5) * 5),
  };
}

/** Where to start Burn spread before the test card says otherwise. */
export function startingSpread(kind: LaserKind, material: MaterialId): number {
  const base: Partial<Record<MaterialId, number>> = { hardwood: 2, softwood: 3, wood: 2, leather: 1 };
  return Math.min(5, (base[material] ?? 0) + (kind === "co2" ? 1 : 0));
}

/** True when a saved setting is far hotter (energy per mm) than the estimate. */
export function looksTooHot(saved: LaserSetting, est: LaserSetting): boolean {
  return saved.power / saved.speed > 2 * (est.power / est.speed);
}

export const fmtSpeed = (mmMin: number) => `${mmMin.toLocaleString("en-US")} mm/min (${Math.round(mmMin / 60)} mm/s)`;

export function modelLabel(p: LaserProfile): string {
  return LASER_MODELS.find((m) => m.id === p.modelId)?.label ?? `${p.kind === "co2" ? "CO2" : "Diode"} ${p.watts}W`;
}

// ---- storage ----

const KEY = "vectorease.laser.v1";
const EVENT = "vectorease-laser-change";

export function loadLaser(): LaserProfile | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || (p.kind !== "diode" && p.kind !== "co2") || !(p.watts > 0) || !(p.maxSpeed > 0)) return null;
    return p as LaserProfile;
  } catch {
    return null;
  }
}

export function saveLaser(p: LaserProfile | null) {
  try {
    if (typeof window === "undefined") return;
    if (p) window.localStorage.setItem(KEY, JSON.stringify(p));
    else window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage blocked: the suggestion just won't be remembered */
  }
}

export function onLaserChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** A new profile from a model id, or "other" with a type and wattage. */
export function profileFor(modelId: string, other?: { kind: LaserKind; watts: number }, keep?: LaserProfile | null): LaserProfile {
  const m = LASER_MODELS.find((x) => x.id === modelId);
  const base = m
    ? { modelId: m.id, kind: m.kind, watts: m.watts, maxSpeed: m.maxSpeed }
    : { modelId: "other", kind: other?.kind ?? "diode", watts: other?.watts ?? 10, maxSpeed: other?.kind === "co2" ? 30000 : 20000 };
  // Saved results belong to the machine: keep them only if it's the same one.
  const same = keep && keep.modelId === base.modelId && keep.watts === base.watts && keep.kind === base.kind;
  return { ...base, saved: same ? keep!.saved : undefined };
}
