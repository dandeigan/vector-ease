"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Small "i" button that shows step-by-step help. Opens on hover (desktop)
 * and on tap/click (touch), closes on mouse-out, outside click or Escape.
 */
export default function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const open = hover || pinned;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const WIDTH = 272;

  // Fixed positioning so the panel's scroll area never clips the help box.
  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.right - WIDTH + 8), window.innerWidth - WIDTH - 8);
    setPos({ top: r.bottom + 8, left });
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <div
      ref={ref}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors ${open ? "text-dd-gold-400" : "text-foreground-muted hover:text-dd-gold-400"}`}
        aria-label={`Help: ${title}`}
        aria-expanded={open}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && pos && (
        <div
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: WIDTH }}
          className="fixed z-[100] max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-background-raised shadow-2xl p-3 text-left text-[12px] leading-relaxed font-normal normal-case tracking-normal text-foreground"
        >
          <div className="text-[12px] font-semibold text-dd-gold-400 mb-1.5">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

/** Numbered steps for inside a HelpTip. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal pl-4 space-y-1 marker:text-foreground-muted">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ol>
  );
}
