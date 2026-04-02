"use client";

import { useAuth } from "@/components/auth/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogOut, ShieldCheck, Clock, Zap } from "lucide-react";
import Workspace from "@/components/editor/Workspace";
import UpgradeButton from "@/components/UpgradeButton";

export default function DashboardPage() {
  const { user, loading, isSuperAdmin, trialExpired, trialDaysLeft, logout } = useAuth();
  const router = useRouter();

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
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Top Bar ── */}
      <nav className="border-b border-border bg-background-raised/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-dd-gold-400 to-dd-gold-600 flex items-center justify-center shadow-md">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M4 4L12 20L20 4" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-base font-bold tracking-tight">
              Vector<span className="text-dd-gold-400">Ease</span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <UpgradeButton />
            {isSuperAdmin && (
              <button
                onClick={() => router.push("/admin")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-dd-gold-400/10 text-dd-gold-400 border border-dd-gold-400/20 hover:bg-dd-gold-400/20 transition-all"
              >
                <ShieldCheck className="w-3 h-3" />
                Admin
              </button>
            )}
            <span className="text-xs text-foreground-muted hidden md:block truncate max-w-[200px]">{user.email}</span>
            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-dd-gold-400/10 text-foreground-muted hover:text-dd-gold-400 transition-all duration-200"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Trial Banner ── */}
      {!isSuperAdmin && !trialExpired && trialDaysLeft <= 7 && (
        <div className="bg-dd-gold-400/10 border-b border-dd-gold-400/20 px-5 py-2.5 flex items-center justify-center gap-3">
          <Clock className="w-4 h-4 text-dd-gold-400" />
          <span className="text-xs font-medium text-dd-gold-400">
            {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left in your free trial
          </span>
          <UpgradeButton />
        </div>
      )}

      {/* ── Trial Expired Overlay ── */}
      {trialExpired && !isSuperAdmin && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center rounded-2xl border border-border bg-card p-10 glow-gold">
            <div className="w-16 h-16 rounded-2xl bg-dd-gold-400/10 text-dd-gold-400 flex items-center justify-center mx-auto mb-6">
              <Zap className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Trial Ended</h2>
            <p className="text-foreground-muted text-sm mb-6">
              Your 30-day free trial has expired. Upgrade to VectorEase Pro to continue creating laser-ready vectors.
            </p>
            <UpgradeButton />
          </div>
        </div>
      )}

      {/* ── Workspace ── */}
      {(!trialExpired || isSuperAdmin) && (
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-5 py-6">
          <Workspace />
        </main>
      )}
    </div>
  );
}
