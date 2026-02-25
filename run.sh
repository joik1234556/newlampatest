#!/usr/bin/env bash
# Easy-Mod backend startup script
# Usage: ./run.sh [--reload]
#
# Prerequisites:
#   Redis must be running before starting the backend.
#   Quick start:
#     docker run -d --name redis -p 6379:6379 redis:7-alpine
#   OR on Debian/Ubuntu:
#     sudo apt-get install -y redis-server && sudo systemctl start redis
#
# The backend falls back to in-memory caching if Redis is unreachable,
# but persistence across restarts and deduplication will not work.

set -e

if [ ! -f .env ]; then
    echo "[run.sh] .env not found — copying .env.example"
    cp .env.example .env
fi

if [ ! -d .venv ]; then
    echo "[run.sh] creating virtual environment"
    python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[run.sh] installing/updating dependencies"
pip install -q -r requirements.txt

RELOAD_FLAG=""
WORKERS=2
if [ "$1" = "--reload" ]; then
    RELOAD_FLAG="--reload"
    WORKERS=1   # --reload is incompatible with multiple workers
fi

echo "[run.sh] starting uvicorn on 0.0.0.0:8000 (workers=${WORKERS}) ${RELOAD_FLAG}"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${WORKERS}" ${RELOAD_FLAG}
