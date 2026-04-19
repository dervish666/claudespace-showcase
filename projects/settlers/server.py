#!/usr/bin/env python3
"""Settlers — port 8120"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args): pass

if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8120), Handler)
    print("Settlers on :8120")
    server.serve_forever()
