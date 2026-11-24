import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getVerifiedUid } from "@/lib/firebase/verify-token";
import { getAdminFirestore } from "@/lib/firebase/admin-db";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" as Stripe.LatestApiVersion })
  : null;

/**
 * Opens Stripe's customer portal (update card, see receipts, cancel a yearly plan).
 * Needs the portal turned on once in Stripe: Settings → Billing → Customer portal.
 */
export async function POST(req: NextRequest) {
  if (!stripe) return NextResponse.json({ error: "Billing isn't set up yet." }, { status: 503 });
  const uid = await getVerifiedUid(req);
  if (!uid) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Billing isn't set up yet." }, { status: 503 });

  const snap = await db.collection("users").doc(uid).get();
  const customer = snap.get("stripeCustomerId") as string | undefined;
  if (!customer) {
    return NextResponse.json({ error: "We couldn't find a payment for this account. If you paid, email support and we'll sort it out." }, { status: 404 });
  }

  try {
    const origin = req.headers.get("origin") || "https://app.vectorease.com";
    const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/settings` });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error("[billing_portal]", err);
    return NextResponse.json({ error: "The billing page couldn't open. Please try again later." }, { status: 500 });
  }
}
