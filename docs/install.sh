#!/bin/sh
# Installs (or updates) Pane in Applications, with no "can't verify" prompt:
#
#   curl -fsSL https://hfang1012.github.io/Mac-Overlay-Draw/install.sh | sh
#
# Why no prompt: macOS only checks apps carrying the "downloaded from the internet" mark that browsers
# add. curl doesn't add it, so Pane installed this way opens straight away.
#
# Pane used to be called Scrawl (Scrawl is now its drawing tool). An old Scrawl.app is replaced,
# and Pane picks up its settings and drawings.
set -e

REPO="${PANE_REPO:-${SCRAWL_REPO:-HFang1012/Mac-Overlay-Draw}}"
URL="https://github.com/$REPO/releases/latest/download/Pane.dmg"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Pane runs on macOS. Run this on your Mac."
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Pane needs a Mac with Apple silicon (M1 or newer)."
  exit 1
fi

TMP=$(mktemp -d)
MNT="$TMP/disk"
cleanup() {
  hdiutil detach -quiet "$MNT" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading Pane..."
curl -fL --progress-bar "$URL" -o "$TMP/Pane.dmg"

mkdir "$MNT"
hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MNT" "$TMP/Pane.dmg"

# Applications, or your own Applications folder if the main one isn't writable for this account.
DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

for OLD in Pane Scrawl; do
  if pgrep -xq "$OLD"; then
    echo "Quitting the $OLD that's running..."
    osascript -e "quit app \"$OLD\"" >/dev/null 2>&1 || true
    sleep 1
  fi
done

# The old Scrawl app, if it's here: Pane replaces it.
for DIR in /Applications "$HOME/Applications"; do
  if [ -d "$DIR/Scrawl.app" ] && [ -w "$DIR" ]; then
    echo "Replacing Scrawl.app in $DIR (Scrawl is now part of Pane)..."
    rm -rf "$DIR/Scrawl.app"
  fi
done

rm -rf "$DEST/Pane.app"
ditto "$MNT/Pane.app" "$DEST/Pane.app"
xattr -dr com.apple.quarantine "$DEST/Pane.app" 2>/dev/null || true

VERSION=$(defaults read "$DEST/Pane.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")
echo "Installed Pane $VERSION in $DEST."
echo "Opening Pane. Turn it on in System Settings > Privacy & Security > Accessibility when it asks (Scrawl needs it to hear your keys)."
open "$DEST/Pane.app"
