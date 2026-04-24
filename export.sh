#!/bin/bash
# OpenScreen headless export template
# Usage: ./export.sh /path/to/recording.mp4
# Output: /path/to/recording-openscreen.mp4

set -e

OPENSCREEN="$(dirname "$0")/release/1.3.0/Openscreen-Linux-1.3.0.AppImage"
DEFAULT_DIR="$HOME/Documents/OBS-Recordings"

if [ "$1" = "--latest" ]; then
  DIR="${2:-$DEFAULT_DIR}"
  INPUT=$(find "$DIR" -maxdepth 1 -name '*.mp4' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
  if [ -z "$INPUT" ]; then
    echo "No .mp4 files found in $DIR"
    exit 1
  fi
  echo "Exporting: $INPUT"
else
  INPUT="$1"
fi

if [ -z "$INPUT" ]; then
  echo "Usage: ./export.sh /path/to/recording.mp4"
  echo "       ./export.sh --latest [/path/to/directory]"
  exit 1
fi

OUTPUT="${INPUT%.mp4}-openscreen.mp4"

"$OPENSCREEN" --no-sandbox --export "$INPUT" \
  --shadow-intensity 0.3 \
  --roundness 13.5 \
  --padding 7 \
  --motion-blur 0.2 \
  -o "$OUTPUT"
