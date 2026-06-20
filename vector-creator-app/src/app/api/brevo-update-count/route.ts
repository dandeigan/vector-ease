import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side handler for pushing the user's updated VECTORIZATIONS_USED count
 * to their Brevo contact. This drives the trial email automation triggers
 * (e.g., send "1 left" email when VECTORIZATIONS_USED = 4).
 *
 * Called by markImageDownloaded() in src/lib/firebase/users.ts after a
 * decrement event.
 *
 * SECURITY: The Brevo API key stays server-side only (BREVO_API_KEY env var,
 * no NEXT_PUBLIC_ prefix). Same pattern as /api/brevo-signup.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Brevo list IDs — drive the trial email automation lifecycle.
// Each automation is a simple "Contact added to list → Send email" workflow.
const LIST_TRIAL_USERS = 7;     // Initial signup → Email #1 (Welcome)
const LIST_ONE_LEFT = 10;       // VECTORIZATIONS_USED hits 4 → Email #2 (1 left)
const LIST_EXHAUSTED = 11;      // VECTORIZATIONS_USED hits 5 → Email #3 (Hit limit)

/**
 * Add a contact to a Brevo list. Fire-and-forget — failures logged, never thrown.
 */
async function addContactToList(apiKey: string, email: string, listId: number): Promise<void> {
  try {
    const resp = await fetch(
      `https://api.brevo.com/v3/contacts/lists/${listId}/contacts/add`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({ emails: [email] }),
      }
    );
    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.error(`[brevo-update-count] add-to-list ${listId} failed:`, resp.status, errorText);
    }
  } catch (err) {
    console.error(`[brevo-update-count] add-to-list ${listId} exception:`, err);
  }
}

/**
 * Remove a contact from a Brevo list. Fire-and-forget — failures logged, never thrown.
 */
async function removeContactFromList(apiKey: string, email: string, listId: number): Promise<void> {
  try {
    const resp = await fetch(
      `https://api.brevo.com/v3/contacts/lists/${listId}/contacts/remove`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({ emails: [email] }),
      }
    );
    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.error(`[brevo-update-count] remove-from-list ${listId} failed:`, resp.status, errorText);
    }
  } catch (err) {
    console.error(`[brevo-update-count] remove-from-list ${listId} exception:`, err);
  }
}

export async function POST(req: NextRequest) {
  let payload: { email?: unknown; used?: unknown };

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const used = typeof payload.used === "number" && Number.isFinite(payload.used)
    ? Math.max(0, Math.floor(payload.used))
    : null;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (used === null) {
    return NextResponse.json({ ok: false, error: "invalid_used_count" }, { status: 400 });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("[brevo-update-count] BREVO_API_KEY not configured in environment");
    return NextResponse.json({ ok: false, skipped: true });
  }

  try {
    // Brevo's contact update endpoint accepts the email identifier in the URL path.
    const brevoResp = await fetch(
      `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          attributes: {
            VECTORIZATIONS_USED: used,
          },
        }),
      }
    );

    if (!brevoResp.ok) {
      const errorText = await brevoResp.text().catch(() => "");
      console.error("[brevo-update-count] Brevo API error:", brevoResp.status, errorText);
      return NextResponse.json({ ok: false, brevoStatus: brevoResp.status });
    }

    // List moves trigger the Email #2 and #3 automations.
    // Run in parallel — neither blocks the user response.
    // Note: removing from a list the user isn't in is a no-op in Brevo (doesn't error).
    if (used === 4) {
      // Crossed the threshold for "1 left" — move from Trial Users → 1 Left list
      await Promise.all([
        removeContactFromList(apiKey, email, LIST_TRIAL_USERS),
        addContactToList(apiKey, email, LIST_ONE_LEFT),
      ]);
    } else if (used >= 5) {
      // Crossed the threshold for "exhausted" — move from 1 Left → Exhausted list.
      // Also remove from Trial Users in case they skipped past 4 somehow (defensive).
      await Promise.all([
        removeContactFromList(apiKey, email, LIST_TRIAL_USERS),
        removeContactFromList(apiKey, email, LIST_ONE_LEFT),
        addContactToList(apiKey, email, LIST_EXHAUSTED),
      ]);
    }

    return NextResponse.json({ ok: true, used });
  } catch (err) {
    console.error("[brevo-update-count] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: "internal" });
  }
}
