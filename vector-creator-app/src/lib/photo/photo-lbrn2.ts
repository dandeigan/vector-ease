/**
 * Photo engrave as a LightBurn project (.lbrn2): the dotted PNG embedded as a
 * Bitmap shape on one Image layer with speed, power, line interval and DPI
 * already set, so nothing has to be typed in LightBurn.
 *
 * Format taken from real LightBurn files (Bitmap shapes, CutSetting_Img):
 * - Shape W/H are the image size in mm from its own DPI (pHYs); XForm then
 *   scales and places the image's centre (LightBurn is Y-up).
 * - Speed is stored in mm/s.
 * - Image mode: VectorEase's dots are already pure black and white at one
 *   pixel per laser line, so LightBurn's Threshold mode burns exactly those
 *   dots (same as Pass-Through). The Grayscale dot style uses Grayscale.
 */

export interface PhotoLbrnOptions {
  png: Uint8Array;
  widthMm: number;
  heightMm: number;
  dpi: number;
  speedMmMin: number;
  powerPct: number;
  /** True for the Grayscale dot style (shades, not dots). */
  grayscale?: boolean;
  name?: string;
}

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function base64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return Buffer.from(bytes).toString("base64");
}

export function photoToLbrn2(o: PhotoLbrnOptions): string {
  const interval = 25.4 / o.dpi;
  const power = Math.max(0, Math.min(100, Math.round(o.powerPct)));
  const name = esc(o.name ?? "Photo engrave");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<LightBurnProject AppVersion="2.0.05" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    `    <CutSetting_Img type="Image">`,
    `        <index Value="0"/>`,
    `        <name Value="${name}"/>`,
    `        <minPower Value="0"/>`,
    `        <maxPower Value="${power}"/>`,
    `        <minPower2 Value="0"/>`,
    `        <maxPower2 Value="${power}"/>`,
    `        <speed Value="${fmt(o.speedMmMin / 60)}"/>`,
    `        <priority Value="0"/>`,
    `        <numPasses Value="1"/>`,
    `        <scanOpt Value="individual"/>`,
    `        <bidir Value="1"/>`,
    `        <crossHatch Value="0"/>`,
    `        <overscan Value="1"/>`,
    `        <overscanPercent Value="2.5"/>`,
    `        <interval Value="${fmt(interval)}"/>`,
    `        <angle Value="0"/>`,
    `        <negativeImage Value="0"/>`,
    `        <ditherMode Value="${o.grayscale ? "grayscale" : "threshold"}"/>`,
    `        <dpi Value="${fmt(o.dpi)}"/>`,
    `        <linkDPItoInterval Value="1"/>`,
    `    </CutSetting_Img>`,
    `    <Shape Type="Bitmap" CutIndex="0" W="${fmt(o.widthMm)}" H="${fmt(o.heightMm)}" Gamma="1" Contrast="0" Brightness="0" EnhanceAmount="0" EnhanceRadius="0" EnhanceDenoise="0" File="${name}.png" SourceHash="0" Data="${base64(o.png)}">`,
    `        <XForm>1 0 0 1 ${fmt(o.widthMm / 2)} ${fmt(o.heightMm / 2)}</XForm>`,
    `    </Shape>`,
    `</LightBurnProject>`,
  ].join("\n");
}
