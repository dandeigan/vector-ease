import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" as any })
  : null;

export async function POST(req: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
    }

    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use the Stripe Price ID configured in Vercel env (STRIPE_PRICE_ID_FOUNDER)
    // so we can change the price from $39 (Founder) to $79 (Standard) without a code deploy.
    // Falls back to inline $39 price_data if env var isn't set yet.
    const founderPriceId = process.env.STRIPE_PRICE_ID_FOUNDER;

    const lineItem = founderPriceId
      ? { price: founderPriceId, quantity: 1 }
      : {
          price_data: {
            currency: "usd",
            product_data: {
              name: "VectorEase Founder's Lifetime Deal",
              description: "Lifetime access to VectorEase. Unlimited image-to-vector conversions for laser creators. All formats (SVG, DXF, LightBurn .lbrn2). One-time payment, no subscription. 30-day money-back guarantee.",
            },
            unit_amount: 3900, // $39.00 — Founder pricing fallback
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [lineItem as any],
      mode: "payment",
      success_url: `${req.headers.get("origin")}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/dashboard?cancelled=true`,
      client_reference_id: userId, // Link this purchase to the Firebase User ID; webhook reads this to mark account active.
    });

    // Return the session URL so the client can redirect directly to Stripe Checkout.
    // Stripe deprecated stripe.redirectToCheckout() on 2025-09-30 in favor of using
    // the session.url field. See: https://docs.stripe.com/changelog/clover/2025-09-30/remove-redirect-to-checkout
    return NextResponse.json({ id: session.id, url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
