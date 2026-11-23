"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";

// The Studio draws on a <canvas> with Fabric.js, which only runs in the browser.
const Studio = dynamic(() => import("@/components/studio/Studio"), {
  ssr: false,
  loading: () => <Loading text="Loading Studio..." />,
});

function Loading({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />
        <span className="text-sm text-foreground-muted">{text}</span>
      </div>
    </div>
  );
}

export default function StudioPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user) return <Loading text="Loading..." />;
  return <Studio />;
}
