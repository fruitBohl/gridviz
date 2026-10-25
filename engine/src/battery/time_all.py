import sys
import time
from pathlib import Path

from battery.model import Battery
from battery.solve import REGIONS, solve_day
from battery.store import LocalStore

# One-off check that every region-day in the backfill solves well inside the Lambda timeout
REPO = Path(__file__).resolve().parents[3]
root = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "backfill-out"
store = LocalStore(root)
battery = Battery()

dates = sorted(p.stem for p in (root / "data/days").glob("*.json"))
timings: list[tuple[float, str, str]] = []
failures: list[str] = []
for date in dates:
    for region in REGIONS:
        started = time.perf_counter()
        status, body = solve_day(store, region, date, battery)
        seconds = time.perf_counter() - started
        timings.append((seconds, date, region))
        if status != 200:
            failures.append(f"{date} {region} {status} {body['error']}")
        if seconds > 5:
            print(f"slow: {date} {region} {seconds:.1f}s", flush=True)

timings.sort(reverse=True)
print(f"{len(timings)} region-days over {len(dates)} days, {sum(t for t, _, _ in timings):.0f}s total")
print("slowest:", ", ".join(f"{d} {r} {t:.1f}s" for t, d, r in timings[:5]))
print(f"{len(failures)} not solved:")
for line in failures:
    print(" ", line)
