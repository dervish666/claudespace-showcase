#!/usr/bin/env python3
"""Garden — Generative Ambient Music server."""
import http.server
import os

PORT = 8115
DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIR, **kw)
    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    s = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Garden ambient music on :{PORT}')
    s.serve_forever()
