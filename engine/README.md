# battery

Optimises a 100 MW / 200 MWh battery against one region-day of NEM spot prices (Pyomo + HiGHS) and turns the schedule into a 10-band AEMO bid. Runs as the `gridviz-solve` Lambda behind `/api/solve?region=…&date=…`.

```sh
uv run pytest -q                              # tests
uv run python src/battery/local_api.py        # http://localhost:8000/api/solve for `next dev`, reads ../public
uv run python src/battery/time_all.py         # solve every backfilled region-day, report slow or failed ones
bun run build:engine                          # from the repo root: arm64 Lambda bundle in engine/dist
```

The frontend's copy of the battery parameters (`lib/battery.ts`) must match `Battery` in `src/battery/model.py`.
