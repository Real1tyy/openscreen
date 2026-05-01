# Dead Zone Detection

Automatic detection of "dead zones" — segments where both audio is silent and the screen is static — enabling one-click removal of dead air from screencasts.

## Overview

Dead zone detection analyzes a video file on two independent axes:

1. **Audio silence** — segments where the RMS energy falls below a dB threshold
2. **Video freeze** — segments where consecutive frames are visually identical

A segment is classified as a "dead zone" only when **both conditions overlap** — audio is silent AND the screen is static. This avoids false positives from:

- Intentional pauses while demonstrating something on screen (silence only)
- Talking-head segments where the presenter is speaking over a static slide (freeze only)

Detected dead zones are returned as time intervals and mapped directly to trim regions on the timeline.

## Architecture

```
                    ┌─────────────────────────┐
                    │    detect(path, config)  │
                    └────────┬────────────────┘
                             │
                    ┌────────┴────────┐
                    │  std::thread::  │
                    │     scope       │
                    └───┬─────────┬───┘
                        │         │
            ┌───────────┤         ├───────────┐
            │  Thread A │         │  Thread B  │
            │           │         │            │
   ┌────────▼────────┐  │  ┌─────▼──────────┐
   │ detect_silence() │  │  │ detect_freeze()│
   │                  │  │  │                │
   │ 1. Decode audio  │  │  │ 1. Decode video│
   │ 2. RMS per 100ms │  │  │ 2. Gray8 160x90│
   │ 3. Auto-calibrate│  │  │ 3. EMA-smooth  │
   │ 4. Hysteresis    │  │  │    frame diff  │
   │ 5. Merge+filter  │  │  │ 4. Merge+filter│
   └────────┬─────────┘  │  └─────┬──────────┘
            │             │        │
            └──────┬──────┘────────┘
                   │
          ┌────────▼────────┐
          │   intersect()   │
          │ silence ∩ freeze│
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │  filter by min  │
          │   dead zone ms  │
          └────────┬────────┘
                   │
              Vec<DeadZone>
```

### Parallel execution

Audio and video analysis run in parallel via `std::thread::scope`. Each thread opens the file independently with its own ffmpeg decoder context. This roughly halves wall-clock time for analysis since the two passes are I/O-bound on different stream types.

## Audio Silence Detection

### Sample-accurate timing

Time tracking uses a monotonic sample counter rather than PTS timestamps from the container. This eliminates drift from variable frame sizes and non-uniform timestamps:

```
window_start_ms = (total_samples_processed / sample_rate) * 1000
```

### Processing pipeline

1. **Decode** — all audio packets decoded to raw samples
2. **Downmix** — multi-channel audio mixed to mono (average of channels)
3. **Buffer** — samples accumulated in a `VecDeque<f32>` (O(1) drain vs Vec's O(n))
4. **Window** — non-overlapping 100ms windows, RMS computed without allocation:
   ```
   RMS = sqrt(sum(sample^2) / N)
   RMS_dB = 20 * log10(RMS)
   ```
5. **Auto-calibrate** — after all windows are computed, the noise floor is estimated from the 10th percentile of all dB values. If the user's threshold would classify noise as speech, it's bumped to `noise_floor + 3dB`
6. **Hysteresis** — silence entry/exit uses separate thresholds to prevent flickering:
   ```
   enter silence:  RMS_dB < threshold
   exit silence:   RMS_dB > threshold + 2dB
   ```
7. **Merge** — contiguous silent windows merged with 50ms gap tolerance
8. **Filter** — intervals shorter than `silenceMinDurationMs` discarded

### Why hysteresis matters

Without hysteresis, a signal hovering near the threshold produces rapid on/off transitions:

```
Without:  ─────┐ ┌─┐ ┌─┐ ┌─────    (3 short intervals)
With:     ─────┐                ┌─────    (1 stable interval)
               └────────────────┘
```

The 2dB gap between enter and exit thresholds absorbs compression artifacts and room tone fluctuations.

### Auto-calibration

The noise floor varies by recording environment:

| Recording | Noise floor | User threshold | Effective |
|-----------|------------|----------------|-----------|
| Studio mic | -65 dB | -30 dB | -30 dB (unchanged) |
| Laptop mic | -40 dB | -30 dB | -30 dB (unchanged) |
| Noisy room | -25 dB | -30 dB | -22 dB (bumped up) |

Without auto-calibration, a noisy recording would classify the background hum as "silent" — never detecting dead zones. The calibration step prevents this by ensuring the threshold sits above the measured noise floor.

## Video Freeze Detection

### Adaptive analysis rate

The analysis interval is derived from the stream's frame rate:

```
interval_ms = clamp(1000 / fps * 2, 66ms, 200ms)
```

| Source FPS | Analysis interval | Effective analysis FPS |
|-----------|-------------------|----------------------|
| 30 fps | 66ms | ~15 fps |
| 60 fps | 66ms | ~15 fps |
| 15 fps | 133ms | ~7.5 fps |

This catches short freezes (~300ms) that the previous 200ms interval would miss, while avoiding redundant work on high-FPS sources.

### Processing pipeline

1. **Decode** — video frames decoded at adaptive intervals (skip intermediate frames)
2. **Scale** — downscale to 160x90 grayscale (GRAY8) via bilinear scaler. This is 1/144th the pixels of a 1080p frame
3. **Double buffer** — two pre-allocated pixel buffers swapped each frame (zero heap allocation in the loop)
4. **Frame difference** — Mean Absolute Difference (MAD) between consecutive frames:
   ```
   MAD = sum(|pixel_a - pixel_b|) / (W * H * 255)
   ```
5. **EMA smoothing** — exponential moving average (alpha=0.3) absorbs compression artifacts and sensor noise:
   ```
   smoothed = 0.3 * raw_MAD + 0.7 * prev_smoothed
   ```
6. **Classify** — `smoothed_MAD < freezeNoiseThreshold` marks the inter-frame gap as frozen
7. **Merge + filter** — same as audio

### Why EMA smoothing

Raw MAD values contain spikes from codec keyframes and compression block artifacts, even on truly static content. Without smoothing:

```
Raw MAD:      0.001  0.001  0.008  0.001  0.001
                               ↑ keyframe artifact
Verdict:      frozen frozen MOVING frozen frozen  ← breaks the interval
```

With EMA (alpha=0.3):
```
Smoothed:     0.001  0.001  0.003  0.002  0.002
Verdict:      frozen frozen frozen frozen frozen  ← stable
```

### Why 160x90

The analysis resolution is a deliberate tradeoff:

- **Too small** (e.g., 32x18): misses fine cursor movements, small UI changes
- **Too large** (e.g., 640x360): wastes CPU on pixel diffs that don't improve detection
- **160x90**: preserves enough spatial detail to catch mouse movements and typing, while reducing pixel count by 99.3% vs 1080p. The MAD computation is O(W*H), so this directly translates to performance.

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `silenceThresholdDb` | -30 | RMS dB level below which audio is "silent" |
| `silenceMinDurationMs` | 500 | Minimum silence duration to consider |
| `freezeNoiseThreshold` | 0.003 | MAD threshold below which frames are "frozen" |
| `freezeMinDurationMs` | 500 | Minimum freeze duration to consider |
| `minDeadZoneMs` | 1000 | Minimum duration for the final dead zone (after intersection) |

### Internal constants (not user-configurable)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `HYSTERESIS_DB` | 2.0 dB | Prevents threshold flickering without over-smoothing |
| `FREEZE_SMOOTHING_ALPHA` | 0.3 | Responsive to real changes while filtering codec noise |
| `AUDIO_WINDOW_MS` | 100 ms | Standard for speech activity detection |
| `ANALYSIS_W x H` | 160x90 | Best cost/accuracy tradeoff for screen content |

## Performance

### Optimizations applied

| Technique | Impact | Where |
|-----------|--------|-------|
| Parallel audio+video | ~2x wall-clock speedup | `std::thread::scope` in `detect()` |
| VecDeque audio buffer | O(1) drain vs O(n) Vec shift | `detect_silence()` |
| Zero-alloc window RMS | No temporary Vec per window | `buffer.iter().take(n)` |
| Double-buffer video pixels | Zero heap allocation in frame loop | `buf_a`/`buf_b` swap |
| Adaptive frame skip | Only analyze needed frames | `analysis_interval_ms` |
| 160x90 downscale | 99.3% fewer pixels to diff | `ANALYSIS_W x ANALYSIS_H` |

### Expected performance

For a typical 10-minute 1080p30 screencast:

| Phase | Approximate time |
|-------|-----------------|
| Audio silence detection | ~1-2s |
| Video freeze detection | ~2-4s |
| **Total (parallel)** | **~2-4s** |

Bottleneck is video decoding. Audio analysis is ~2x faster since audio packets are tiny compared to video frames.

## Tradeoffs

### Conservative intersection (silence AND freeze)

**Pro:** Near-zero false positives. Won't cut moments where:
- You're silent but demonstrating something visual
- Screen is static but you're narrating

**Con:** Misses edge cases:
- Silent with a barely-moving cursor (slight mouse drift breaks freeze detection)
- Static screen with faint background hum (hum breaks silence detection)

### Fixed vs adaptive thresholds

The auto-calibration handles the most common case (noisy recording environment) but doesn't adapt to content that changes character mid-video (e.g., starting in a quiet room, then switching to a noisy cafe). A future multi-pass approach could segment the video into chapters and calibrate each independently.

### MAD vs SSIM

MAD (Mean Absolute Difference) is simpler and faster than SSIM (Structural Similarity Index). SSIM is more perceptually accurate — it weights luminance, contrast, and structure separately — but the cost/benefit doesn't justify it for binary freeze/non-freeze classification at 160x90 resolution. At this scale, MAD with EMA smoothing performs comparably.

## Metrics

The detection result includes a `metrics` object for transparency and debugging:

```json
{
  "metrics": {
    "silenceIntervalsFound": 5,
    "freezeIntervalsFound": 8,
    "effectiveSilenceThresholdDb": -28.0,
    "audioNoiseFloorDb": -52.0,
    "analysisDurationMs": 3200.0
  }
}
```

`effectiveSilenceThresholdDb` may differ from the user's configured threshold if auto-calibration adjusted it. Compare with `audioNoiseFloorDb` to understand why.

## Future improvements

- **Confidence scoring** — return a score per dead zone instead of binary classification, letting the UI rank by confidence
- **Lookahead buffering** — buffer 1-2s of windows before classifying, enabling forward-looking heuristics
- **Multi-pass refinement** — rough detection pass, then refine edges with finer analysis
- **SSIM upgrade** — for sources with high compression artifacts where MAD struggles
- **GPU-accelerated frame diff** — for 4K sources where CPU pixel diff becomes the bottleneck
- **Waveform pre-analysis** — detect speech segments via VAD (Voice Activity Detection) for more accurate silence classification than raw RMS
