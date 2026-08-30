#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"
COMMON_FILES="src popup options assets"

mkdir -p "$DIST_DIR/chromium" "$DIST_DIR/firefox"
for dir in $COMMON_FILES; do
  rm -rf "$DIST_DIR/chromium/$dir" "$DIST_DIR/firefox/$dir"
  cp -R "$ROOT_DIR/$dir" "$DIST_DIR/chromium/$dir"
  cp -R "$ROOT_DIR/$dir" "$DIST_DIR/firefox/$dir"
done
cp "$ROOT_DIR/manifest.json" "$DIST_DIR/chromium/manifest.json"
cp "$ROOT_DIR/manifest.firefox.json" "$DIST_DIR/firefox/manifest.json"

if command -v zip >/dev/null 2>&1; then
  rm -f "$DIST_DIR/yayi-chromium.zip" "$DIST_DIR/yayi-firefox.zip"
  (cd "$DIST_DIR/chromium" && zip -qr "$DIST_DIR/yayi-chromium.zip" .)
  (cd "$DIST_DIR/firefox" && zip -qr "$DIST_DIR/yayi-firefox.zip" .)

  if [ -d "$ROOT_DIR/docs" ]; then
    mkdir -p "$ROOT_DIR/docs/downloads" "$ROOT_DIR/docs/assets"
    cp "$DIST_DIR/yayi-chromium.zip" "$ROOT_DIR/docs/downloads/yayi-chromium.zip"
    cp "$DIST_DIR/yayi-firefox.zip" "$ROOT_DIR/docs/downloads/yayi-firefox.zip"
    cp "$DIST_DIR/yayi-chromium.zip" "$ROOT_DIR/docs/downloads/yayi-safari-source.zip"
    cp "$ROOT_DIR/assets/icon-48.png" "$ROOT_DIR/docs/assets/icon-48.png"
    cp "$ROOT_DIR/assets/icon-128.png" "$ROOT_DIR/docs/assets/icon-128.png"
  fi
fi

echo "已生成：dist/chromium 与 dist/firefox"
echo "商店压缩包：dist/yayi-chromium.zip 与 dist/yayi-firefox.zip"
echo "Safari：xcrun safari-web-extension-converter dist/chromium --project-location dist/safari --app-name 雅译"
