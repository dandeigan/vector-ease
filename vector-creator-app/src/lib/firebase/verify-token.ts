// Server-only: import from API routes, never from client components.
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

/**
 * Verifies the Firebase ID token sent as `Authorization: Bearer <token>`.
 *
 * Uses `jose` directly with Google's published signing keys, following
 * Firebase's "verify ID tokens using a third-party JWT library" guide.
 * We don't use firebase-admin/auth here: on Vercel it fails to load
 * (its jwks-rsa dependency require()s the ESM-only jose, ERR_REQUIRE_ESM),
 * which took the whole /api/vectorize route down on 2026-11-23.
 */
const GOOGLE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

function projectId(): string | undefined {
  return process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
}

export async function getVerifiedUid(req: NextRequest): Promise<string | null> {
  const match = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  const pid = projectId();
  if (!match || !pid) return null;
  try {
    const { payload } = await jwtVerify(match[1], GOOGLE_KEYS, {
      issuer: `https://securetoken.google.com/${pid}`,
      audience: pid,
      algorithms: ["RS256"],
    });
    const uid = payload.sub;
    if (!uid || typeof payload.auth_time !== "number" || payload.auth_time > Date.now() / 1000 + 60) return null;
    return uid;
  } catch {
    return null;
  }
}
