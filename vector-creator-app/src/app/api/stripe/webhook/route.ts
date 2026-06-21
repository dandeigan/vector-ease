import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Stripe webhook handler — fires when payment events happen at Stripe.
 *
 * Primary job: when a checkout session completes successfully, mark the
 * corresponding user's Firestore record as subscriptionStatus = "active"
 * so the 5-conversion paywall lifts and they get unlimited vectorizations.
 *
 * SECURITY: Stripe signs every webhook with a secret. We verify the signature
 * before trusting the payload — otherwise anyone could POST to this endpoint
 * and grant themselves a free lifetime account.
 *
 * Setup required:
 * 1. In Stripe dashboard → Developers → Webhooks → Add endpoint
 *    URL: https://app.vectorease.com/api/stripe/webhook
 *    Events: checkout.session.completed
 * 2. Copy the signing secret (whsec_...) and add to Vercel env vars as STRIPE_WEBHOOK_SECRET
 * 3. Add Firebase Admin SDK credentials to Vercel env vars:
 *    FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY
 *    (download a service account JSON from Firebase Console → Project Settings → Service Accounts)
 */

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" as any })
  : null;

// Initialize Firebase Admin SDK once per cold start.
// Using a function so we can early-return if creds are missing.
function getAdminFirestore() {
  if (getApps().length > 0) {
    return getFirestore();
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Vercel stores multi-line private keys with literal \n escapes — convert back to real newlines.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error("[stripe-webhook] Firebase Admin credentials not configured");
    return null;
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  return getFirestore();
}

export async function POST(req: NextRequest) {
  if (!stripe) {
    console.error("[stripe-webhook] Stripe not configured");
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  // Raw body is required for signature verification — DO NOT use req.json() here.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    console.error("[stripe-webhook] Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] Signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Handle the event types we care about.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    const customerEmail = session.customer_email || session.customer_details?.email || null;

    if (!userId) {
      console.error("[stripe-webhook] No client_reference_id on session", session.id);
      return NextResponse.json({ received: true, warning: "no_user_id" });
    }

    const db = getAdminFirestore();
    if (!db) {
      // Don't NACK the webhook — just log. Stripe will retry but our setup is bad.
      return NextResponse.json({ received: true, error: "firebase_not_configured" });
    }

    try {
      // Mark the user as paid — unlocks unlimited vectorizations.
      // The front-end onSnapshot listener (in AuthContext) will pick this up
      // automatically and refresh the dashboard within a couple seconds.
      await db.collection("users").doc(userId).update({
        subscriptionStatus: "active",
        paidAt: new Date().toISOString(),
        stripeSessionId: session.id,
        stripeCustomerId: session.customer || null,
        stripeAmountPaid: session.amount_total || 0,
      });

      console.log(`[stripe-webhook] Marked user ${userId} as active (session ${session.id})`);

      // Optional: also push the upgrade event to Brevo so we can move the contact
      // to a "Paid Customers" list and stop the trial nurture sequence.
      // (Implement once we have a "Paid" list in Brevo — skipping for v1.)

      return NextResponse.json({ received: true, userId });
    } catch (err: any) {
      console.error("[stripe-webhook] Firestore update failed:", err.message);
      // Return 500 so Stripe retries. Stripe will retry several times over hours.
      return NextResponse.json({ error: "Firestore update failed" }, { status: 500 });
    }
  }

  // Acknowledge other event types but don't act on them.
  return NextResponse.json({ received: true, event_type: event.type });
}
