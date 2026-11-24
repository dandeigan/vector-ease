"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import UpgradeButton from "@/components/UpgradeButton";

/**
 * One top bar for the whole app, so Convert and Studio look and work the same:
 * logo · Convert/Studio switch · page title · page actions (New, Open, Export…) · account.
 */
export default function AppHeader({
  active,
  title,
  actions,
}: {
  active: "convert" | "studio";
  /** Shown after the switch (e.g. the design name). */
  title?: ReactNode;
  /** Page buttons, right-aligned: New, Open, then the gold Export buttons. */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const { user, isSuperAdmin, logout } = useAuth();

  const tab = (id: "convert" | "studio", label: string, href: string, hint: string) =>
    active === id ? (
      <span className="px-3 py-1 text-xs font-semibold rounded-md bg-dd-gold-400/15 text-dd-gold-400" aria-current="page">{label}</span>
    ) : (
      <button onClick={() => router.push(href)} title={hint} className="px-3 py-1 text-xs font-medium rounded-md text-foreground-muted hover:text-foreground">
        {label}
      </button>
    );

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background-raised flex items-center gap-3 px-4 relative z-40">
      <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 shrink-0" title="VectorEase home">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-dd-gold-400 to-dd-gold-600 flex items-center justify-center shadow-md">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 4L12 20L20 4" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="font-bold tracking-tight hidden sm:inline">Vector<span className="text-dd-gold-400">Ease</span></span>
      </button>

      <nav className="flex items-center rounded-lg border border-border p-0.5 shrink-0" aria-label="Switch tool">
        {tab("convert", "Convert", "/dashboard", "Turn a picture into laser layers")}
        {tab("studio", "Studio", "/studio", "Lay out laser files: add names, shapes, cut and score lines")}
      </nav>

      {title && <div className="min-w-0 flex-1 max-w-xs">{title}</div>}

      <div className="ml-auto flex items-center gap-2 min-w-0">{actions}</div>

      <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-border shrink-0">
        <span className="hidden xl:inline-flex"><UpgradeButton /></span>
        {isSuperAdmin && (
          <button onClick={() => router.push("/admin")} className="p-2 rounded-lg text-dd-gold-400 hover:bg-dd-gold-400/10" title="Admin">
            <ShieldCheck className="w-4 h-4" />
          </button>
        )}
        <button onClick={() => router.push("/settings")} className="p-2 rounded-lg text-foreground-muted hover:text-dd-gold-400 hover:bg-dd-gold-400/10" title={user?.email ? `Settings (${user.email})` : "Settings"}>
          <Settings className="w-4 h-4" />
        </button>
        <button onClick={logout} className="p-2 rounded-lg text-foreground-muted hover:text-dd-gold-400 hover:bg-dd-gold-400/10" title="Sign out">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
