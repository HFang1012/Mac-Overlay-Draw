#!/bin/sh
# Wraps build/Scrawl.app in build/Scrawl.dmg: a disk with the app beside an Applications shortcut,
# ready to attach to a GitHub release (the website links to releases/latest/download/Scrawl.dmg).
set -e
cd "$(dirname "$0")/.."
[ -d build/Scrawl.app ] || { echo "Run npm run package first."; exit 1; }
STAGE=$(mktemp -d)
cp -R build/Scrawl.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f build/Scrawl.dmg
hdiutil create -volname Scrawl -srcfolder "$STAGE" -ov -format UDZO build/Scrawl.dmg >/dev/null
rm -rf "$STAGE"
echo "Built build/Scrawl.dmg"
