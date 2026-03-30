"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message?.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim() || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Background effects */}
      <div className="absolute inset-0 grid-pattern" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-dd-gold-400/[0.04] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-dd-blue-500/[0.04] blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-[400px]">
        {/* Back to home */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-foreground-muted hover:text-dd-gold-400 transition-colors mb-8"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to home
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-8 glow-gold">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-dd-gold-400 to-dd-gold-600 flex items-center justify-center shadow-md">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M4 4L12 20L20 4" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                Vector<span className="text-dd-gold-400">Ease</span>
              </h2>
              <p className="text-xs text-foreground-muted">
                {isLogin ? "Welcome back" : "Create your account"}
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/8 border border-red-500/15 text-red-400 p-3 rounded-lg mb-5 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email</label>
              <input
                type="email"
                required
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all placeholder:text-foreground-muted/40"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Password</label>
              <input
                type="password"
                required
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all placeholder:text-foreground-muted/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg glow-gold-strong hover:shadow-xl transition-all duration-300 hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center mt-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-[#080B12]/30 border-t-[#080B12] rounded-full animate-smooth-spin" />
              ) : isLogin ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-xs">
            <span className="text-foreground-muted">
              {isLogin ? "Don\u2019t have an account?" : "Already have an account?"}
            </span>{" "}
            <button
              onClick={() => { setIsLogin(!isLogin); setError(""); }}
              className="text-dd-gold-400 hover:text-dd-gold-300 font-medium transition-colors"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
