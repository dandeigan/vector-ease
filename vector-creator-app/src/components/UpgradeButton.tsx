"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import PricingDialog from "@/components/PricingDialog";

/** Gold "Upgrade" button that opens the Yearly / Lifetime pricing popup. Hidden for paid accounts and admins. */
export default function UpgradeButton({ label = "Upgrade" }: { label?: string }) {
  const { user, userRecord } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || userRecord?.subscriptionStatus === "active" || userRecord?.role === "superadmin") return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-md hover:shadow-lg transition-all hover:scale-[1.02] whitespace-nowrap"
      >
        <Zap className="w-3 h-3" />
        {label}
      </button>
      {open && <PricingDialog onClose={() => setOpen(false)} />}
    </>
  );
}
