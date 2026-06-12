#!/usr/bin/env python3
"""Tower Sim — port 8121"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def end_headers(self):
        # ES modules cache hard otherwise; stale renderer/sim mixes break the game
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8121), Handler)
    print("Tower Sim on :8121")
    server.serve_forever()
