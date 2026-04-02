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
}

const USERS = "users";
const VECTORIZATIONS = "vectorizations";

/** Create or update user doc on login/signup */
export async function syncUserToFirestore(uid: string, email: string) {
  const ref = doc(db, USERS, uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // First-time user — 30-day trial
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 30);

    await setDoc(ref, {
      uid,
      email,
      displayName: email.split("@")[0],
      role: "user",
      subscriptionStatus: "trial",
      totalVectorizations: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      trialExpiresAt: Timestamp.fromDate(trialEnd),
    });
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
