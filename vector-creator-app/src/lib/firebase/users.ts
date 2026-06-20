"use client";

import {
  doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  collection, query, orderBy, serverTimestamp, increment, Timestamp,
} from "firebase/firestore";
import { db } from "./config";

export interface UserRecord {
  uid: string;
  email: string;
  displayName: string;
  role: "user" | "superadmin";
  subscriptionStatus: "active" | "expired" | "trial" | "none";
  totalVectorizations: number;
  createdAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
  trialExpiresAt: Timestamp | null;
  /** Number of free image vectorizations remaining (decremented on first download of a new image). Starts at 5 for new signups. */
  vectorizationsRemaining?: number;
  /** SHA-256 hashes of source images the user has already downloaded any format of. Used to prevent double-counting multi-format downloads of the same image. */
  downloadedImageFingerprints?: string[];
}

/** Default free vectorizations granted to new trial signups */
export const FREE_VECTORIZATIONS = 5;

const USERS = "users";
const VECTORIZATIONS = "vectorizations";

/** Create or update user doc on login/signup */
export async function syncUserToFirestore(uid: string, email: string, displayName?: string) {
  const ref = doc(db, USERS, uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // First-time user — 15-day trial
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 15);

    const userName = displayName || email.split("@")[0];

    await setDoc(ref, {
      uid,
      email,
      displayName: userName,
      role: "user",
      subscriptionStatus: "trial",
      totalVectorizations: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      trialExpiresAt: Timestamp.fromDate(trialEnd),
      vectorizationsRemaining: FREE_VECTORIZATIONS,
      downloadedImageFingerprints: [],
    });

    // Add new signup to Brevo email marketing.
    // Calls our server-side API route so the Brevo API key stays server-only.
    // Fire-and-forget — never block signup on Brevo failures.
    try {
      fetch("/api/brevo-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          firstName: userName.split(" ")[0],
          lastName: userName.split(" ").slice(1).join(" "),
        }),
      }).catch(() => {});
    } catch {}
  } else {
    // Returning user — update last login
    await updateDoc(ref, { lastLoginAt: serverTimestamp() });
  }
}

/** Get single user */
export async function getUser(uid: string): Promise<UserRecord | null> {
  const snap = await getDoc(doc(db, USERS, uid));
  return snap.exists() ? (snap.data() as UserRecord) : null;
}

/** Get all users (admin) */
export async function getAllUsers(): Promise<UserRecord[]> {
  const q = query(collection(db, USERS), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserRecord);
}

/** Delete user doc (admin) */
export async function deleteUserRecord(uid: string) {
  await deleteDoc(doc(db, USERS, uid));
}

/** Update user fields (admin) */
export async function updateUserRecord(uid: string, data: Partial<UserRecord>) {
  await updateDoc(doc(db, USERS, uid), data);
}

/** Add manual user (admin) */
export async function addManualUser(email: string, role: "user" | "superadmin" = "user") {
  const uid = "manual_" + Date.now();
  await setDoc(doc(db, USERS, uid), {
    uid,
    email,
    displayName: email.split("@")[0],
    role,
    subscriptionStatus: "none",
    totalVectorizations: 0,
    createdAt: serverTimestamp(),
    lastLoginAt: null,
  });
  return uid;
}

/** Increment vectorization count + log it */
export async function logVectorization(uid: string) {
  // Increment counter on user doc
  await updateDoc(doc(db, USERS, uid), {
    totalVectorizations: increment(1),
  });

  // Log individual vectorization event
  const ref = doc(collection(db, VECTORIZATIONS));
  await setDoc(ref, {
    userId: uid,
    timestamp: serverTimestamp(),
  });
}

/** Check if user's trial has expired */
export function isTrialExpired(user: UserRecord): boolean {
  if (user.role === "superadmin") return false;
  if (user.subscriptionStatus === "active") return false;
  if (!user.trialExpiresAt) return true;
  const expiryDate = user.trialExpiresAt.toDate ? user.trialExpiresAt.toDate() : new Date(user.trialExpiresAt as any);
  return new Date() > expiryDate;
}

/** Get days remaining in trial */
export function getTrialDaysRemaining(user: UserRecord): number {
  if (!user.trialExpiresAt) return 0;
  const expiryDate = user.trialExpiresAt.toDate ? user.trialExpiresAt.toDate() : new Date(user.trialExpiresAt as any);
  const diff = expiryDate.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Get total vectorization count (admin stats) */
export async function getVectorizationStats() {
  const snap = await getDocs(collection(db, VECTORIZATIONS));
  return { total: snap.size };
}

/**
 * Compute a stable SHA-256 fingerprint of a source image data URL.
 * Used to deduplicate downloads — multiple format exports of the same
 * source image count as a single "vectorization" against the user's quota.
 */
export async function computeImageFingerprint(imageDataUrl: string): Promise<string> {
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Get how many free vectorizations remain for a user.
 * Paid users return Infinity. Superadmins return Infinity.
 * Users with the field missing (legacy) default to FREE_VECTORIZATIONS.
 */
export function getVectorizationsRemaining(user: UserRecord): number {
  if (user.role === "superadmin") return Infinity;
  if (user.subscriptionStatus === "active") return Infinity;
  return user.vectorizationsRemaining ?? FREE_VECTORIZATIONS;
}

/**
 * Check whether a given image fingerprint has already been "spent" by this user.
 * If yes, downloading another format of the same image is free.
 */
export function hasDownloadedImage(user: UserRecord, fingerprint: string): boolean {
  return (user.downloadedImageFingerprints ?? []).includes(fingerprint);
}

/**
 * Result of a download attempt evaluation. Used by the front-end to decide
 * whether to serve the file, decrement quota, or block with a paywall.
 */
export type DownloadDecision =
  | { allow: true; alreadyDownloaded: true } // free — already spent on this image
  | { allow: true; alreadyDownloaded: false; willDecrement: true } // counts as 1
  | { allow: false; reason: "quota_exhausted" };

/** Decide whether a download should be permitted, without mutating state. */
export function evaluateDownload(user: UserRecord, fingerprint: string): DownloadDecision {
  if (user.role === "superadmin" || user.subscriptionStatus === "active") {
    return { allow: true, alreadyDownloaded: hasDownloadedImage(user, fingerprint) } as DownloadDecision;
  }
  if (hasDownloadedImage(user, fingerprint)) {
    return { allow: true, alreadyDownloaded: true };
  }
  const remaining = user.vectorizationsRemaining ?? FREE_VECTORIZATIONS;
  if (remaining > 0) {
    return { allow: true, alreadyDownloaded: false, willDecrement: true };
  }
  return { allow: false, reason: "quota_exhausted" };
}

/**
 * Mark an image as downloaded by this user. Decrements vectorizationsRemaining
 * (down to 0) and appends fingerprint to downloadedImageFingerprints.
 * No-op if fingerprint is already in the list.
 * Also pushes the new VECTORIZATIONS_USED count to Brevo for email automation triggers.
 */
export async function markImageDownloaded(uid: string, email: string, fingerprint: string): Promise<{ remaining: number; usedThisCall: boolean }> {
  const ref = doc(db, USERS, uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { remaining: 0, usedThisCall: false };

  const data = snap.data() as UserRecord;
  const fingerprints = data.downloadedImageFingerprints ?? [];
  const remainingBefore = data.vectorizationsRemaining ?? FREE_VECTORIZATIONS;

  // Already downloaded this image — no-op
  if (fingerprints.includes(fingerprint)) {
    return { remaining: remainingBefore, usedThisCall: false };
  }

  // Paid / superadmin — record fingerprint but don't decrement
  if (data.role === "superadmin" || data.subscriptionStatus === "active") {
    await updateDoc(ref, {
      downloadedImageFingerprints: [...fingerprints, fingerprint],
    });
    return { remaining: Infinity, usedThisCall: true };
  }

  // Trial user, new image — decrement + record
  const remainingAfter = Math.max(0, remainingBefore - 1);
  await updateDoc(ref, {
    vectorizationsRemaining: remainingAfter,
    downloadedImageFingerprints: [...fingerprints, fingerprint],
  });

  // Push updated count to Brevo (fire-and-forget; failures must not break download UX)
  const used = FREE_VECTORIZATIONS - remainingAfter;
  fetch("/api/brevo-update-count", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, used }),
  }).catch(() => {});

  return { remaining: remainingAfter, usedThisCall: true };
}
