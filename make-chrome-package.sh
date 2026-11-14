#!/bin/bash
# Zips the extension folder with the Chrome setup guide, ready for "Load unpacked".
# Usage: ./make-chrome-package.sh   → dist/YT-Premium-Vibe-for-Chrome.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/YT Premium Vibe"
ditto "$ROOT/extension" "$STAGE/YT Premium Vibe"
cp "$ROOT/dist/README-Chrome-Setup-Guide.txt" "$STAGE/YT Premium Vibe/"
find "$STAGE" -name .DS_Store -delete

OUT="$ROOT/dist/YT-Premium-Vibe-for-Chrome.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" "YT Premium Vibe")
echo "Done: $OUT"
