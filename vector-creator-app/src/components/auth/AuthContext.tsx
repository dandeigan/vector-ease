"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { syncUserToFirestore, getUser, isTrialExpired, getTrialDaysRemaining, type UserRecord } from "@/lib/firebase/users";

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
  trialDaysLeft: 30,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userRecord, setUserRecord] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        // Sync to Firestore and fetch role
        await syncUserToFirestore(currentUser.uid, currentUser.email || "", currentUser.displayName || undefined);
        const record = await getUser(currentUser.uid);
        setUserRecord(record);
      } else {
        setUserRecord(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await signOut(auth);
    setUserRecord(null);
  };

  const isSuperAdmin = userRecord?.role === "superadmin";
  const trialExpired = userRecord ? isTrialExpired(userRecord) : false;
  const trialDaysLeft = userRecord ? getTrialDaysRemaining(userRecord) : 30;

  return (
    <AuthContext.Provider value={{ user, userRecord, loading, isSuperAdmin, trialExpired, trialDaysLeft, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
