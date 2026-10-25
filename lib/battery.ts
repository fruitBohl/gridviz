/** Same reference battery as engine/src/battery/model.py (Battery defaults); keep the two in step. */
export const BATTERY = {
  powerMw: 100,
  energyMwh: 200,
  roundTripEfficiency: 0.88,
  startSocMwh: 100,
};

export const SOLVE_API = process.env.NEXT_PUBLIC_SOLVE_API ?? "/api/solve";

export type Offer = { prices: number[]; maxAvail: number[]; bands: number[][] };

/** Response of GET /api/solve; see engine/src/battery/solve.py. */
export type SolveResult = {
  region: string;
  tradingDate: string;
  battery: typeof BATTERY;
  t: string[];
  price: number[];
  chargeMw: number[];
  dischargeMw: number[];
  socMwh: number[];
  revenue: number;
  relaxedRevenue: number;
  simultaneousIntervals: number;
  solveSeconds: number;
  bid: { gen: Offer; load: Offer };
};
