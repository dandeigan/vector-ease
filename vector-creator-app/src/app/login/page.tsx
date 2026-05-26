"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleForgotPassword = async () => {
    setError("");
    setResetMessage("");
    if (!email) {
      setError("Enter your email above, then click Forgot password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage("Password reset email sent. Check your inbox.");
    } catch (err: any) {
      setError(err.message?.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim() || "Could not send reset email");
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        // Set display name on Firebase Auth profile
        await updateProfile(cred.user, { displayName: fullName });
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

          {resetMessage && (
            <div className="bg-green-500/8 border border-green-500/15 text-green-400 p-3 rounded-lg mb-5 text-xs">
              {resetMessage}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {/* Full Name — signup only */}
            {!isLogin && (
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all placeholder:text-foreground-muted/40"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Smith"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all placeholder:text-foreground-muted/40"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-foreground-muted">Password</label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-dd-gold-400 hover:text-dd-gold-300 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                type="password"
                required
                autoComplete={isLogin ? "current-password" : "new-password"}
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
                "Start 15-Day Free Trial"
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
              {isLogin ? "Start free trial" : "Sign in"}
            </button>
          </div>
        </div>

        {/* Founders Club Callout */}
        <div className="hidden xl:block absolute left-[420px] bottom-[24px] w-[320px] pointer-events-none select-none">
          <div 
            className="text-[#EF4444] font-marker text-2xl leading-tight -rotate-3 max-w-[320px]"
            style={{ fontFamily: 'var(--font-permanent-marker)' }}
          >
            Not a member yet? Start your free trial. Founders Club locks in LIFETIME access when it ends.
          </div>
          <div className="relative mt-2 h-[120px] w-[200px] ml-4">
            <svg 
              width="160" 
              height="120" 
              viewBox="0 0 160 120" 
              fill="none" 
              stroke="#EF4444" 
              strokeWidth="4" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="absolute left-[-32px] top-0 transform rotate-[12deg]"
            >
              <path d="M 130 15 C 95 45, 55 75, 20 85" />
              <path d="M 35 68 L 18 85 L 35 98" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
