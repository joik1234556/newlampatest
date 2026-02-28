#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# scripts/test_torbox_get.sh
#
# Quick smoke-test for the /torbox/get endpoint.
# Usage:
#   ./scripts/test_torbox_get.sh [BASE_URL]
#
# Defaults to http://localhost:8000 when BASE_URL is not supplied.
# ----------------------------------------------------------------------------
set -euo pipefail

BASE="${1:-http://localhost:8000}"

echo "=== /variants (Oppenheimer 2023) ==="
VARIANTS=$(curl -s "${BASE}/variants?title=Oppenheimer&year=2023")
echo "$VARIANTS" | python3 -m json.tool 2>/dev/null || echo "$VARIANTS"

# Extract first magnet from variants
MAGNET=$(echo "$VARIANTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for v in data.get('variants', []):
    if v.get('magnet','').startswith('magnet:'):
        print(v['magnet'])
        break
" 2>/dev/null || true)

TORRENT_URL=$(echo "$VARIANTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for v in data.get('variants', []):
    tu = v.get('torrent_url','')
    if tu and tu.startswith('http'):
        print(tu)
        break
" 2>/dev/null || true)

echo ""
echo "=== /torbox/get (magnet) ==="
if [ -n "$MAGNET" ]; then
    ENCODED_MAGNET=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$MAGNET")
    RESULT=$(curl -s "${BASE}/torbox/get?magnet=${ENCODED_MAGNET}")
    echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
    DIRECT=$(echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
files = d.get('files', [])
if files:
    print(files[0].get('url',''))
elif d.get('direct_url'):
    print(d['direct_url'])
" 2>/dev/null || true)
    if [ -n "$DIRECT" ]; then
        echo ""
        echo ">>> direct_url: $DIRECT"
    fi
else
    echo "(no magnet found in /variants -- skipping)"
fi

echo ""
echo "=== /torbox/get (torrent_url) ==="
if [ -n "$TORRENT_URL" ]; then
    ENCODED_URL=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$TORRENT_URL")
    RESULT=$(curl -s "${BASE}/torbox/get?torrent_url=${ENCODED_URL}")
    echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
else
    echo "(no torrent_url found in /variants -- skipping)"
fi
