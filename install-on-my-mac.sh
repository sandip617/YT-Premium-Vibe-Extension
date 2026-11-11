#!/bin/bash
# Builds YT Premium Vibe signed with YOUR Apple Development certificate and installs
# it in /Applications. Signed this way, Safari keeps the extension on after a restart,
# so you don't need "Allow unsigned extensions".
#
# Needs: Xcode signed in with your Apple ID (Xcode → Settings → Accounts) and an
# "Apple Development" certificate (Manage Certificates → + → Apple Development).
# Usage: ./install-on-my-mac.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TEAM_ID="${TEAM_ID:-$(security find-certificate -c "Apple Development" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | grep -oE 'OU ?= ?[A-Z0-9]{10}' | grep -oE '[A-Z0-9]{10}$' || true)}"
if [ -z "$TEAM_ID" ]; then
  echo "No Apple Development certificate found. Add one in Xcode → Settings → Accounts → Manage Certificates." >&2
  exit 1
fi
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

echo "Building (team $TEAM_ID)…"
xcodebuild -project "$ROOT/YT Premium Vibe/YT Premium Vibe.xcodeproj" -scheme "YT Premium Vibe" -configuration Release \
  -derivedDataPath "$BUILD" CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_IDENTITY="Apple Development" \
  -allowProvisioningUpdates build -quiet

APP="$BUILD/Build/Products/Release/YT Premium Vibe.app"
pkill -x "YT Premium Vibe" 2>/dev/null || true
rm -rf "/Applications/YT Premium Vibe.app"
ditto "$APP" "/Applications/YT Premium Vibe.app"
# Make Safari use the copy in Applications, not the temporary build.
pluginkit -r "$APP/Contents/PlugIns/YT Premium Vibe Extension.appex" 2>/dev/null || true
"$LSR" -u "$APP" 2>/dev/null || true
"$LSR" -f "/Applications/YT Premium Vibe.app"
pluginkit -a "/Applications/YT Premium Vibe.app/Contents/PlugIns/YT Premium Vibe Extension.appex"
open -a "/Applications/YT Premium Vibe.app"
echo "✓ Installed. If it's new or re-signed: Safari → Settings → Extensions → tick YT Premium Vibe,"
echo "  and allow youtube.com (toolbar icon → Always Allow on This Website)."
