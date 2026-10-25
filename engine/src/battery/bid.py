from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from battery.model import Battery, Schedule

TOL = 1e-6

MARKET_PRICE_FLOOR = -1000.0
MARKET_PRICE_CAP = 23200.0 # FY27
BANDS = 10

# TODO: These are not real, model can be expanded to choose optimal bands.
GEN_PRICES = [-1000, -500, -100, 0, 50, 100, 300, 1000, 5000, MARKET_PRICE_CAP]
LOAD_PRICES = [-1000, -500, -100, 0, 50, 100, 300, 1000, 5000, MARKET_PRICE_CAP]


@dataclass(frozen=True)
class Offer:
    prices: list[float]         # 10 band prices, fixed for the day
    bands: list[list[float]]    # per interval: MW in each of the 10 bands
    max_avail: list[float]      # per interval: MaxAvail, MW

@dataclass(frozen=True)
class Bid:
    gen: Offer  # discharge
    load: Offer # charge


def build_bid(schedule: Schedule, battery: Battery) -> Bid:
    gen_bands: list[list[float]] = []
    gen_max: list[float] = []
    load_bands: list[list[float]] = []
    load_max: list[float] = []

    # Leftover MW is placed at the cap (GEN) or floor (LOAD) because AEMO needs each side's 
    # bands to sum to capacity. Real prices do hit the cap and floor, so MaxAvail, not the 
    # price, is what keeps it undispatched
    for c,d in zip(schedule.charge_mw, schedule.discharge_mw):
        gen = [0.0] * BANDS
        load = [0.0] * BANDS

        if d > TOL:
            # Discharge at any price
            gen[0], gen[-1] = d, battery.power_mw - d
            load[0] = battery.power_mw
            gen_max.append(d)
            load_max.append(0.0)
        elif c > TOL:
            # Charge at any price
            load[-1], load[0] = c, battery.power_mw - c
            gen[-1] = battery.power_mw
            gen_max.append(0.0)
            load_max.append(c)
        else:
            gen[-1] = battery.power_mw
            load[0] = battery.power_mw
            gen_max.append(0.0)
            load_max.append(0.0)
        gen_bands.append(gen)
        load_bands.append(load)

    return Bid(
        gen=Offer(prices=list(GEN_PRICES), bands=gen_bands, max_avail=gen_max),
        load=Offer(prices=list(LOAD_PRICES), bands=load_bands, max_avail=load_max),
    )

def effective(offer: Offer, t: int, side: Literal["gen", "load"]) -> list[float]:
    # MaxAvail is upsed up in dispact order, GEN from band 1 up, load from band 10 down.
    order = range(len(offer.prices)) if side == "gen" else reversed(range(len(offer.prices)))
    left = offer.max_avail[t]
    result = [0.0] * len(offer.prices)

    for i in order:
        result[i] = min(offer.bands[t][i], left)
        left -= result[i]

    return result

def validate(bid: Bid, battery: Battery) -> list[str]:
    """Every AEMO rule the bid must meet: 10 rising prices within the floor and cap, bands covering capacity, MaxAvail in range, and no overlap between LOAD and GEN prices (convexity)."""

    errors: list[str] = []
    p = battery.power_mw
    n = len(bid.gen.bands)

    for side, offer in (("gen", bid.gen), ("load", bid.load)):
        prices = offer.prices
        if len(prices) != BANDS:
            errors.append(f"{side}: {len(prices)} prices, expected {BANDS}")
        if any(a >= b for a, b in pairwise(prices)):
            errors.append(f"{side}: prices must strictly increase: {prices}")
        if any(not MARKET_PRICE_FLOOR <= x <= MARKET_PRICE_CAP for x in prices):
            errors.append(f"{side}: prices must be within [{MARKET_PRICE_FLOOR}, {MARKET_PRICE_CAP}]")
        if len(offer.bands) != n or len(offer.max_avail) != n:
            errors.append(f"{side}: {len(offer.bands)} band rows and {len(offer.max_avail)} MaxAvail values, expected {n}")
            continue

        for t, (bands, max_avail) in enumerate(zip(offer.bands, offer.max_avail)):
            if len(bands) != BANDS:
                errors.append(f"{side} t={t}: {len(bands)} bands, expected {BANDS}")
            if any(not -TOL <= mw <= p + TOL for mw in bands):
                errors.append(f"{side} t={t}: each band must be within [0, {p}] MW")
            if sum(bands) < p - TOL:
                errors.append(f"{side} t={t}: bands add up to {sum(bands)} MW, below capacity {p}")
            if not -TOL <= max_avail <= p + TOL:
                errors.append(f"{side} t={t}: MaxAvail {max_avail} outside [0, {p}]")

    if errors:
        return errors

    # Convexity: no price where both the load and gen sides would be dispatched
    for t in range(n):
        load = [price for price, mw in zip(bid.load.prices, effective(bid.load, t, "load")) if mw > TOL]
        gen = [price for price, mw in zip(bid.gen.prices, effective(bid.gen, t, "gen")) if mw > TOL]
        if load and gen and max(load) >= min(gen):
            errors.append(f"t={t}: load band at ${max(load)} is not below gen band at ${min(gen)} (convexity)")
    return errors

def replay(bid: Bid, prices: list[float]) -> tuple[list[float], list[float]]:
    charge: list[float] = []
    discharge: list[float] = []

    for t, regional_ref_price in enumerate(prices):
        gen = effective(bid.gen, t, "gen")
        load = effective(bid.load, t, "load")
        discharge.append(sum(mw for price, mw in zip(bid.gen.prices, gen) if price <= regional_ref_price))
        charge.append(sum(mw for price, mw in zip(bid.load.prices, load) if price >= regional_ref_price))

    return charge, discharge