"""Tiny HTTP viewer; the world runs in this process even with no browser connected."""
import json
import os
import signal
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from world import World

ROOT = Path(__file__).resolve().parent
WORLD = World()


def train():
    previous = time.monotonic()
    while True:
        start = time.monotonic()
        delta = min(start - previous, .2)
        previous = start
        WORLD.tick(delta)
        time.sleep(max(0, .10 - (time.monotonic() - start)))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/state":
            body = json.dumps(WORLD.snapshot(), separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path in ("/", "/index.html", "/style.css", "/app.js", "/map.json"):
            if self.path == "/":
                self.path = "/index.html"
            super().do_GET()
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):
        if self.path != "/api/state":
            super().log_message(fmt, *args)


if __name__ == "__main__":
    def shutdown(*_):
        with WORLD.lock:
            WORLD.save()
        sys.exit(0)
    signal.signal(signal.SIGTERM, shutdown)
    threading.Thread(target=train, daemon=True).start()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8800"))
    print(f"Little World at http://{host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
