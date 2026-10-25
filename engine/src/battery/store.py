import json
from pathlib import Path
from typing import Any


class LocalStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)

    def get_json(self, key: str) -> Any | None:
        try:
            return json.loads((self.root / key).read_text())
        except FileNotFoundError:
            return None


class S3Store:
    def __init__(self, bucket: str):
        # botocore, not boto3: boto3 imports multiprocessing, and Pyomo then creates a multiprocessing
        # Lock, which fails in Lambda (no /dev/shm). botocore is in the Lambda runtime; dev dependency locally.
        import botocore.session

        self.bucket = bucket
        self.s3 = botocore.session.get_session().create_client("s3")

    def get_json(self, key: str) -> Any | None:
        try:
            res = self.s3.get_object(Bucket=self.bucket, Key=key)
        except self.s3.exceptions.NoSuchKey:  # needs s3:ListBucket; without it S3 answers AccessDenied
            return None
        return json.loads(res["Body"].read())
