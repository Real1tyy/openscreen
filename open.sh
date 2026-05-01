#!/bin/bash
# Open the OpenScreen editor, optionally with a video file
# Usage: ./open.sh                                  (empty project)
#        ./open.sh [--debug] /path/to/recording.mp4
#        ./open.sh --latest /path/to/directory

set -e

TAURI_BINARY="$(dirname "$0")/src-tauri/target/release/openscreen"
TAURI_APPIMAGE="$(dirname "$0")/src-tauri/target/release/bundle/appimage/OpenScreen_1.3.0_amd64.AppImage"
ELECTRON_APPIMAGE="$(dirname "$0")/release/1.3.0/Openscreen-Linux-1.3.0.AppImage"

if [ -f "$TAURI_BINARY" ]; then
  OPENSCREEN="$TAURI_BINARY"
elif [ -f "$TAURI_APPIMAGE" ]; then
  OPENSCREEN="$TAURI_APPIMAGE"
else
  OPENSCREEN="$ELECTRON_APPIMAGE"
fi

# WebKit inspector port is auto-selected by the app on Linux.
# Set WEBKIT_INSPECTOR_SERVER manually to override (e.g. 127.0.0.1:9222).

# Check for --debug flag
if [ "$1" = "--debug" ]; then
  export OPENSCREEN_DEVTOOLS=1
  shift
fi

DEFAULT_DIR="$HOME/Documents/OBS-Recordings"

if [ "$1" = "--latest" ]; then
  DIR="${2:-$DEFAULT_DIR}"
  INPUT=$(find "$DIR" -maxdepth 1 -name '*.mp4' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
  if [ -z "$INPUT" ]; then
    echo "No .mp4 files found in $DIR"
    exit 1
  fi
  echo "Opening: $INPUT"
else
  INPUT="$1"
fi

if [ -z "$INPUT" ]; then
  "$OPENSCREEN" &
  exit 0
fi

"$OPENSCREEN" "$INPUT" \
  --shadow-intensity 0.3 \
  --roundness 13.5 \
  --padding 7 \
  --motion-blur 0.2
