#!/bin/sh
# Installs (or updates) Scrawl in Applications, with no "can't verify" prompt:
#
#   curl -fsSL https://hfang1012.github.io/Mac-Overlay-Draw/install.sh | sh
#
# Why no prompt: macOS only checks apps carrying the "downloaded from the internet" mark that browsers
# add. curl doesn't add it, so Scrawl installed this way opens straight away.
set -e

REPO="${SCRAWL_REPO:-HFang1012/Mac-Overlay-Draw}"
URL="https://github.com/$REPO/releases/latest/download/Scrawl.dmg"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Scrawl runs on macOS. Run this on your Mac."
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Scrawl needs a Mac with Apple silicon (M1 or newer)."
  exit 1
fi

TMP=$(mktemp -d)
MNT="$TMP/disk"
cleanup() {
  hdiutil detach -quiet "$MNT" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading Scrawl..."
curl -fL --progress-bar "$URL" -o "$TMP/Scrawl.dmg"

mkdir "$MNT"
hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MNT" "$TMP/Scrawl.dmg"

# Applications, or your own Applications folder if the main one isn't writable for this account.
DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

if pgrep -xq Scrawl; then
  echo "Quitting the Scrawl that's running..."
  osascript -e 'quit app "Scrawl"' >/dev/null 2>&1 || true
  sleep 1
fi

rm -rf "$DEST/Scrawl.app"
ditto "$MNT/Scrawl.app" "$DEST/Scrawl.app"
xattr -dr com.apple.quarantine "$DEST/Scrawl.app" 2>/dev/null || true

VERSION=$(defaults read "$DEST/Scrawl.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")
echo "Installed Scrawl $VERSION in $DEST."
echo "Opening Scrawl. Turn it on in System Settings > Privacy & Security > Accessibility when it asks."
open "$DEST/Scrawl.app"
