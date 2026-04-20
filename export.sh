#!/bin/bash
# OpenScreen headless export template
# Usage: ./export.sh /path/to/recording.mp4
# Output: /path/to/recording-openscreen.mp4

set -e

OPENSCREEN="$(dirname "$0")/release/1.3.0/Openscreen-Linux-1.3.0.AppImage"
INPUT="$1"

if [ -z "$INPUT" ]; then
  echo "Usage: ./export.sh /path/to/recording.mp4"
  exit 1
fi

OUTPUT="${INPUT%.mp4}-openscreen.mp4"

"$OPENSCREEN" --no-sandbox --export "$INPUT" \
  --shadow-intensity 0.3 \
  --roundness 13.5 \
  --padding 7 \
  --motion-blur 20 \
  -o "$OUTPUT"
