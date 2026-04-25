# NVENC Hardware Export via FFmpeg — Implementation Plan

## Problem

The video export pipeline is single-threaded and CPU-bound. WebKitGTK's WebCodecs `VideoEncoder` uses OpenH264 (software) on Linux — it cannot access NVIDIA NVENC. Result: one CPU core at 72%, GPU at 10% (idle), exporting at ~30-50 fps when the RTX 4060's NVENC can do 500+ fps.

## Solution

Route video encoding through FFmpeg in Rust with `h264_nvenc`, bypassing WebCodecs entirely. The PixiJS rendering stays in the browser (GPU WebGL), but encoded frame data flows through Tauri IPC to the Rust backend where FFmpeg encodes with NVENC and muxes the MP4.

## Architecture

### Current Pipeline (single-threaded, CPU-bound)
```
Browser (single thread):
  StreamingDecoder → VideoFrame
    → FrameRenderer (GPU, <1ms) → compositeCanvas
      → VideoFrame(canvas) → WebCodecs VideoEncoder (CPU, 20-30ms) ← BOTTLENECK
        → mediabunny muxer (JS) → in-memory MP4 blob
          → AudioProcessor (after video, sequential)
            → save dialog → write to disk
```

### New Pipeline (parallel, GPU-encoded)
```
Browser thread:
  StreamingDecoder → VideoFrame
    → FrameRenderer (GPU, <1ms) → compositeCanvas
      → canvas.getImageData() → Uint8Array RGBA
        → Tauri invoke (binary via temp file) → Rust

Rust thread (parallel, async):
  receive RGBA frame → ffmpeg AVFrame
    → h264_nvenc encoder (GPU, <0.5ms) ← NVENC HARDWARE
      → MP4 muxer (libavformat) → streaming write to disk
        → progress events back to frontend

Audio (parallel with video finalization):
  StreamingDecoder → AudioProcessor → FFmpeg audio encode → mux into same MP4
```

### Key Design Decisions

1. **Frame transfer**: Canvas → `getImageData()` → write to shared memory or temp file → Rust reads. The `getImageData()` is ~5ms for 1080p but unavoidable since the GPU texture can't cross the IPC boundary directly. This is still 4-6x faster than the current pipeline because NVENC encoding is <0.5ms vs 20-30ms for software.

2. **Streaming mux**: FFmpeg writes the MP4 progressively to disk (not in-memory). No 500MB RAM spike for long videos.

3. **Fallback**: If NVENC is unavailable (no NVIDIA GPU), fall back to `libx264` (software but faster than OpenH264) or the existing WebCodecs path.

4. **Audio**: FFmpeg muxes audio from the source file directly (demux → re-encode if needed → mux), handling trim/speed regions in Rust.

## Prerequisites

```bash
sudo apt-get install -y libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libavfilter-dev pkg-config clang
```

## Implementation Steps

### Step 1: Add FFmpeg Rust dependencies

```toml
# src-tauri/Cargo.toml
[dependencies]
ffmpeg-the-third = "2"
```

### Step 2: Create `src-tauri/src/commands/export.rs`

**Rust module with these commands:**

#### `start_nvenc_export`
```rust
#[tauri::command]
async fn start_nvenc_export(
    config: NvencExportConfig,
    app: AppHandle,
) -> Result<String, String>
```

- Receives: output path, width, height, fps, bitrate, codec preference
- Creates FFmpeg encoder context with `h264_nvenc` (fallback: `libx264`)
- Creates MP4 muxer writing to output path
- Returns an export session ID
- Stores encoder state in `AppState`

#### `feed_frame`
```rust
#[tauri::command]
async fn feed_frame(
    session_id: String,
    frame_path: String,  // temp file with RGBA pixels
    timestamp_us: i64,
    is_keyframe: bool,
    state: State<Mutex<AppState>>,
) -> Result<FrameResult, String>
```

- Reads RGBA pixel data from temp file
- Converts to YUV420 via `swscale`
- Feeds to NVENC encoder
- Returns encode status + queue depth

#### `finish_export`
```rust
#[tauri::command]
async fn finish_export(
    session_id: String,
    source_video_path: Option<String>,  // for audio track
    trim_regions: Option<Vec<TrimRegion>>,
    speed_regions: Option<Vec<SpeedRegion>>,
    state: State<Mutex<AppState>>,
) -> Result<ExportResult, String>
```

- Flushes encoder
- If source_video_path provided: demux audio, apply trim/speed, mux into output
- Writes MP4 trailer
- Returns final file path + size

#### `cancel_export`
```rust
#[tauri::command]
fn cancel_export(session_id: String, state: State<Mutex<AppState>>)
```

### Step 3: FFmpeg encoder wrapper (`src-tauri/src/encoder.rs`)

```rust
pub struct NvencEncoder {
    encoder: ffmpeg::codec::encoder::Video,
    muxer: ffmpeg::format::context::Output,
    scaler: ffmpeg::software::scaling::Context,  // RGBA → YUV420
    frame_count: u64,
    stream_index: usize,
    time_base: ffmpeg::Rational,
}

impl NvencEncoder {
    pub fn new(config: &NvencExportConfig, output_path: &str) -> Result<Self, String> {
        // Try h264_nvenc first, fall back to libx264
        let codec = ffmpeg::encoder::find_by_name("h264_nvenc")
            .or_else(|| ffmpeg::encoder::find_by_name("libx264"))
            .ok_or("No H.264 encoder found")?;

        // Configure encoder
        // - preset: p4 (balanced quality/speed for NVENC)
        // - profile: high
        // - level: 5.1
        // - rc: vbr (variable bitrate)
        // - b:v: user-specified bitrate
        // ...
    }

    pub fn encode_frame(&mut self, rgba_data: &[u8], pts: i64, keyframe: bool) -> Result<(), String> {
        // 1. Create AVFrame from RGBA data
        // 2. Convert RGBA → YUV420P via swscale
        // 3. Set pts, keyframe flag
        // 4. Send to encoder
        // 5. Receive encoded packets, write to muxer
    }

    pub fn flush(&mut self) -> Result<(), String> {
        // Flush encoder, write remaining packets
    }

    pub fn add_audio_from_source(
        &mut self,
        source_path: &str,
        trim_regions: &[TrimRegion],
        speed_regions: &[SpeedRegion],
    ) -> Result<(), String> {
        // Demux audio from source
        // Apply trim/speed adjustments to timestamps
        // Re-encode if format incompatible, or copy if AAC/Opus
        // Mux into output
    }

    pub fn finalize(self) -> Result<PathBuf, String> {
        // Write trailer, close file
    }
}
```

### Step 4: Update TypeScript bridge

Add to `tauriBridge.ts`:
```typescript
startNvencExport: (config) => invoke("start_nvenc_export", { config }),
feedFrame: (sessionId, framePath, timestampUs, isKeyframe) =>
    invoke("feed_frame", { sessionId, framePath, timestampUs, isKeyframe }),
finishExport: (sessionId, sourceVideoPath, trimRegions, speedRegions) =>
    invoke("finish_export", { sessionId, sourceVideoPath, trimRegions, speedRegions }),
cancelExport: (sessionId) => invoke("cancel_export", { sessionId }),
```

### Step 5: Create `NvencVideoExporter` class

New file: `src/lib/exporter/nvencExporter.ts`

This class has the **same interface** as `VideoExporter` but routes encoding through Rust:

```typescript
export class NvencVideoExporter {
    async export(): Promise<ExportResult> {
        // 1. Initialize decoder (same as VideoExporter)
        // 2. Initialize FrameRenderer (same)
        // 3. Start NVENC export session via Tauri command
        // 4. For each decoded frame:
        //    a. Render via PixiJS (same)
        //    b. Get canvas pixels via getImageData()
        //    c. Write RGBA to temp file
        //    d. Call feed_frame Tauri command
        //    e. Report progress
        // 5. Call finish_export with audio source
        // 6. Return file path (not blob — file is already on disk)
    }
}
```

### Step 6: Integrate into export UI

In `useExport.ts`, detect NVENC availability and use the appropriate exporter:

```typescript
const useNvenc = isTauri(); // Use NVENC path when running in Tauri

if (useNvenc) {
    const exporter = new NvencVideoExporter(config);
    const result = await exporter.export();
    // result.path is the output file path (already on disk)
} else {
    // Existing WebCodecs path for Electron
    const exporter = new VideoExporter(config);
    const result = await exporter.export();
}
```

## Frame Transfer Optimization

The main overhead is transferring RGBA pixel data from the browser to Rust. For 1080p:
- Frame size: 1920 × 1080 × 4 = 8.3 MB per frame
- At 60fps: 498 MB/s throughput needed

Options (in order of preference):

1. **Shared memory** (`SharedArrayBuffer` → Rust reads same memory): Zero-copy, but requires `Cross-Origin-Isolation` headers which Tauri may not support easily.

2. **Temp file per frame**: Write RGBA to `/tmp/`, pass path to Rust. At SSD speeds (~3 GB/s), the 8.3 MB write takes ~3ms. Combined with NVENC encoding (<0.5ms), total per-frame time is ~8ms = **125 fps** throughput. This is 3-4x faster than current software encoding.

3. **Batched temp file**: Write N frames to a single file, pass offset+length. Reduces syscall overhead.

**Recommendation**: Start with option 2 (temp files). It's simple, testable, and already 3-4x faster. Optimize to shared memory later if needed.

## Expected Performance

| Metric | Current (WebCodecs SW) | NVENC via FFmpeg | Speedup |
|--------|----------------------|------------------|---------|
| Encode time per 1080p frame | 20-30ms | <0.5ms (GPU) | 40-60x |
| Frame transfer overhead | ~0ms (in-process) | ~8ms (temp file + IPC) | N/A |
| Total per-frame time | 25-35ms | ~10ms | 2.5-3.5x |
| Effective FPS | 30-40 | 100-125 | 3-4x |
| 5-min 1080p@60fps export | ~8-10 min | ~2.5-3 min | 3-4x |
| GPU utilization | 10% | 40-60% | ✓ |
| CPU utilization | 72% (1 core) | <20% | ✓ |

Note: The bottleneck shifts from encoding (GPU is instant) to frame rendering + transfer. Further optimization via shared memory could push this to 5-8x.

## Testing Strategy

### Unit Tests (Rust)

1. **Encoder initialization**: Test NVENC detection, fallback to libx264
2. **RGBA→YUV conversion**: Verify color accuracy with known test patterns
3. **Frame encoding**: Encode a single solid-color frame, verify output is valid H.264
4. **Multi-frame sequence**: Encode 10 frames, verify pts ordering and keyframe placement
5. **Bitrate adherence**: Encode 100 frames, verify output size is within 20% of target
6. **Audio muxing**: Mux a test audio track, verify playback
7. **Trim/speed regions**: Verify audio timestamps after trim/speed adjustments
8. **Error handling**: Invalid dimensions, missing codec, file write failure
9. **Cancellation**: Start export, cancel mid-stream, verify cleanup (no leaked files)

### Integration Tests (Browser)

1. **End-to-end export**: Export sample.webm via NVENC path, verify valid MP4 output
2. **Fallback test**: Mock NVENC unavailable, verify falls back to WebCodecs
3. **Progress reporting**: Verify progress events fire at correct percentages
4. **Cancel during export**: Start export, cancel, verify no crash
5. **Large frame count**: Export 1000+ frames, verify no memory leak

### Manual Verification

1. **A/B comparison**: Export same video via WebCodecs and NVENC, compare visual quality
2. **Performance timing**: Measure wall clock time for both paths on same video
3. **GPU monitoring**: Verify `nvidia-smi` shows NVENC utilization during export

## Rollback Strategy

The NVENC path is **additive** — it doesn't modify the existing WebCodecs export code. The `useExport.ts` hook selects the path at runtime based on `isTauri()`. If NVENC fails, the existing WebCodecs path continues to work as a fallback.

```typescript
try {
    // Try NVENC path
    result = await nvencExporter.export();
} catch (e) {
    console.warn("NVENC export failed, falling back to WebCodecs:", e);
    // Fallback to existing path
    result = await webcodecExporter.export();
}
```

## Files Changed

| File | Change | Risk |
|------|--------|------|
| `src-tauri/Cargo.toml` | Add `ffmpeg-the-third` dependency | Low |
| `src-tauri/src/encoder.rs` | **New** — FFmpeg/NVENC wrapper | Medium (new code) |
| `src-tauri/src/commands/export.rs` | **New** — Tauri export commands | Medium |
| `src-tauri/src/commands/mod.rs` | Add `export` module | Low |
| `src-tauri/src/main.rs` | Register export commands | Low |
| `src/lib/exporter/nvencExporter.ts` | **New** — NVENC exporter class | Medium |
| `src/lib/tauriBridge.ts` | Add export commands to bridge | Low |
| `src/components/video-editor/hooks/useExport.ts` | Route to NVENC when available | Low (additive) |

**Zero changes to existing export code** — WebCodecs path remains untouched.

## Dependencies

### System (must be installed)
```bash
sudo apt-get install -y libavcodec-dev libavformat-dev libavutil-dev libswscale-dev pkg-config clang
```

### Rust crate
```toml
ffmpeg-the-third = "2"
```

This crate links against system FFmpeg libraries. It supports FFmpeg 5.x-7.x.
