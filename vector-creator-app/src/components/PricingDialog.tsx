"use client";

import { useEffect, useState } from "react";
import { Check, Flame, X } from "lucide-react";
import { LIFETIME_BADGE, PLANS, type PlanId } from "@/lib/pricing";
import { startCheckout } from "@/lib/checkout-client";

const INCLUDED = [
  "Unlimited image conversions",
  "Line art mode for drawings and sketches",
  "Exports for LightBurn, Bambu Suite, SVG and DXF",
  "The Studio: names, dates, shapes, cut and score lines",
];

/**
 * The one pricing popup: Yearly or Lifetime. Used by the Upgrade button, the
 * out-of-free-images paywall and Settings.
 */
export default function PricingDialog({
  onClose,
  title = "Unlock unlimited VectorEase",
  subtitle = "Pick the plan that suits you. Both include everything.",
}: {
  onClose: () => void;
  title?: string;
  subtitle?: string;
}) {
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !loading) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  const go = async (plan: PlanId) => {
    setError(null);
    setLoading(plan);
    const err = await startCheckout(plan);
    if (err) {
      setError(err);
      setLoading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-background/80 backdrop-blur-md p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="pricing-title" className="relative w-full max-w-2xl rounded-2xl border border-dd-gold-400/30 bg-card p-6 sm:p-8 shadow-2xl">
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-md text-foreground-muted hover:text-foreground" aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-dd-gold-400/10 text-dd-gold-400 flex items-center justify-center mx-auto mb-4">
            <Flame className="w-6 h-6" />
          </div>
          <h2 id="pricing-title" className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-foreground-muted mt-1.5">{subtitle}</p>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["yearly", "lifetime"] as const).map((id) => {
            const p = PLANS[id];
            const best = id === "lifetime";
            return (
              <div
                key={id}
                className={`relative rounded-xl border p-5 flex flex-col ${best ? "border-dd-gold-400/60 bg-dd-gold-400/[0.06]" : "border-border bg-background/40"}`}
              >
                {best && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-dd-gold-400 text-[#080B12]">
                    {LIFETIME_BADGE}
                  </span>
                )}
                <div className="text-sm font-semibold text-foreground-muted">{p.name}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold">${p.price}</span>
                  <span className="text-sm text-foreground-muted">{p.cadence}</span>
                </div>
                <p className="text-xs text-foreground-muted mt-2 leading-relaxed flex-1">{p.blurb}</p>
                <button
                  onClick={() => go(id)}
                  disabled={loading !== null}
                  className={`mt-4 w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
                    best
                      ? "bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] hover:scale-[1.01]"
                      : "border border-dd-gold-400/40 text-dd-gold-400 hover:bg-dd-gold-400/10"
                  }`}
                >
                  {loading === id ? "Opening checkout..." : p.checkoutLabel}
                </button>
              </div>
            );
          })}
        </div>

        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-foreground-muted">
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> {item}
            </li>
          ))}
        </ul>

        {error && <p className="mt-4 text-sm text-red-400 text-center">{error}</p>}
        <p className="mt-4 text-[11px] text-foreground-muted text-center">Secure checkout by Stripe. Prices in USD.</p>
      </div>
    </div>
  );
}
