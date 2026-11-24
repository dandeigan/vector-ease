"use client";

import { auth } from "@/lib/firebase/config";
import type { PlanId } from "@/lib/pricing";

async function postWithToken(url: string, body?: unknown): Promise<{ url?: string; error?: string }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { error: "Please sign in again, then try once more." };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ error: "Unexpected reply from the server." }));
}

/** Go to Stripe Checkout for this plan. Returns an error message, or null when the page is opening. */
export async function startCheckout(plan: PlanId): Promise<string | null> {
  try {
    const data = await postWithToken("/api/checkout_sessions", { plan });
    if (data.url) {
      window.location.href = data.url;
      return null;
    }
    console.error("[checkout]", data.error);
    return "Checkout couldn't open. Please try again in a minute.";
  } catch (err) {
    console.error("[checkout]", err);
    return "Checkout couldn't open. Please check your connection and try again.";
  }
}

/** Open Stripe's billing page (change card, cancel a yearly plan). Returns an error message, or null when opening. */
export async function openBillingPortal(): Promise<string | null> {
  try {
    const data = await postWithToken("/api/billing_portal");
    if (data.url) {
      window.location.href = data.url;
      return null;
    }
    return data.error || "The billing page couldn't open. Please try again.";
  } catch {
    return "The billing page couldn't open. Please check your connection and try again.";
  }
}
