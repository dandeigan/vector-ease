import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side handler for adding new trial signups to Brevo.
 *
 * SECURITY: This route exists so the Brevo API key stays server-side only.
 * Never expose BREVO_API_KEY with the NEXT_PUBLIC_ prefix — that would
 * bundle the key into the browser JS and leak it to every visitor.
 *
 * Called by syncUserToFirestore() in src/lib/firebase/users.ts after a
 * successful Firebase Auth signup.
 */

// Basic email format check — keeps obvious garbage out of Brevo.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Brevo list ID for "VectorEase Trial Users" — drives the trial email automation.
const TRIAL_LIST_ID = 7;

export async function POST(req: NextRequest) {
  let payload: { email?: unknown; firstName?: unknown; lastName?: unknown };

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : "";
  const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : "";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Don't expose env state to clients; log server-side for Dan to see in Vercel logs.
    console.error("[brevo-signup] BREVO_API_KEY not configured in environment");
    // Return 200 so the signup flow isn't blocked by missing config.
    return NextResponse.json({ ok: false, skipped: true });
  }

  try {
    const brevoResp = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          VECTORIZATIONS_USED: 0, // initial count — drives trial email automation triggers
        },
        listIds: [TRIAL_LIST_ID], // add to "VectorEase Trial Users" list immediately
        updateEnabled: true, // upsert behavior so existing contacts get attributes updated, not rejected
      }),
    });

    if (!brevoResp.ok) {
      const errorText = await brevoResp.text().catch(() => "");
      console.error("[brevo-signup] Brevo API error:", brevoResp.status, errorText);
      // Return 200 — don't break signup if Brevo is down or misconfigured.
      return NextResponse.json({ ok: false, brevoStatus: brevoResp.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[brevo-signup] Unexpected error:", err);
    // Always return 200 — Brevo failures must not break the user's signup.
    return NextResponse.json({ ok: false, error: "internal" });
  }
}
