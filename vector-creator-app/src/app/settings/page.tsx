"use client";

import { useAuth } from "@/components/auth/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { updateUserRecord } from "@/lib/firebase/users";
import {
  ArrowLeft, Camera, User, Phone, Lock, CreditCard,
  Calendar, Zap, Check, AlertCircle,
} from "lucide-react";

export default function SettingsPage() {
  const { user, userRecord, loading, trialDaysLeft, trialExpired } = useAuth();
  const router = useRouter();

  // Profile state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (userRecord) {
      setFullName(userRecord.displayName || "");
      setPhone(userRecord.phone || "");
    }
    if (user?.photoURL) {
      setPhotoURL(user.photoURL);
    }
  }, [userRecord, user]);

  const handleSaveProfile = async () => {
    if (!user || !userRecord) return;
    setSaving(true);
    try {
      await updateProfile(user, { displayName: fullName });
      await updateUserRecord(user.uid, { displayName: fullName, phone });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save profile:", err);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Convert to base64 data URL for simplicity
    // For production, upload to Firebase Storage
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setPhotoURL(dataUrl);
      try {
        await updateProfile(user, { photoURL: dataUrl });
      } catch (err) {
        console.error("Failed to update photo:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleChangePassword = async () => {
    if (!user || !user.email) return;
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match");
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err: any) {
      const msg = err.message?.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim();
      setPasswordError(msg || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-2 border-dd-gold-400 border-t-transparent rounded-full animate-smooth-spin" />
      </div>
    );
  }

  const formatDate = (ts: any) => {
    if (!ts) return "N/A";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b border-border bg-background-raised/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="p-2 rounded-lg hover:bg-dd-gold-400/10 text-foreground-muted hover:text-dd-gold-400 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-base font-bold tracking-tight">Settings</h1>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* ── Profile ── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold text-dd-gold-400 uppercase tracking-wider mb-6">Profile</h2>

          {/* Avatar */}
          <div className="flex items-center gap-5 mb-6">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-2xl bg-background-overlay border border-border flex items-center justify-center cursor-pointer group overflow-hidden"
            >
              {photoURL ? (
                <img src={photoURL} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-foreground-muted" />
              )}
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>
            <div>
              <p className="text-sm font-medium">{fullName || "No name set"}</p>
              <p className="text-xs text-foreground-muted">{user.email}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-dd-gold-400 hover:text-dd-gold-300 mt-1 transition-colors"
              >
                Change photo
              </button>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email</label>
              <input
                type="email"
                value={user.email || ""}
                disabled
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm text-foreground-muted cursor-not-allowed opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-gold-400/50 focus:ring-1 focus:ring-dd-gold-400/20 transition-all"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-md glow-gold hover:shadow-lg transition-all hover:scale-[1.01] disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : saving ? (
              <div className="w-4 h-4 border-2 border-[#080B12]/30 border-t-[#080B12] rounded-full animate-smooth-spin" />
            ) : (
              "Save Changes"
            )}
          </button>
        </section>

        {/* ── Change Password ── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold text-dd-blue-400 uppercase tracking-wider mb-6">
            <Lock className="w-3.5 h-3.5 inline mr-1.5" />
            Change Password
          </h2>

          {passwordError && (
            <div className="bg-red-500/8 border border-red-500/15 text-red-400 p-3 rounded-lg mb-4 text-xs flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {passwordError}
            </div>
          )}
          {passwordSuccess && (
            <div className="bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 p-3 rounded-lg mb-4 text-xs flex items-center gap-2">
              <Check className="w-3.5 h-3.5 flex-shrink-0" />
              Password changed successfully
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-blue-400/50 focus:ring-1 focus:ring-dd-blue-400/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-blue-400/50 focus:ring-1 focus:ring-dd-blue-400/20 transition-all"
                placeholder="Minimum 6 characters"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-dd-blue-400/50 focus:ring-1 focus:ring-dd-blue-400/20 transition-all"
              />
            </div>
          </div>

          <button
            onClick={handleChangePassword}
            disabled={passwordSaving || !currentPassword || !newPassword}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-dd-blue-400/30 text-dd-blue-400 hover:bg-dd-blue-400/[0.05] transition-all disabled:opacity-30"
          >
            {passwordSaving ? (
              <div className="w-4 h-4 border-2 border-dd-blue-400/30 border-t-dd-blue-400 rounded-full animate-smooth-spin" />
            ) : (
              "Update Password"
            )}
          </button>
        </section>

        {/* ── Billing / Plan ── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold text-dd-gold-400 uppercase tracking-wider mb-6">
            <CreditCard className="w-3.5 h-3.5 inline mr-1.5" />
            Plan & Billing
          </h2>

          <div className="space-y-4">
            {/* Current Plan */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-background-overlay border border-border-subtle">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  userRecord?.subscriptionStatus === "active"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-dd-gold-400/10 text-dd-gold-400"
                }`}>
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {userRecord?.subscriptionStatus === "active" ? "VectorEase Pro" : "Free Trial"}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {userRecord?.subscriptionStatus === "active"
                      ? "Full access to all features"
                      : trialExpired
                        ? "Trial expired"
                        : `${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} remaining`
                    }
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                userRecord?.subscriptionStatus === "active"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : trialExpired
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-dd-gold-400/10 text-dd-gold-400 border-dd-gold-400/20"
              }`}>
                {userRecord?.subscriptionStatus === "active" ? "Active" : trialExpired ? "Expired" : "Trial"}
              </span>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-background-overlay border border-border-subtle">
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3 text-foreground-muted" />
                  <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-medium">Joined</span>
                </div>
                <p className="text-xs font-medium">{formatDate(userRecord?.createdAt)}</p>
              </div>
              <div className="p-3 rounded-lg bg-background-overlay border border-border-subtle">
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3 text-foreground-muted" />
                  <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-medium">
                    {userRecord?.subscriptionStatus === "active" ? "Next Billing" : "Trial Ends"}
                  </span>
                </div>
                <p className="text-xs font-medium">{formatDate(userRecord?.trialExpiresAt)}</p>
              </div>
            </div>

            {/* Upgrade / Manage */}
            {userRecord?.subscriptionStatus !== "active" && (
              <div className="pt-2">
                <button className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-dd-gold-500 to-dd-gold-400 text-[#080B12] shadow-lg glow-gold-strong hover:shadow-xl transition-all hover:scale-[1.01]">
                  <Zap className="w-4 h-4" />
                  Upgrade to Pro — $85
                </button>
              </div>
            )}

            {userRecord?.subscriptionStatus === "active" && (
              <button className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border border-border text-foreground-muted hover:border-dd-blue-400/30 hover:text-dd-blue-400 transition-all">
                <CreditCard className="w-3.5 h-3.5" />
                Manage Billing & Payment Method
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
