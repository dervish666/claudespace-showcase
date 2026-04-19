#!/usr/bin/env python3
"""Uno card game server."""
import http.server
import os

PORT = 8105
os.chdir(os.path.dirname(os.path.abspath(__file__)))

handler = http.server.SimpleHTTPRequestHandler
with http.server.ThreadingHTTPServer(('', PORT), handler) as httpd:
    print(f"Uno on :{PORT}")
    httpd.serve_forever()
