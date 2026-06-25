#!/usr/bin/env python3
"""Settlers 3D — port 8123"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args): pass

if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8123), Handler)
    print("Settlers 3D on :8123")
    server.serve_forever()
