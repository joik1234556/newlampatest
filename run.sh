#!/usr/bin/env bash
# Easy-Mod backend startup script
# Usage: ./run.sh [--reload]

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
if [ "$1" = "--reload" ]; then
    RELOAD_FLAG="--reload"
fi

echo "[run.sh] starting uvicorn on 0.0.0.0:8000 $RELOAD_FLAG"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 $RELOAD_FLAG
