"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import { syncUserToFirestore, isTrialExpired, getTrialDaysRemaining, type UserRecord } from "@/lib/firebase/users";

interface AuthContextType {
  user: User | null;
  userRecord: UserRecord | null;
  loading: boolean;
  isSuperAdmin: boolean;
  trialExpired: boolean;
  trialDaysLeft: number;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userRecord: null,
  loading: true,
  isSuperAdmin: false,
  trialExpired: false,
  trialDaysLeft: 15,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userRecord, setUserRecord] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Live Firestore listener for the currently signed-in user's record.
    // Re-bound whenever the auth state changes (new signin, signout, account switch).
    // Without this, userRecord would be a one-time snapshot taken at signin and the
    // 5-conversion gate would always see stale vectorizationsRemaining = 5 → never block.
    let firestoreUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      // Tear down any previous user's Firestore listener before binding a new one.
      if (firestoreUnsubscribe) {
        firestoreUnsubscribe();
        firestoreUnsubscribe = null;
      }

      if (currentUser) {
        // Create the user doc if first signin; no-op for returning users.
        await syncUserToFirestore(currentUser.uid, currentUser.email || "", currentUser.displayName || undefined);

        // Subscribe to live updates on this user's doc. Fires whenever any field
        // changes (vectorizationsRemaining, downloadedImageFingerprints, role, etc.)
        // — the dashboard badge, paywall modal, and gate check all auto-update.
        const userRef = doc(db, "users", currentUser.uid);
        firestoreUnsubscribe = onSnapshot(
          userRef,
          (snap) => {
            setUserRecord(snap.exists() ? (snap.data() as UserRecord) : null);
            setLoading(false);
          },
          (err) => {
            console.error("[AuthContext] Firestore listener error", err);
            setLoading(false);
          }
        );
      } else {
        setUserRecord(null);
        setLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
      if (firestoreUnsubscribe) firestoreUnsubscribe();
    };
  }, []);

  const logout = async () => {
    await signOut(auth);
    setUserRecord(null);
  };

  const isSuperAdmin = userRecord?.role === "superadmin";
  const trialExpired = userRecord ? isTrialExpired(userRecord) : false;
  const trialDaysLeft = userRecord ? getTrialDaysRemaining(userRecord) : 15;

  return (
    <AuthContext.Provider value={{ user, userRecord, loading, isSuperAdmin, trialExpired, trialDaysLeft, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
