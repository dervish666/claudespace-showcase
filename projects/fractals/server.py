#!/usr/bin/env python3
"""Fractal Explorer server"""
import http.server
import os

PORT = 8092
DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)

handler = http.server.SimpleHTTPRequestHandler
with http.server.ThreadingHTTPServer(("", PORT), handler) as httpd:
    print(f"Fractal Explorer running on http://127.0.0.1:{PORT}")
    httpd.serve_forever()
