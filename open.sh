#!/bin/bash
# Open a video in the OpenScreen editor with standard settings
# Usage: ./open.sh /path/to/recording.mp4
#        ./open.sh --latest /path/to/directory

set -e

OPENSCREEN="$(dirname "$0")/release/1.3.0/Openscreen-Linux-1.3.0.AppImage"

if [ "$1" = "--latest" ]; then
  DIR="${2:-.}"
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
  echo "Usage: ./open.sh /path/to/recording.mp4"
  echo "       ./open.sh --latest /path/to/directory"
  exit 1
fi

"$OPENSCREEN" --no-sandbox "$INPUT" \
  --shadow-intensity 0.3 \
  --roundness 13.5 \
  --padding 7 \
  --motion-blur 0.2
