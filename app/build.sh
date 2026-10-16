#!/bin/bash
# Buduje Task Hub.app (arm64 + x86_64), instalator .pkg i obraz .dmg. Tylko narzędzia z Xcode Command Line Tools.
#   app/build.sh 0.1.0 [numer_budowy]
# Wynik: app/build/Task Hub.app, app/build/Task-Hub-<wersja>.pkg, app/build/Task-Hub-<wersja>.dmg
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${1:-0.0.0}"
BUILD="${2:-1}"
OUT="build"
APP="$OUT/Task Hub.app"
rm -rf "$OUT"
mkdir -p "$OUT/obj" "$APP/Contents/MacOS" "$APP/Contents/Resources"

SDK="$(xcrun --show-sdk-path --sdk macosx)"
echo "== swiftc $(swiftc --version 2>&1 | head -1)"
for ARCH in arm64 x86_64; do
  echo "== kompilacja $ARCH"
  swiftc -O -swift-version 5 -parse-as-library -target "$ARCH-apple-macos13.0" -sdk "$SDK" -module-name TaskHub \
    -framework AppKit -framework WebKit -framework SwiftUI -framework Carbon -framework ServiceManagement -framework Combine \
    -o "$OUT/obj/TaskHub-$ARCH" Sources/*.swift
done
lipo -create -output "$APP/Contents/MacOS/Task Hub" "$OUT/obj/TaskHub-arm64" "$OUT/obj/TaskHub-x86_64"

sed -e "s/__VERSION__/$VERSION/g" -e "s/__BUILD__/$BUILD/g" Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "== ikona"
ICONSET="$OUT/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s Icon/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d Icon/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "== podpis (ad hoc)"
codesign --force --deep --sign - --identifier com.taskhub.app "$APP"
codesign --verify --verbose=2 "$APP"

echo "== instalator"
pkgbuild --component "$APP" --install-location /Applications --identifier com.taskhub.app --version "$VERSION" "$OUT/Task-Hub-$VERSION.pkg"
hdiutil create -volname "Task Hub" -srcfolder "$APP" -ov -format UDZO "$OUT/Task-Hub-$VERSION.dmg" >/dev/null
ls -la "$OUT"
echo "== gotowe: $APP, $OUT/Task-Hub-$VERSION.pkg, $OUT/Task-Hub-$VERSION.dmg"
