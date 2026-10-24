/**
 * MARKETSUSPENDEDFLAG has no documented values. These match AEMO's MARKET_SUSPEND_REGIME_SUM
 * PRICING_REGIME for the suspensions of June 2022, 5 Sep 2024 and 23 Mar 2026 (checked 2026-10-24).
 * "dispatch": prices still come from the dispatch engine. "schedule": AEMO's suspension price
 * schedule, a 30-minute price applied to each 5-minute interval.
 */
export const SUSPENSION_REGIMES = { "1": "dispatch", "2": "schedule" } as const;
export type SuspensionRegime = (typeof SUSPENSION_REGIMES)[keyof typeof SUSPENSION_REGIMES];

/**
 * APCFLAG bits: how the dispatch price differs from the original price (ROP) the dispatch
 * algorithm calculated. From AEMO's MMS data model, DISPATCHPRICE, checked 2026-10-24.
 */
export const PRICE_FLAGS = {
  administeredPrice: 1, // an administered price cap or floor was binding
  vollOverride: 2,
  priceLimit: 4, // the market price cap or floor was binding
  manualPrice: 8,
  lossFactorScaling: 16, // price scaled by an inter-regional loss factor
} as const;
