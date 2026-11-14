#!/bin/bash
# Zips the extension folder with the Chrome setup guide, ready for "Load unpacked".
# manifest.json sits at the zip root: Windows "Extract All" and macOS both unzip into a
# YT-Premium-Vibe-for-Chrome folder, and that folder is the one to pick in Chrome.
# Usage: ./make-chrome-package.sh   → dist/YT-Premium-Vibe-for-Chrome.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

ditto "$ROOT/extension" "$STAGE"
cp "$ROOT/dist/README-Chrome-Setup-Guide.txt" "$STAGE/"
find "$STAGE" -name .DS_Store -delete

OUT="$ROOT/dist/YT-Premium-Vibe-for-Chrome.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" .)
echo "Done: $OUT"
