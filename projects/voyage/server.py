#!/usr/bin/env python3
"""Voyage — Raymarched Ocean. Port 8118."""
import http.server
import os

PORT = 8118
DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    s = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Voyage on :{PORT}")
    s.serve_forever()
