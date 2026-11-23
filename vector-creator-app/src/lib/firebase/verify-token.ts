// Server-only: import from API routes, never from client components.
import { initializeApp, getApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { NextRequest } from "next/server";

/**
 * Verifies the Firebase ID token sent as `Authorization: Bearer <token>`.
 *
 * Verifying an ID token only needs the project ID (Google's public keys are
 * fetched automatically), so this works without service-account credentials.
 * It uses its own named Admin app so it never clashes with the Stripe
 * webhook's credentialed default app.
 */
const APP_NAME = "id-token-verifier";

function verifierApp() {
  if (getApps().some((a) => a.name === APP_NAME)) return getApp(APP_NAME);
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return initializeApp({ projectId }, APP_NAME);
}

export async function getVerifiedUid(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await getAuth(verifierApp()).verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    return null;
  }
}
