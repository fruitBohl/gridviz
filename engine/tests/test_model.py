import random

import pytest

from battery.model import INTERVAL_HOURS, Battery, Schedule, solve_model

TOL = 1e-6


def both_ways(s: Schedule) -> list[int]:
    return [t for t, (c, d) in enumerate(zip(s.charge_mw, s.discharge_mw)) if c > TOL and d > TOL]


def test_flat_prices_stay_idle():
    s = solve_model([50.0] * 24, Battery())
    assert s.revenue == pytest.approx(0, abs=TOL)
    assert max(s.charge_mw + s.discharge_mw) == pytest.approx(0, abs=TOL)


def test_cheap_then_expensive():
    # Paid $10,000 to charge 100 MWh (93.8 stored), then 93.8 × 0.938 = 88 MWh sold at $300
    s = solve_model([-100.0] * 12 + [300.0] * 12, Battery())
    assert s.revenue == pytest.approx(36400)
    assert s.charge_mw[:12] == pytest.approx([100.0] * 12)
    assert sum(s.discharge_mw[:12]) == pytest.approx(0, abs=TOL)
    assert sum(s.charge_mw[12:]) == pytest.approx(0, abs=TOL)


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_invariants_on_random_prices(seed: int):
    battery = Battery()
    rng = random.Random(seed)
    prices = [rng.uniform(-200, 500) for _ in range(288)]
    mip = solve_model(prices, battery)
    relaxed = solve_model(prices, battery, relax=True)

    assert mip.revenue >= -TOL, "doing nothing is feasible, so revenue can't be negative"
    assert relaxed.revenue >= mip.revenue - TOL
    assert both_ways(mip) == []
    assert mip.stored_mwh[-1] >= battery.start_soc_mwh - TOL
    assert min(mip.stored_mwh) >= -TOL and max(mip.stored_mwh) <= battery.energy_mwh + TOL

    # Rebuild the state of charge from charge and discharge, independently of the model
    eta, soc = battery.leg_efficiency, battery.start_soc_mwh
    for c, d, stored in zip(mip.charge_mw, mip.discharge_mw, mip.stored_mwh):
        soc += eta * c * INTERVAL_HOURS - d * INTERVAL_HOURS / eta
        assert stored == pytest.approx(soc, abs=1e-4)

    revenue = sum(p * (d - c) * INTERVAL_HOURS for p, c, d in zip(prices, mip.charge_mw, mip.discharge_mw))
    assert mip.revenue == pytest.approx(revenue)


def test_binary_stops_charging_and_discharging_at_once():
    # Once full, the relaxed battery burns energy through its losses to keep getting paid at -$1000
    prices = [-1000.0] * 48
    mip = solve_model(prices, Battery())
    relaxed = solve_model(prices, Battery(), relax=True)

    assert both_ways(relaxed) != []
    assert both_ways(mip) == []
    assert relaxed.revenue > mip.revenue


def test_impossible_battery_is_rejected():
    with pytest.raises(ValueError):
        Battery(start_soc_mwh=500)
