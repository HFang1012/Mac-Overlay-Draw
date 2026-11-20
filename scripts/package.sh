#!/bin/sh
# Builds build/Scrawl.app for this Mac and signs it locally so macOS will open it.
set -e
cd "$(dirname "$0")/.."
ARCH=$(uname -m)
rm -rf build && mkdir -p build
npx electron-packager . Scrawl --platform=darwin --arch="$ARCH" --out=build/.tmp --overwrite \
  --icon=assets/icon.icns --app-bundle-id=com.scrawl.app \
  --ignore='^/(build|assets|scripts|docs)' --ignore='/prebuilds/(linux|win32)'
mv "build/.tmp/Scrawl-darwin-$ARCH/Scrawl.app" build/Scrawl.app
rm -rf build/.tmp
codesign --force --deep --sign - build/Scrawl.app
echo "Built build/Scrawl.app"
