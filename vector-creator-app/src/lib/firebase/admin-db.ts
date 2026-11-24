// Server-only: import from API routes, never from client components.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firestore with admin rights (bypasses security rules). Returns null when the
 * FIREBASE_ADMIN_* env vars are missing. Initialised once per cold start.
 */
export function getAdminFirestore(): Firestore | null {
  if (getApps().length > 0) return getFirestore();

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Vercel stores multi-line private keys with literal \n escapes; turn them back into newlines.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("[firebase-admin] credentials not configured");
    return null;
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore();
}
