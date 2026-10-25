import time
from datetime import date as Date
from typing import Any, Protocol

from battery.bid import Offer, build_bid, replay, validate
from battery.model import Battery, solve_model

REGIONS = ("NSW1", "QLD1", "SA1", "TAS1", "VIC1")
INTERVALS_PER_DAY = 288
TOL = 1e-6


class Store(Protocol):
    def get_json(self, key: str) -> Any | None: ...


def region_prices(day: Any, region: str) -> list[float] | None:
    intervals = day.get("intervals", [])
    if len(intervals) != INTERVALS_PER_DAY or any(region not in i["regions"] for i in intervals):
        return None
    return [i["regions"][region]["price"] for i in intervals]


def valid_date(date: str | None) -> bool:
    if date is None or len(date) != 10:  # fromisoformat also accepts forms like 20250115
        return False
    try:
        Date.fromisoformat(date)
    except ValueError:
        return False
    return True


def r2(values: list[float]) -> list[float]:
    return [round(v, 2) for v in values]


def offer_json(offer: Offer) -> dict[str, Any]:
    return {"prices": offer.prices, "maxAvail": r2(offer.max_avail), "bands": [r2(b) for b in offer.bands]}


def solve_day(store: Store, region: str | None, date: str | None, battery: Battery) -> tuple[int, dict[str, Any]]:
    if region not in REGIONS:
        return 400, {"error": f"region must be one of {', '.join(REGIONS)}"}
    if not valid_date(date):
        return 400, {"error": "date must be YYYY-MM-DD"}

    day = store.get_json(f"data/days/{date}.json")
    if day is None:
        return 404, {"error": f"no data for {date}"}
    prices = region_prices(day, region)
    if prices is None:
        return 404, {"error": f"{date} is incomplete for {region}"}

    started = time.perf_counter()
    try:
        mip = solve_model(prices, battery)
        relaxed = solve_model(prices, battery, relax=True)
    except RuntimeError as e:
        return 500, {"error": str(e)}
    solve_seconds = time.perf_counter() - started

    bid = build_bid(mip, battery)
    errors = validate(bid, battery)
    charge, discharge = replay(bid, prices)
    mismatch = max(abs(a - b) for a, b in zip(charge + discharge, mip.charge_mw + mip.discharge_mw))
    if errors or mismatch > TOL:
        return 500, {"error": f"bid check failed: {errors[:3]} replay mismatch {mismatch:.3g} MW"}

    simultaneous = sum(c > TOL and d > TOL for c, d in zip(relaxed.charge_mw, relaxed.discharge_mw))
    return 200, {
        "region": region,
        "tradingDate": date,
        "battery": {
            "powerMw": battery.power_mw,
            "energyMwh": battery.energy_mwh,
            "roundTripEfficiency": battery.round_trip_efficiency,
            "startSocMwh": battery.start_soc_mwh,
        },
        "t": [i["t"] for i in day["intervals"]],
        "price": prices,
        "chargeMw": r2(mip.charge_mw),
        "dischargeMw": r2(mip.discharge_mw),
        "socMwh": r2(mip.stored_mwh),
        "revenue": round(mip.revenue, 2),
        "relaxedRevenue": round(relaxed.revenue, 2),
        "simultaneousIntervals": simultaneous,
        "solveSeconds": round(solve_seconds, 3),
        "bid": {"gen": offer_json(bid.gen), "load": offer_json(bid.load)},
    }

