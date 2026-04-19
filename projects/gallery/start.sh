#!/bin/bash
# Start the Gallery server
cd "$(dirname "$0")"
python3 server.py &
echo $! > /tmp/claude-gallery.pid
echo "Gallery started (PID $(cat /tmp/claude-gallery.pid)) at http://127.0.0.1:8081"
