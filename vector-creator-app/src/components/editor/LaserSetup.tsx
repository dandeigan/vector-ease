"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cpu, Pencil } from "lucide-react";
import { materialById, type MaterialId } from "@/lib/photo/engrave";
import {
  LASER_MODELS, fmtSpeed, loadLaser, looksTooHot, materialTestRange, modelLabel, onLaserChange, profileFor,
  recommendPhoto, saveLaser, startingSpread, type LaserKind, type LaserProfile,
} from "@/lib/photo/laser-profile";

/** The saved laser profile, kept in sync across components (null until loaded or if unset). */
export function useLaser(): LaserProfile | null {
  const [laser, setLaser] = useState<LaserProfile | null>(null);
  useEffect(() => {
    setLaser(loadLaser());
    return onLaserChange(() => setLaser(loadLaser()));
  }, []);
  return laser;
}

/** Photo engrave: "My laser" box with starting speed/power for the current material. */
export default function LaserSetup({ material, burnSpread, onUseSpread, disabled }: {
  material: MaterialId;
  burnSpread: number;
  onUseSpread: (v: number) => void;
  disabled?: boolean;
}) {
  const laser = useLaser();
  const [editing, setEditing] = useState(false);
  const [modelId, setModelId] = useState("");
  const [otherKind, setOtherKind] = useState<LaserKind>("diode");
  const [otherWatts, setOtherWatts] = useState(10);
  const [saveOpen, setSaveOpen] = useState(false);
  const [speed, setSpeed] = useState("");
  const [power, setPower] = useState("");
  const matLabel = materialById(material).label;

  const startEdit = () => {
    setModelId(laser?.modelId ?? "");
    if (laser?.modelId === "other") { setOtherKind(laser.kind); setOtherWatts(laser.watts); }
    setEditing(true);
  };

  const pick = () => {
    if (!modelId) return;
    saveLaser(profileFor(modelId, { kind: otherKind, watts: Math.max(1, Math.min(300, otherWatts || 1)) }, laser));
    setEditing(false);
  };

  const box = "rounded-xl border p-3";
  const label = (
    <div className="flex items-center gap-2">
      <Cpu className="w-3.5 h-3.5 text-dd-gold-400" />
      <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">My laser</span>
      {laser && !editing && (
        <button onClick={startEdit} disabled={disabled} className="ml-auto inline-flex items-center gap-1 text-[11px] text-foreground-muted hover:text-dd-gold-400 disabled:opacity-40">
          <Pencil className="w-3 h-3" /> Change
        </button>
      )}
    </div>
  );

  if (!laser || editing) {
    return (
      <div className={`${box} border-dd-gold-400/40 bg-dd-gold-400/[0.04]`}>
        {label}
        <p className="text-[11px] text-foreground-muted mt-1.5 leading-relaxed">
          Pick your laser to get a starting speed and power for photos. Photos need far less power than cutting or solid fills: too much and the dots spread and the picture burns dark.
        </p>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={disabled}
          aria-label="Laser model"
          className="mt-2 w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50"
        >
          <option value="">Choose your laser...</option>
          <optgroup label="Diode lasers">
            {LASER_MODELS.filter((m) => m.kind === "diode").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </optgroup>
          <optgroup label="CO2 lasers">
            {LASER_MODELS.filter((m) => m.kind === "co2").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </optgroup>
          <option value="other">Other (enter type and watts)</option>
        </select>
        {modelId === "other" && (
          <div className="mt-2 flex items-center gap-2">
            <select
              value={otherKind}
              onChange={(e) => setOtherKind(e.target.value as LaserKind)}
              aria-label="Laser type"
              className="bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50"
            >
              <option value="diode">Diode</option>
              <option value="co2">CO2</option>
            </select>
            <input
              type="number" min={1} max={300} value={otherWatts}
              onChange={(e) => setOtherWatts(Number(e.target.value))}
              aria-label="Laser watts"
              className="w-16 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50"
            />
            <span className="text-xs text-foreground-muted">W (optical output)</span>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <button onClick={pick} disabled={disabled || !modelId} className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-dd-gold-400 text-black hover:bg-dd-gold-300 disabled:opacity-40">
            Save my laser
          </button>
          {laser && <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs border border-border text-foreground-muted hover:text-foreground">Cancel</button>}
        </div>
      </div>
    );
  }

  const est = recommendPhoto(laser, material);
  const mine = laser.saved?.[material];
  const range = materialTestRange(est, laser.maxSpeed);
  const hot = mine ? looksTooHot(mine, est) : false;
  const spreadStart = startingSpread(laser.kind, material);

  const saveMine = () => {
    const s = Math.round(Number(speed)), p = Math.round(Number(power));
    if (!(s >= 100 && s <= 200000) || !(p >= 1 && p <= 100)) return;
    saveLaser({ ...laser, saved: { ...(laser.saved ?? {}), [material]: { speed: s, power: p } } });
    setSaveOpen(false);
  };
  const forgetMine = () => {
    const saved = { ...(laser.saved ?? {}) };
    delete saved[material];
    saveLaser({ ...laser, saved });
  };

  return (
    <div className={`${box} border-border`}>
      {label}
      <div className="text-[11px] text-foreground mt-1">{modelLabel(laser)}</div>

      <div className="mt-2 rounded-lg bg-background/60 border border-border p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
          {mine ? `Your settings for ${matLabel}` : `Starting point for ${matLabel}`}
        </div>
        <div className="mt-1 text-xs">
          <b className="text-dd-gold-400">{fmtSpeed((mine ?? est).speed)}</b>
          <span className="text-foreground-muted"> at </span>
          <b className="text-dd-gold-400">{(mine ?? est).power}% power</b>
        </div>
        {mine ? (
          <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">
            From your own test. Our estimate was {fmtSpeed(est.speed)} at {est.power}%.{" "}
            <button onClick={forgetMine} className="underline hover:text-dd-gold-400">Forget mine</button>
          </p>
        ) : (
          <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">
            An estimate, not a final answer: boards and machines vary. Confirm it with LightBurn&apos;s <b className="text-foreground">Laser Tools → Material Test</b> on a scrap: Fill mode, line interval 0.1 mm, speed {range.speedLo.toLocaleString("en-US")} to {range.speedHi.toLocaleString("en-US")} mm/min, power {range.powerLo}% to {range.powerHi}%. Pick the square that&apos;s a rich dark brown, not black.
          </p>
        )}
        {hot && (
          <p className="mt-1.5 text-[10px] text-amber-400 leading-relaxed flex gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            That&apos;s more than twice the energy we&apos;d expect a photo to need. If it comes out dark or the eyes fill in, lower the power before raising Burn spread.
          </p>
        )}
      </div>

      {saveOpen ? (
        <div className="mt-2">
          <div className="text-[10px] text-foreground-muted mb-1">What worked in your Material Test on {matLabel}:</div>
          <div className="flex items-center gap-1.5">
            <input type="number" placeholder="Speed" value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Speed in mm per minute"
              className="w-20 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50" />
            <span className="text-[10px] text-foreground-muted">mm/min</span>
            <input type="number" placeholder="Power" value={power} onChange={(e) => setPower(e.target.value)} aria-label="Power percent"
              className="w-14 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-dd-gold-400/50" />
            <span className="text-[10px] text-foreground-muted">%</span>
            <button onClick={saveMine} className="ml-auto p-1.5 rounded-md bg-dd-gold-400 text-black hover:bg-dd-gold-300" aria-label="Save settings"><Check className="w-3.5 h-3.5" /></button>
          </div>
          <p className="text-[10px] text-foreground-muted mt-1">Speed is in mm/min. If your software shows mm/s, multiply by 60.</p>
        </div>
      ) : (
        <button
          onClick={() => { const s = mine ?? est; setSpeed(String(s.speed)); setPower(String(s.power)); setSaveOpen(true); }}
          disabled={disabled}
          className="mt-2 text-[11px] text-dd-gold-400 hover:underline disabled:opacity-40"
        >
          {mine ? "Update my settings" : "Save what worked for me"}
        </button>
      )}

      {burnSpread === 0 && spreadStart > 0 && (
        <p className="text-[10px] text-foreground-muted mt-2 leading-relaxed">
          Haven&apos;t burned the test card yet? Burn spread {spreadStart} is a good place to start on {matLabel.toLowerCase()} with this laser.{" "}
          <button onClick={() => onUseSpread(spreadStart)} disabled={disabled} className="text-dd-gold-400 hover:underline disabled:opacity-40">Use {spreadStart}</button>
        </p>
      )}
    </div>
  );
}
