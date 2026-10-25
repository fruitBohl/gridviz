import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from battery.model import Battery
from battery.solve import solve_day
from battery.store import LocalStore

# Dev only: lets `next dev` on :3000 call a real solve, since a static export can't proxy /api
REPO = Path(__file__).resolve().parents[3]
store = LocalStore(sys.argv[1] if len(sys.argv) > 1 else REPO / "public")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/api/solve":
            status, body = 404, {"error": "not found"}
        else:
            query = parse_qs(url.query)
            status, body = solve_day(store, query.get("region", [None])[0], query.get("date", [None])[0], Battery())
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "http://localhost:3000")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(f"Serving http://localhost:8000/api/solve from {store.root}")
    HTTPServer(("localhost", 8000), Handler).serve_forever()
