import json
from pathlib import Path

import pytest

from battery.model import Battery
from battery.solve import REGIONS, region_prices, solve_day
from battery.store import LocalStore

DATE = "2025-01-15"


def write_day(root: Path, date: str, intervals: int = 288, drop: str | None = None) -> None:
    prices = [-100.0] * (intervals // 2) + [300.0] * (intervals - intervals // 2)
    day = {
        "tradingDate": date,
        "intervals": [
            {"t": f"{date}T{i}", "regions": {r: {"price": p} for r in REGIONS if not (drop == r and i == 5)}}
            for i, p in enumerate(prices)
        ],
    }
    path = root / "data" / "days" / f"{date}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(day))


@pytest.fixture
def store(tmp_path: Path) -> LocalStore:
    write_day(tmp_path, DATE)
    write_day(tmp_path, "2025-01-16", intervals=287)
    write_day(tmp_path, "2025-01-17", drop="SA1")
    return LocalStore(tmp_path)


def test_region_prices_needs_every_interval_and_region(store: LocalStore):
    assert region_prices(store.get_json("data/days/2025-01-16.json"), "SA1") is None
    assert region_prices(store.get_json("data/days/2025-01-17.json"), "SA1") is None
    assert region_prices(store.get_json("data/days/2025-01-17.json"), "VIC1") is not None


@pytest.mark.parametrize(
    "region, date, status",
    [
        ("XX1", DATE, 400),
        (None, DATE, 400),
        ("SA1", "2025-1-15", 400),
        ("SA1", "20250115", 400),
        ("SA1", None, 400),
        ("SA1", "2025-02-30", 400),
        ("SA1", "2030-01-01", 404),
        ("SA1", "2025-01-16", 404),
        ("SA1", "2025-01-17", 404),
    ],
)
def test_bad_requests(store: LocalStore, region, date, status):
    got, body = solve_day(store, region, date, Battery())
    assert got == status
    assert "error" in body


def test_solves_a_complete_day(store: LocalStore):
    status, body = solve_day(store, "SA1", DATE, Battery())
    assert status == 200
    assert body["region"] == "SA1" and body["tradingDate"] == DATE
    for key in ("t", "price", "chargeMw", "dischargeMw", "socMwh"):
        assert len(body[key]) == 288
    for side in ("gen", "load"):
        assert len(body["bid"][side]["prices"]) == 10
        assert len(body["bid"][side]["maxAvail"]) == 288
        assert all(len(bands) == 10 for bands in body["bid"][side]["bands"])
    assert body["revenue"] > 0
    assert body["relaxedRevenue"] >= body["revenue"]
    json.dumps(body)
