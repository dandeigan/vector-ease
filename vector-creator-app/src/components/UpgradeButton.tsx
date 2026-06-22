"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { Zap } from "lucide-react";

export default function UpgradeButton() {
  const { user, userRecord } = useAuth();
  const [loading, setLoading] = useState(false);

  // Don't show if already active or if Stripe isn't configured
  if (!user || userRecord?.subscriptionStatus === "active") return null;

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/checkout_sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid }),
      });

      const data = await res.json();

      if (data.error) {
        console.error("[UpgradeButton] Checkout session API error:", data.error);
        setLoading(false);
        return;
      }

      // Redirect to Stripe Checkout using the session URL directly.
      // stripe.redirectToCheckout() was deprecated 2025-09-30 — this is the new pattern.
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("[UpgradeButton] No checkout URL returned from API");
        setLoading(false);
      }
    } catch (err) {
      console.error("[UpgradeButton] Checkout failed:", err);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-md hover:shadow-lg transition-all hover:scale-[1.02] disabled:opacity-50"
    >
      {loading ? (
        <div className="w-3 h-3 border-2 border-[#080B12]/30 border-t-[#080B12] rounded-full animate-smooth-spin" />
      ) : (
        <Zap className="w-3 h-3" />
      )}
      Get Lifetime — $39
    </button>
  );
}
