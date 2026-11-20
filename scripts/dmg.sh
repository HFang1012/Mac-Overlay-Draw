#!/bin/sh
# Wraps build/Pane.app in build/Pane.dmg. Opening it shows a styled window: Pane on the left,
# Applications on the right, and the lilac twirl arrow between them (assets/dmg/background*.png).
# Attach build/Pane.dmg to a GitHub release; the website's download button links to it.
set -e
cd "$(dirname "$0")/.."
[ -d build/Pane.app ] || { echo "Run npm run package first."; exit 1; }

# dmgbuild lays out the Finder window without scripting Finder. It lives in a private venv under build/.
VENV=build/.dmg-venv
if [ ! -x "$VENV/bin/dmgbuild" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check dmgbuild
fi

rm -f build/Pane.dmg
"$VENV/bin/dmgbuild" -s scripts/dmg-settings.py \
  -D app="$PWD/build/Pane.app" \
  -D background="$PWD/assets/dmg/background.png" \
  -D icon="$PWD/assets/icon.icns" \
  Pane build/Pane.dmg
echo "Built build/Pane.dmg"
