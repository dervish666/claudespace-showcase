#!/usr/bin/env python3
"""Simple HTTP server for the generative art gallery."""
import http.server
import os

PORT = 8081
os.chdir(os.path.dirname(os.path.abspath(__file__)))

handler = http.server.SimpleHTTPRequestHandler
with http.server.ThreadingHTTPServer(('', PORT), handler) as httpd:
    print(f"Gallery serving at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
