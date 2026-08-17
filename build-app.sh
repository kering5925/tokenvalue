#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/ETH & CRCLB.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"

mkdir -p "$MACOS_DIR"
cp "$SCRIPT_DIR/App/Info.plist" "$CONTENTS_DIR/Info.plist"

swiftc \
  -O \
  -parse-as-library \
  -framework AppKit \
  -framework SwiftUI \
  -framework WidgetKit \
  "$SCRIPT_DIR"/App/*.swift \
  "$SCRIPT_DIR"/Shared/*.swift \
  -o "$MACOS_DIR/ETHPriceWidget"

codesign \
  --force \
  --sign - \
  --entitlements "$SCRIPT_DIR/App/ETHPriceWidget.entitlements" \
  "$APP_BUNDLE"

echo "$APP_BUNDLE"

