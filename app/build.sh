#!/bin/zsh
# Builds ~/Applications/Buddy.app (the menu bar app with Buddy's chat window) from BuddyApp.swift.
# It's built off to the side and then swapped in: changing a running app's signed binary in place makes macOS
# kill the new version the moment it launches (the updater then thought the update "failed to start").
set -e
cd "$(dirname "$0")"
FINAL="$HOME/Applications/Buddy.app"
APP="$HOME/Applications/.Buddy-build.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/Buddy" BuddyApp.swift -framework Cocoa -framework WebKit
# App icon.
SRC=../web/default-icons/mac-1024.png
SET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns" && rm -rf "$(dirname "$SET")"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Buddy</string>
  <key>CFBundleDisplayName</key><string>Buddy</string>
  <key>CFBundleIdentifier</key><string>local.buddy.companion</string>
  <key>CFBundleExecutable</key><string>Buddy</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>So you can talk to Buddy out loud.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
git -C .. rev-parse HEAD > "$APP/Contents/Resources/source-rev" 2>/dev/null || true   # lets the updater finish an interrupted update
codesign --force --deep --sign - "$APP"
# Swap in the fresh copy (a running Buddy keeps its old files until it restarts).
rm -rf "$FINAL.old"
[ -d "$FINAL" ] && mv "$FINAL" "$FINAL.old"
mv "$APP" "$FINAL"
rm -rf "$FINAL.old"
zsh ../scripts/deps.sh || true                 # Buddy's Python environment (.venv + pywebpush for notifications)
touch "$FINAL"                                # so Finder picks up a new icon
echo "Built $FINAL"
