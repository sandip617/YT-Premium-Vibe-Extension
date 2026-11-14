#!/bin/bash
# Zips the extension folder with the Chrome setup guide, ready for "Load unpacked".
# manifest.json sits at the zip root: Windows "Extract All" and macOS both unzip into a
# YT-Premium-Vibe-for-Chrome folder, and that folder is the one to pick in Chrome.
# Chrome-only additions (the Safari build never sees them):
#   - "key" in manifest.json, so the extension ID is always dcofaohpknfljeceeomhhdhophljdabo
#     (the Windows download helper only answers that ID)
#   - INSTALL-DOWNLOAD-HELPER.bat + download-helper/ (one-click Download on Windows)
# Usage: ./make-chrome-package.sh   → dist/YT-Premium-Vibe-for-Chrome.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

ditto "$ROOT/extension" "$STAGE"
ditto "$ROOT/chrome/download-helper" "$STAGE/download-helper"
cp "$ROOT/chrome/INSTALL-DOWNLOAD-HELPER.bat" "$ROOT/dist/README-Chrome-Setup-Guide.txt" "$STAGE/"
python3 -I - "$STAGE/manifest.json" "$ROOT/chrome/manifest-key.txt" <<'EOF'
import json, sys
path, key = sys.argv[1], open(sys.argv[2]).read().strip()
m = json.load(open(path))
m["key"] = key
open(path, "w").write(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
EOF
# Windows tools expect CRLF line endings in .bat/.ps1/.txt files.
find "$STAGE" \( -name '*.bat' -o -name '*.ps1' -o -name '*.txt' \) -exec perl -pi -e 's/\r?\n/\r\n/' {} +
find "$STAGE" -name .DS_Store -delete

OUT="$ROOT/dist/YT-Premium-Vibe-for-Chrome.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" .)
echo "Done: $OUT"
