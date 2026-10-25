import dataclasses
import random

import pytest

from battery.bid import MARKET_PRICE_CAP, Bid, Offer, build_bid, effective, replay, validate
from battery.model import Battery, solve_model

BATTERY = Battery()
PRICES = [float(p) for p in range(10)]


def one_interval(gen_bands, gen_max, load_bands, load_max) -> Bid:
    return Bid(
        gen=Offer(prices=PRICES, bands=[gen_bands], max_avail=[gen_max]),
        load=Offer(prices=PRICES, bands=[load_bands], max_avail=[load_max]),
    )


def valid_bid() -> Bid:
    return build_bid(solve_model([-100.0] * 12 + [300.0] * 12, BATTERY), BATTERY)


def test_effective_uses_max_avail_in_dispatch_order():
    offer = Offer(prices=PRICES, bands=[[60.0] + [0.0] * 8 + [40.0]], max_avail=[40.0])
    assert effective(offer, 0, "load") == [0.0] * 9 + [40.0]
    assert effective(offer, 0, "gen") == [40.0] + [0.0] * 9

    partial = Offer(prices=PRICES, bands=[[30.0, 30.0, 30.0] + [0.0] * 6 + [10.0]], max_avail=[70.0])
    assert effective(partial, 0, "gen") == [30.0, 30.0, 10.0] + [0.0] * 7


def test_built_bid_is_valid():
    assert validate(valid_bid(), BATTERY) == []


def test_prices_must_strictly_increase():
    bid = valid_bid()
    bad = dataclasses.replace(bid, gen=dataclasses.replace(bid.gen, prices=bid.gen.prices[::-1]))
    assert any("strictly increase" in e for e in validate(bad, BATTERY))


def test_prices_must_be_within_floor_and_cap():
    bid = valid_bid()
    bad = dataclasses.replace(bid, load=dataclasses.replace(bid.load, prices=[*bid.load.prices[:-1], 1e6]))
    assert any("within" in e for e in validate(bad, BATTERY))


def test_bands_must_add_up_to_capacity():
    bid = one_interval([50.0] + [0.0] * 9, 50.0, [100.0] + [0.0] * 9, 0.0)
    assert any("below capacity" in e for e in validate(bid, BATTERY))


def test_max_avail_must_line_up_with_intervals():
    bid = valid_bid()
    bad = dataclasses.replace(bid, load=dataclasses.replace(bid.load, max_avail=bid.load.max_avail[:-1]))
    assert any("MaxAvail values" in e for e in validate(bad, BATTERY))


def test_load_priced_above_gen_breaks_convexity():
    # Load willing to pay $9 while gen offers at $0: at prices between, it would charge and discharge at once
    bid = one_interval([100.0] + [0.0] * 9, 100.0, [0.0] * 9 + [100.0], 100.0)
    assert any("convexity" in e for e in validate(bid, BATTERY))


def test_load_max_avail_zero_lifts_convexity():
    bid = one_interval([100.0] + [0.0] * 9, 100.0, [0.0] * 9 + [100.0], 0.0)
    assert validate(bid, BATTERY) == []


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_replay_reproduces_schedule(seed: int):
    rng = random.Random(seed)
    prices = [rng.uniform(-200, 500) for _ in range(288)]
    schedule = solve_model(prices, BATTERY)
    bid = build_bid(schedule, BATTERY)

    assert validate(bid, BATTERY) == []
    charge, discharge = replay(bid, prices)
    assert charge == pytest.approx(schedule.charge_mw, abs=1e-6)
    assert discharge == pytest.approx(schedule.discharge_mw, abs=1e-6)


def test_replay_at_the_price_floor():
    prices = [-1000.0] * 12 + [300.0] * 12
    schedule = solve_model(prices, BATTERY)
    charge, discharge = replay(build_bid(schedule, BATTERY), prices)
    assert charge == pytest.approx(schedule.charge_mw, abs=1e-6)
    assert discharge == pytest.approx(schedule.discharge_mw, abs=1e-6)


def test_replay_at_the_price_cap():
    prices = [-100.0] * 12 + [MARKET_PRICE_CAP] * 12
    schedule = solve_model(prices, BATTERY)
    charge, discharge = replay(build_bid(schedule, BATTERY), prices)
    assert charge == pytest.approx(schedule.charge_mw, abs=1e-6)
    assert discharge == pytest.approx(schedule.discharge_mw, abs=1e-6)
