/**
 * VectorEase plans. One place for prices and wording, used by the pricing
 * popup, banners and the checkout route. Amounts are USD.
 */
export type PlanId = "yearly" | "lifetime";

export interface Plan {
  id: PlanId;
  name: string;
  /** Whole dollars, for display. */
  price: number;
  cents: number;
  /** Shown after the price. */
  cadence: string;
  blurb: string;
  checkoutLabel: string;
}

export const PLANS: Record<PlanId, Plan> = {
  yearly: {
    id: "yearly",
    name: "Yearly",
    price: 35,
    cents: 3500,
    cadence: "/year",
    blurb: "Unlimited images and every export. Renews each year, cancel any time.",
    checkoutLabel: "Go yearly: $35",
  },
  lifetime: {
    id: "lifetime",
    name: "Lifetime",
    price: 95,
    cents: 9500,
    cadence: "one time",
    blurb: "Pay once, use it forever. Every future update included.",
    checkoutLabel: "Get lifetime: $95",
  },
};

/**
 * Tag on the Lifetime card in the pricing popup. Matches the Cyber Monday
 * sales page and ads (Dan, 2026-11-24). Set back to "Best value" after the promo.
 */
export const LIFETIME_BADGE = "Cyber Monday deal";

/** Short line for banners and buttons. */
export const PRICE_LINE = `$${PLANS.yearly.price}/year or $${PLANS.lifetime.price} lifetime`;
