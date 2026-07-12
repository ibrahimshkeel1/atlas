#!/bin/sh
set -e
cd /app
exec python -m app.workers.runner
