# Export Quality Settings

## Quality Levels

| UI Label   | Resolution                | Bitrate   |
|------------|---------------------------|-----------|
| **Low**    | 720p (e.g. 1280x720)     | 10 Mbps   |
| **Medium** | 1080p (e.g. 1920x1080)   | 20 Mbps   |
| **High**   | Source resolution         | 30-80 Mbps |

All quality levels encode at 60 FPS using H.264 with variable bitrate and hardware acceleration when available.

## High Quality Bitrate Tiers

The High setting uses the original source dimensions and selects a bitrate based on pixel count:

- Source up to 1080p: 30 Mbps
- Source up to 1440p: 50 Mbps
- Source above 1440p (4K): 80 Mbps

## High vs Medium

When the source is 1080p (which is the typical case), both High and Medium export at the same 1080p resolution. The only difference is bitrate: 30 Mbps (High) vs 20 Mbps (Medium).

Higher bitrate means less compression artifacts — sharper edges, fewer blocky areas in fast motion or gradients, and better detail retention in complex scenes.

For screen recordings, the difference is often negligible since screen content is relatively simple (solid colors, text, UI elements). The difference becomes more noticeable during fast scrolling, transitions, or when camera footage / video is playing on screen.

## Approximate File Sizes (per minute)

| Quality    | Resolution | File Size  |
|------------|------------|------------|
| Low        | 720p       | ~75 MB/min  |
| Medium     | 1080p      | ~150 MB/min |
| High       | 1080p src  | ~225 MB/min |
| High       | 4K src     | ~600 MB/min |

## GIF Export

Quality settings only apply to MP4 exports. GIF exports use separate size presets:

- Medium: 720p max
- Large: 1080p max
- Original: source size

## CLI Export

Headless export via the CLI supports manual overrides:

- `--resolution`: presets (720p, 1080p, 1440p, 4k) or custom (e.g. 1280x720)
- `--bitrate`: override in bps
- `--fps`: default 60
