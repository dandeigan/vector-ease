"use client";

import { useAuth } from "@/components/auth/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Flame } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import ConvertExports from "@/components/editor/ConvertExports";
import Workspace from "@/components/editor/Workspace";
import UpgradeButton from "@/components/UpgradeButton";
import { getVectorizationsRemaining, FREE_VECTORIZATIONS } from "@/lib/firebase/users";

export default function DashboardPage() {
  const { user, userRecord, loading } = useAuth();
  const router = useRouter();

  const remaining = userRecord ? getVectorizationsRemaining(userRecord) : 0;
  const isPaidOrAdmin =
    userRecord?.role === "superadmin" || userRecord?.subscriptionStatus === "active";
  const showQuotaBanner = !isPaidOrAdmin && userRecord != null;

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />
          <span className="text-sm text-foreground-muted">Loading workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <AppHeader active="convert" actions={<ConvertExports />} />

      {/* ── Quota Banner — only shown to trial users with ≤2 remaining ── */}
      {showQuotaBanner && remaining <= 2 && (
        <div className="shrink-0 bg-dd-gold-400/10 border-b border-dd-gold-400/20 px-5 py-2 flex items-center justify-center gap-3">
          <Flame className="w-4 h-4 text-dd-gold-400" />
          <span className="text-xs font-medium text-dd-gold-400">
            {remaining === 0
              ? `You've used all ${FREE_VECTORIZATIONS} free images. Lock in lifetime access for $39.`
              : `${remaining} of ${FREE_VECTORIZATIONS} free images left`}
          </span>
          <UpgradeButton />
        </div>
      )}

      <main className="flex-1 min-h-0 w-full p-4">
        <Workspace />
      </main>
    </div>
  );
}
