#!/usr/bin/env python3
"""Automata — Interactive cellular automata playground."""
import http.server
import os

PORT = 8087

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('', PORT), Handler) as httpd:
        print(f"Automata running on http://127.0.0.1:{PORT}")
        httpd.serve_forever()
