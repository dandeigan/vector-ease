"use client";

import { useState } from "react";

/** Number box in mm that commits on Enter / blur. */
export default function MmInput({ label, value, onCommit, step = 0.1, suffix = "mm" }: { label?: string; value: number; onCommit: (v: number) => void; step?: number; suffix?: string }) {
  const [draft, setDraft] = useState(String(round(value)));
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);
  // Follow outside changes (e.g. dragging a handle) unless the user is typing.
  if (!focused && seen !== value) {
    setSeen(value);
    setDraft(String(round(value)));
  }
  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v > 0 && round(v) !== round(value)) onCommit(v);
    else setDraft(String(round(value)));
  };
  return (
    <label className="flex-1 flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:border-dd-gold-400/50">
      {label && <span className="text-[10px] font-bold text-foreground-muted">{label}</span>}
      <input
        type="number"
        step={step}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full min-w-0 bg-transparent text-sm font-mono focus:outline-none"
      />
      <span className="text-[10px] text-foreground-muted">{suffix}</span>
    </label>
  );
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}
