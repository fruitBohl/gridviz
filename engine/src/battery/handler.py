import json
import os
from typing import Any

from battery.model import Battery
from battery.solve import solve_day
from battery.store import S3Store

bucket = os.environ.get("DATA_BUCKET")
if not bucket:
    raise RuntimeError("DATA_BUCKET is not set")

store = S3Store(bucket)

# Same inputs always give the same answer, so CloudFront may keep successes for a day
CACHE = {200: "public, max-age=86400"}


def handler(event: dict[str, Any], context: object = None) -> dict[str, Any]:
    query = event.get("queryStringParameters") or {}
    region, date = query.get("region"), query.get("date")
    status, body = solve_day(store, region, date, Battery())
    print(json.dumps({"region": region, "date": date, "status": status, "solveSeconds": body.get("solveSeconds"),
                      "error": body.get("error")}))
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": CACHE.get(status, "no-store")},
        "body": json.dumps(body),
    }
