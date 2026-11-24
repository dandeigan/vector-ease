import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getVerifiedUid } from "@/lib/firebase/verify-token";
import { PLANS, type PlanId } from "@/lib/pricing";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" as Stripe.LatestApiVersion })
  : null;

/**
 * Starts Stripe Checkout for a plan.
 *   yearly   → subscription, $35/year  (uses STRIPE_PRICE_ID_YEARLY if set)
 *   lifetime → one-time payment, $95   (uses STRIPE_PRICE_ID_LIFETIME if set)
 * Without those env vars the price is built inline from lib/pricing.ts, so it
 * works before any Stripe products exist.
 * The user comes from their Firebase sign-in token, never from the request body.
 */
export async function POST(req: NextRequest) {
  try {
    if (!stripe) return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });

    const uid = await getVerifiedUid(req);
    if (!uid) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const planId: PlanId = body?.plan === "yearly" ? "yearly" : "lifetime";
    const plan = PLANS[planId];
    const yearly = planId === "yearly";
    const origin = req.headers.get("origin") || "https://app.vectorease.com";

    const priceId = yearly ? process.env.STRIPE_PRICE_ID_YEARLY : process.env.STRIPE_PRICE_ID_LIFETIME;
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = priceId
      ? { price: priceId, quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: plan.cents,
            product_data: {
              name: yearly ? "VectorEase Yearly" : "VectorEase Lifetime",
              description: yearly
                ? "Unlimited image-to-vector conversions, every export (LightBurn, Bambu .lac, SVG, DXF) and the Studio. Renews yearly, cancel any time."
                : "Lifetime access to VectorEase: unlimited conversions, every export and the Studio. One payment, no subscription.",
            },
            ...(yearly ? { recurring: { interval: "year" as const } } : {}),
          },
        };

    const metadata = { uid, plan: planId };
    const session = await stripe.checkout.sessions.create({
      mode: yearly ? "subscription" : "payment",
      line_items: [lineItem],
      client_reference_id: uid, // the webhook reads this to unlock the account
      metadata,
      ...(yearly
        ? { subscription_data: { metadata } } // so renewals and cancellations can find the user
        : { customer_creation: "always" as const }),
      allow_promotion_codes: true,
      success_url: `${origin}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard?cancelled=true`,
    });

    return NextResponse.json({ id: session.id, url: session.url });
  } catch (err) {
    console.error("[checkout_sessions]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Checkout failed" }, { status: 500 });
  }
}
