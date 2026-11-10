#!/bin/bash
# Builds a universal (Apple Silicon + Intel) Release of YT Premium Vibe and
# zips it with the setup guide, ready to send to a friend.
# Usage: ./make-friend-package.sh   → dist/YT-Premium-Vibe-for-Mac.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

xcodebuild -project "$ROOT/YT Premium Vibe/YT Premium Vibe.xcodeproj" -scheme "YT Premium Vibe" \
  -configuration Release -derivedDataPath "$BUILD" ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO build -quiet

APP="$BUILD/Build/Products/Release/YT Premium Vibe.app"
STAGE="$BUILD/stage/YT Premium Vibe"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/YT Premium Vibe.app"
cp "$ROOT/dist/README-Setup-Guide.txt" "$STAGE/"

OUT="$ROOT/dist/YT-Premium-Vibe-for-Mac.zip"
rm -f "$OUT"
ditto -c -k --norsrc --keepParent "$STAGE" "$OUT"
# Don't leave the temporary build registered with macOS/Safari.
pluginkit -r "$APP/Contents/PlugIns/YT Premium Vibe Extension.appex" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP" 2>/dev/null || true
if [ -d "/Applications/YT Premium Vibe.app" ]; then
  pluginkit -a "/Applications/YT Premium Vibe.app/Contents/PlugIns/YT Premium Vibe Extension.appex" 2>/dev/null || true
fi
echo "Done: $OUT"
