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
        // Stripe not configured yet — silently skip
        console.log("Stripe not configured:", data.error);
        setLoading(false);
        return;
      }

      // Redirect to Stripe Checkout
      const { loadStripe } = await import("@stripe/stripe-js");
      const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!publishableKey) {
        console.log("Stripe publishable key not set");
        setLoading(false);
        return;
      }

      const stripe = await loadStripe(publishableKey);
      if (stripe) {
        await (stripe as any).redirectToCheckout({ sessionId: data.id });
      }
    } catch (err) {
      console.error("Checkout failed:", err);
    } finally {
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
      Upgrade to Pro — $85
    </button>
  );
}
