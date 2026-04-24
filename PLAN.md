# OpenScreen: Electron → Tauri Migration Plan

## Goal

Replace Electron with Tauri v2. Keep the React + PixiJS frontend unchanged. Move performance-critical video operations to Rust. Drop ~200MB RAM overhead, ~130MB binary size, and get faster GIF export via gifski.

## Current State

- **Electron backend**: 2,256 LOC across 7 files (`electron/`)
- **IPC channels**: 35+ handlers (file I/O, recording sessions, screen capture, dialogs, tray, menus, CLI)
- **Preload bridge**: 50+ methods exposed as `window.electronAPI`
- **Window types**: 3 (HUD overlay, Editor, Source Selector)
- **WebCodecs**: Used in renderer for video decode/encode — stays in browser, no migration needed
- **React frontend**: ~23K LOC — unchanged

## Architecture

```
┌───────────────────────────────────────────┐
│  React + PixiJS + Radix UI (unchanged)    │
│  Runs in Tauri webview                    │
├───────────────────────────────────────────┤
│  window.__TAURI__ invoke bridge           │
│  (replaces window.electronAPI)            │
├───────────────────────────────────────────┤
│  Rust backend (src-tauri/)                │
│  ├── commands/         Tauri commands     │
│  │   ├── file_io.rs    File read/write    │
│  │   ├── recording.rs  Session mgmt       │
│  │   ├── capture.rs    Screen sources     │
│  │   ├── platform.rs   OS info/perms      │
│  │   ├── export.rs     gifski + ffmpeg    │
│  │   └── cli.rs        CLI args           │
│  ├── menu.rs           App menu + tray    │
│  ├── windows.rs        Multi-window mgmt  │
│  └── state.rs          AppState (Mutex)   │
└───────────────────────────────────────────┘
```

## Phases

---

### Phase 0: Setup (2-3 hours)

**Goal**: Tauri project scaffolding alongside existing code.

- [ ] `cargo install create-tauri-app` and init `src-tauri/` in repo root
- [ ] Configure `tauri.conf.json`:
  - 3 windows (main editor, HUD overlay, source selector)
  - File associations (`.openscreen`, `.mp4`, `.webm`)
  - Permissions: `fs`, `dialog`, `shell`, `tray`, `window`, `path`
- [ ] Add Rust dependencies to `src-tauri/Cargo.toml`:
  ```toml
  [dependencies]
  tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
  serde = { version = "1", features = ["derive"] }
  serde_json = "1"
  uuid = { version = "1", features = ["v4"] }
  dirs = "6"
  gifski = "1"           # Phase 3
  # ffmpeg-the-third = "3"  # Phase 3 (optional, for HW encode)
  ```
- [ ] Update `vite.config.ts` to use `@tauri-apps/vite-plugin` instead of `vite-plugin-electron`
- [ ] Verify `npm run dev` launches Tauri webview with existing React app rendering

---

### Phase 1: Bridge Layer — Replace `window.electronAPI` (6-8 hours)

**Goal**: Every IPC call routes through Tauri commands instead of Electron IPC.

#### 1a. Create TypeScript bridge adapter

Create `src/lib/tauriBridge.ts` that implements the same interface as the Electron preload but calls `@tauri-apps/api/core.invoke()` under the hood. The React code imports from this bridge instead of using `window.electronAPI`.

```typescript
// src/lib/tauriBridge.ts
import { invoke } from "@tauri-apps/api/core";

export const api = {
  getPlatform: () => invoke<string>("get_platform"),
  readBinaryFile: (path: string) => invoke<number[]>("read_binary_file", { path }),
  saveExportedVideo: (data: number[], name: string) =>
    invoke("save_exported_video", { data, name }),
  // ... all 50+ methods
};
```

#### 1b. Search-and-replace `window.electronAPI` calls

Every file that calls `window.electronAPI.foo()` switches to `import { api } from "@/lib/tauriBridge"` and calls `api.foo()`. These files:

| File | Methods to migrate |
|------|-------------------|
| `useScreenRecorder.ts` | `setRecordingState`, `storeRecordedSession`, `setCurrentRecordingSession`, `switchToEditor`, `getSelectedSource`, `onStopRecordingFromTray` |
| `VideoEditor.tsx` | 15+ methods (project save/load, CLI config, cursor telemetry, export, file reveal) |
| `SourceSelector.tsx` | `getSources`, `selectSource` |
| `HeadlessExport.tsx` | `getHeadlessExportConfig`, `sendHeadlessExportProgress`, `sendHeadlessExportDone` |
| `platformUtils.ts` | `getPlatform` |
| `I18nContext.tsx` | `setLocale` |
| `ShortcutsContext.tsx` | `getShortcuts`, `saveShortcuts` |
| `requestCameraAccess.ts` | `requestCameraAccess` |
| `assetPath.ts` | `getAssetBasePath` |

#### 1c. Implement Rust Tauri commands

Port each Electron IPC handler to a `#[tauri::command]` function in Rust. The logic is straightforward — these are mostly file read/write and state management:

**File I/O commands** (~200 LOC Rust):
- `read_binary_file` — read with path allowlist validation
- `save_exported_video` — dialog + write
- `open_video_file_picker` — `tauri::dialog::FileDialogBuilder`
- `save_project_file` / `load_project_file` — JSON serialize/deserialize
- `write_text_file` — chapters export
- `reveal_in_folder` — `opener::reveal()` or platform-specific

**Session state commands** (~150 LOC Rust):
- `store_recorded_session` — write video blobs + session.json + cursor.json
- `get/set_current_recording_session` — in-memory `Mutex<AppState>`
- `get/set_current_video_path` — state management
- `get_cursor_telemetry` — read + parse cursor.json

**Platform commands** (~50 LOC Rust):
- `get_platform` — `std::env::consts::OS`
- `request_camera_access` — macOS: `objc` crate for AVCaptureDevice
- `get_asset_base_path` — `tauri::path::PathResolver`
- `get/save_shortcuts` — read/write JSON from app data dir

---

### Phase 2: Windows, Menu, Tray, CLI (4-6 hours)

**Goal**: Multi-window management, native menu, system tray, CLI support.

#### 2a. Multi-window management

Tauri v2 supports multi-window. Configure in `tauri.conf.json` and create via Rust:

```rust
// HUD overlay: transparent, frameless, always-on-top
let hud = tauri::WebviewWindowBuilder::new(&app, "hud", tauri::WebviewUrl::App("/hud".into()))
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .inner_size(600.0, 160.0)
    .build()?;

// Editor: standard window, maximized
let editor = tauri::WebviewWindowBuilder::new(&app, "editor", tauri::WebviewUrl::App("/editor".into()))
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .maximized(true)
    .build()?;

// Source selector: transparent, frameless, centered
let selector = tauri::WebviewWindowBuilder::new(&app, "source-selector", tauri::WebviewUrl::App("/source-selector".into()))
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .inner_size(620.0, 420.0)
    .center()
    .build()?;
```

React `App.tsx` already routes on query params (`?windowType=...`). Change to path-based routing for Tauri.

#### 2b. System tray

```rust
let tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .on_menu_event(|app, event| { /* handle stop-recording, open, quit */ })
    .build(app)?;
```

Dynamic menu updates on recording state change — same pattern as Electron.

#### 2c. Application menu

Tauri v2 `Menu` API for File (Open/Save/Save As), Edit, View, Window. Wire keyboard accelerators.

#### 2d. CLI arguments

Tauri supports CLI config in `tauri.conf.json`:
```json
{
  "cli": {
    "args": [
      { "name": "input-file", "index": 1, "takesValue": true },
      { "name": "export", "short": "e", "takesValue": false },
      { "name": "output", "short": "o", "takesValue": true },
      { "name": "fps", "takesValue": true },
      { "name": "resolution", "takesValue": true }
    ]
  }
}
```

Parse in Rust `setup()`, store in state, expose via `get_cli_input_file` / `get_headless_export_config` commands.

---

### Phase 3: Screen Capture + Rust Video Backend (4-6 hours)

**Goal**: Replace `desktopCapturer` and optionally route encoding through FFmpeg.

#### 3a. Screen capture sources

Electron's `desktopCapturer.getSources()` returns screen/window thumbnails. Replace with:

- **macOS**: `screencapturekit` crate (SCShareableContent API)
- **Windows**: `windows` crate (DXGI Desktop Duplication or `PrintWindow`)
- **Linux**: PipeWire or XDG Desktop Portal (`ashpd` crate)

This is the **hardest single piece** of the migration. The `get_sources` command needs to return window titles, app names, and thumbnail images. Platform-specific code, ~300-500 LOC per platform.

Alternative: use `tauri-plugin-screen-capture` if available, or keep using `navigator.mediaDevices.getDisplayMedia()` (WebRTC screen sharing prompt — simpler but less control).

#### 3b. Cursor telemetry

Currently uses Electron's `screen.getCursorScreenPoint()` polled at 10Hz during recording. Replace with:

- **macOS**: `CGEvent::mouseLocation()` via `core-graphics` crate
- **Windows**: `GetCursorPos` via `windows` crate
- **Linux**: X11 `XQueryPointer` or libinput

~50 LOC per platform, spawned in a background thread.

#### 3c. GIF export via gifski (optional but easy win)

Add a `export_gif` Tauri command that takes decoded frames and encodes via gifski in Rust. This replaces the slow gif.js pipeline entirely.

```rust
#[tauri::command]
async fn export_gif(frames: Vec<Vec<u8>>, width: u32, height: u32, fps: u8) -> Result<Vec<u8>, String> {
    let (collector, writer) = gifski::new(gifski::Settings {
        width: Some(width),
        height: Some(height),
        quality: 90,
        fast: false,
        ..Default::default()
    })?;
    // feed frames to collector, get GIF bytes from writer
}
```

#### 3d. FFmpeg backend (optional, for Linux WebCodecs gap)

If WebCodecs aren't available in the webview (Linux WebKitGTK), route encode/decode through FFmpeg:

```rust
#[tauri::command]
async fn encode_video(config: ExportConfig) -> Result<String, String> {
    // Use ffmpeg-the-third for HW-accelerated H.264 encoding
    // Read decoded frames from temp dir or shared memory
    // Write MP4 to output path
}
```

This is optional — WebCodecs work in WebView2 (Windows) and WKWebView (macOS). Only needed if targeting Linux without Chromium.

---

### Phase 4: Cleanup & Testing (3-4 hours)

- [ ] Remove all Electron dependencies from `package.json`:
  - `electron`, `electron-builder`, `vite-plugin-electron`, `vite-plugin-electron-renderer`, `electron-rebuild`, `electron-icon-builder`
- [ ] Delete `electron/` directory entirely
- [ ] Remove Electron-specific type declarations (`electron-env.d.ts`)
- [ ] Update build scripts in `package.json`:
  ```json
  {
    "dev": "tauri dev",
    "build": "tauri build",
    "build:mac": "tauri build --target universal-apple-darwin",
    "build:win": "tauri build --target x86_64-pc-windows-msvc",
    "build:linux": "tauri build --bundles appimage"
  }
  ```
- [ ] Update CI workflows (`.github/workflows/ci.yml`, `build.yml`)
- [ ] Update `electron-builder.json5` → `tauri.conf.json` for icons, file associations, signing
- [ ] Run existing test suites (vitest, playwright) — update E2E tests for Tauri
- [ ] Test on all 3 platforms

---

## Effort Estimate

| Phase | Hours | Risk |
|-------|-------|------|
| Phase 0: Setup | 2-3h | Low — scaffolding |
| Phase 1: Bridge + IPC | 6-8h | Low — 1:1 port of known handlers |
| Phase 2: Windows/Menu/Tray/CLI | 4-6h | Medium — Tauri v2 multi-window API nuances |
| Phase 3: Screen capture + Rust backend | 4-6h | High — platform-specific capture code |
| Phase 4: Cleanup + testing | 3-4h | Low — deletion + config |
| **Total** | **19-27h** | |

Weekend timeline: Phase 0-1 Saturday, Phase 2-4 Sunday. Screen capture (3a) is the wildcard — if `getDisplayMedia()` is acceptable, it drops to ~2 hours.

## Key Risks

1. **Screen capture API**: `desktopCapturer` is Electron-only. Tauri doesn't have an equivalent. Options:
   - Use `getDisplayMedia()` (browser prompt, less control but works everywhere)
   - Use platform-native crates (most control, most code)
   - Use a Tauri plugin if one exists

2. **Linux WebKitGTK**: WebCodecs support is inconsistent. Mitigation: FFmpeg Rust backend for encode/decode on Linux.

3. **Transparent windows**: HUD overlay needs `transparent: true` + `decorations: false`. Tauri supports this but behavior varies by compositor (Wayland vs X11).

4. **macOS traffic lights**: Electron's `titleBarStyle: hiddenInset` with custom traffic light position needs Tauri's `decorations: false` + manual NSWindow config via `cocoa` crate.

5. **Large binary transfers**: Recording saves send ArrayBuffer (video blobs, up to hundreds of MB) over IPC. Tauri's invoke serializes as JSON — need to use `tauri::ipc::Channel` or write to temp file instead.

## What Stays Unchanged

- All React components (23K LOC)
- PixiJS rendering pipeline
- WebCodecs encode/decode (runs in webview)
- Timeline editor, annotations, zoom/pan logic
- Tailwind CSS, Radix UI components
- i18n locale files
- All business logic in `src/lib/`

## What Gets Deleted

- `electron/` directory (2,256 LOC)
- `electron-builder.json5`
- `vite-plugin-electron` config in `vite.config.ts`
- Electron-related devDependencies (6 packages)

## What Gets Added

- `src-tauri/` directory (~1,500-2,000 LOC Rust)
- `src/lib/tauriBridge.ts` (~200 LOC TypeScript)
- `tauri.conf.json`
- Rust dependencies (tauri, serde, uuid, dirs, gifski)

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep React frontend | No Rust GUI framework matches Radix + dnd-timeline widget richness |
| Tauri v2 not v1 | v2 has stable multi-window, tray, menu, CLI APIs |
| gifski for GIF | Best-in-class quality, 5-10x faster than gif.js |
| FFmpeg optional | WebCodecs work in most webviews; FFmpeg only needed as Linux fallback |
| Bridge adapter pattern | Single file to change if switching IPC mechanism; React code stays clean |
| `getDisplayMedia` fallback | Avoids platform-specific capture code; acceptable UX for v1 |
