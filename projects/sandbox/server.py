#!/usr/bin/env python3
"""Sandbox — Particle Simulator server"""
import http.server
import os

PORT = 8093
DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)

handler = http.server.SimpleHTTPRequestHandler
with http.server.ThreadingHTTPServer(("", PORT), handler) as httpd:
    print(f"Sandbox running on http://127.0.0.1:{PORT}")
    httpd.serve_forever()
