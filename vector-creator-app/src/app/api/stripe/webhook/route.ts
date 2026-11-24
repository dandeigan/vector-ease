import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminFirestore } from "@/lib/firebase/admin-db";

/**
 * Stripe webhook: keeps each user's plan in Firestore in step with Stripe.
 *
 *   checkout.session.completed      → unlock the account (plan "yearly" or "lifetime")
 *   customer.subscription.updated   → yearly renewed / payment failed / set to cancel
 *   customer.subscription.deleted   → yearly ended: account goes back to "expired"
 *
 * Lifetime buyers are never downgraded by subscription events. Accounts from the
 * old $39 Founder deal have no plan set and are treated as lifetime.
 *
 * SECURITY: every event's signature is checked with STRIPE_WEBHOOK_SECRET first,
 * otherwise anyone could POST here and unlock an account.
 *
 * Stripe setup (Developers → Webhooks → endpoint https://app.vectorease.com/api/stripe/webhook):
 *   events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
 * Vercel env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FIREBASE_ADMIN_PROJECT_ID,
 *   FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY
 */

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" as Stripe.LatestApiVersion })
  : null;

/** Stripe moved current_period_end from the subscription onto its items; read whichever is there. */
function periodEnd(sub: Stripe.Subscription): string | null {
  const s = sub as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
  const t = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

export async function POST(req: NextRequest) {
  if (!stripe) return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });

  // The raw body is needed for the signature check; don't use req.json() here.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "firebase_not_configured" }, { status: 500 }); // Stripe retries

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.client_reference_id || session.metadata?.uid;
      if (!uid) {
        console.error("[stripe-webhook] No user on session", session.id);
        return NextResponse.json({ received: true, warning: "no_user_id" });
      }
      const plan = session.metadata?.plan === "yearly" ? "yearly" : "lifetime";
      const subscriptionId = idOf(session.subscription as string | Stripe.Subscription | null);

      const update: Record<string, unknown> = {
        subscriptionStatus: "active",
        plan,
        paidAt: new Date().toISOString(),
        stripeSessionId: session.id,
        stripeCustomerId: idOf(session.customer as string | Stripe.Customer | null),
        stripeAmountPaid: session.amount_total || 0,
      };
      if (subscriptionId) {
        update.stripeSubscriptionId = subscriptionId;
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        update.planRenewsAt = periodEnd(sub);
        update.planCancelsAtPeriodEnd = sub.cancel_at_period_end;
      }
      await db.collection("users").doc(uid).update(update);
      console.log(`[stripe-webhook] ${uid} → active (${plan}, session ${session.id})`);
      return NextResponse.json({ received: true });
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const uid = sub.metadata?.uid;
      if (!uid) return NextResponse.json({ received: true, warning: "no_user_id" });

      const ref = db.collection("users").doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ received: true, warning: "no_user" });
      const plan = snap.get("plan");
      // Lifetime (or old Founder deal, no plan) wins over any subscription change.
      if (plan !== "yearly") return NextResponse.json({ received: true, skipped: "not_yearly" });
      // Ignore events about an older subscription than the one on file.
      const current = snap.get("stripeSubscriptionId");
      if (current && current !== sub.id) return NextResponse.json({ received: true, skipped: "other_subscription" });

      // past_due keeps access while Stripe retries the card.
      const live = event.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(sub.status);
      await ref.update({
        subscriptionStatus: live ? "active" : "expired",
        stripeSubscriptionId: sub.id,
        planRenewsAt: periodEnd(sub),
        planCancelsAtPeriodEnd: sub.cancel_at_period_end,
      });
      console.log(`[stripe-webhook] ${uid} yearly → ${live ? "active" : "expired"} (${sub.status})`);
      return NextResponse.json({ received: true });
    }
  } catch (err) {
    console.error("[stripe-webhook] Firestore update failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "update_failed" }, { status: 500 }); // Stripe retries over several hours
  }

  return NextResponse.json({ received: true, event_type: event.type });
}
