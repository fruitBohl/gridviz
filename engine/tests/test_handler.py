import json
import os
from pathlib import Path

import pytest

from battery.store import LocalStore
from tests.test_solve import DATE, write_day

# The handler builds an S3 client at import; keep it away from the developer's real AWS profile
os.environ.pop("AWS_PROFILE", None)
os.environ.update(
    DATA_BUCKET="test-bucket",
    AWS_DEFAULT_REGION="ap-southeast-2",
    AWS_ACCESS_KEY_ID="test",
    AWS_SECRET_ACCESS_KEY="test",
)

from battery import handler  # noqa: E402


@pytest.fixture(autouse=True)
def local_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    write_day(tmp_path, DATE)
    monkeypatch.setattr(handler, "store", LocalStore(tmp_path))


def test_success_is_cacheable_json():
    res = handler.handler({"queryStringParameters": {"region": "SA1", "date": DATE}})
    assert res["statusCode"] == 200
    assert res["headers"] == {"Content-Type": "application/json", "Cache-Control": "public, max-age=86400"}
    assert json.loads(res["body"])["region"] == "SA1"


@pytest.mark.parametrize("query", [None, {}, {"region": "SA1"}, {"region": "XX1", "date": DATE}])
def test_errors_are_not_cached(query):
    res = handler.handler({"queryStringParameters": query})
    assert res["statusCode"] == 400
    assert res["headers"]["Cache-Control"] == "no-store"
    assert "error" in json.loads(res["body"])


LAMBDA_LIKE = """
import _multiprocessing, sys

class NoSemLock:  # Lambda has no /dev/shm, so creating a multiprocessing lock fails there
    SEM_VALUE_MAX = _multiprocessing.SemLock.SEM_VALUE_MAX

    def __init__(self, *args, **kwargs):
        raise FileNotFoundError(2, "No such file or directory")

_multiprocessing.SemLock = NoSemLock
from battery import handler  # noqa: E402,F401
print("ok")
"""


def test_imports_without_multiprocessing_locks():
    import subprocess
    import sys

    env = {k: v for k, v in os.environ.items() if k != "AWS_PROFILE"}
    result = subprocess.run([sys.executable, "-c", LAMBDA_LIKE], capture_output=True, text=True, env=env)
    assert result.stdout.strip() == "ok", result.stderr
