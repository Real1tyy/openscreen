# Frontend E2E Test Specification

Playwright tests running against the Vite dev server (`http://localhost:5173`), driving real React code in Chromium with a mocked Tauri bridge layer.

## Architecture

```
Playwright (Chromium) --> Vite dev server (:5173) --> React app
                                                       |
                                                       v
                                              Mock Tauri bridge
                                         (injected via page.addInitScript)
```

The app uses `?windowType=<type>` to determine which component renders:

| `windowType` | Component | Route |
|---|---|---|
| `editor` | VideoEditor | `/?windowType=editor` |
| `hud-overlay` | LaunchWindow | `/?windowType=hud-overlay` |
| `source-selector` | SourceSelector | `/?windowType=source-selector` |
| `headless-export` | HeadlessExport | `/?windowType=headless-export` |

## Mock Strategy

### Tauri Bridge

`src/lib/tauriBridge.ts` checks `isTauri()` via `"__TAURI_INTERNALS__" in window`. When false, it falls back to `window.electronAPI`. For tests, inject a mock `electronAPI` object before the app loads.

Create a helper module at `tests/e2e/helpers/mock-api.ts` that exports a `createMockAPI()` function returning a full `ElectronAPI` implementation with sensible defaults. All methods return resolved promises with success responses. Override individual methods per-test as needed.

Key mock defaults:

```typescript
getPlatform: () => Promise.resolve("linux"),
getRecordedVideoPath: () => Promise.resolve({ success: false, path: null }),
getCurrentVideoPath: () => Promise.resolve({ success: false, path: null }),
getCurrentRecordingSession: () => Promise.resolve({ success: false, session: null }),
getSelectedSource: () => Promise.resolve(null),
getShortcuts: () => Promise.resolve(null),
getCliInputFile: () => Promise.resolve(null),
getCliEditorConfig: () => Promise.resolve(null),
getHeadlessExportConfig: () => Promise.resolve(null),
switchToEditor: () => Promise.resolve(),
switchToHud: () => Promise.resolve(),
startNewRecording: () => Promise.resolve(),
openSourceSelector: () => Promise.resolve(),
selectSource: (s) => Promise.resolve(s),
hudOverlayHide: () => {},
hudOverlayClose: () => {},
setCurrentVideoPath: () => Promise.resolve({ success: true }),
clearCurrentVideoPath: () => Promise.resolve({ success: true }),
setRecordingState: () => Promise.resolve(),
setHasUnsavedChanges: () => Promise.resolve(),
setLocale: () => Promise.resolve(),
requestCameraAccess: () => Promise.resolve({ success: true, granted: true }),
getSources: () => Promise.resolve([]),
saveExportedVideo: (data, name) => Promise.resolve({ success: true, path: `/tmp/${name}` }),
openVideoFilePicker: () => Promise.resolve({ success: false, canceled: true }),
saveProjectFile: (data, name) => Promise.resolve({ success: true, path: `/tmp/${name}` }),
loadProjectFile: () => Promise.resolve({ success: false, canceled: true }),
loadCurrentProjectFile: () => Promise.resolve({ success: false }),
readBinaryFile: () => Promise.resolve({ success: false }),
getAssetBasePath: () => Promise.resolve(null),
getCursorTelemetry: () => Promise.resolve({ success: true, samples: [] }),
revealInFolder: () => Promise.resolve({ success: true }),
writeTextFile: () => Promise.resolve({ success: true }),
storeRecordedVideo: () => Promise.resolve({ success: true }),
storeRecordedSession: () => Promise.resolve({ success: true }),
setCurrentRecordingSession: () => Promise.resolve({ success: true }),
onStopRecordingFromTray: () => () => {},
onMenuLoadProject: () => () => {},
onMenuSaveProject: () => () => {},
onMenuSaveProjectAs: () => () => {},
onRequestSaveBeforeClose: () => () => {},
openExternalUrl: () => Promise.resolve({ success: true }),
saveShortcuts: () => Promise.resolve({ success: true }),
setMicrophoneExpanded: () => {},
sendHeadlessExportProgress: () => {},
sendHeadlessExportDone: () => Promise.resolve(),
```

Inject before each test via `page.addInitScript()`. Do NOT set `__TAURI_INTERNALS__` -- the app must see `isTauri() === false` and use the `window.electronAPI` fallback.

### Test Video Fixture

Place a tiny valid `.webm` file at `tests/fixtures/sample.webm` (~100KB, 1-2 seconds, 320x240). For tests that need a loaded video, either:
- Serve the fixture via Vite's `public/` directory and point mock to it
- Create a blob URL in the page context via `page.addInitScript`

## Playwright Config

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "npm run dev:frontend",
    port: 5173,
    reuseExistingServer: true,
  },
});
```

## Existing Test IDs

These `data-testid` attributes already exist in the codebase:

| Test ID | Component | Element |
|---|---|---|
| `testId-export-button` | SettingsPanel | Export button |
| `testId-gif-format-button` | SettingsPanel | GIF format selector |
| `testId-gif-size-button-medium` | SettingsPanel | GIF size preset |
| `testId-gif-size-button-large` | SettingsPanel | GIF size preset |
| `testId-gif-size-button-original` | SettingsPanel | GIF size preset |

Test ID utility: `src/utils/getTestId.ts` -- pattern: `testId-${name}`.

---

## Test Suites

### Suite 1: Editor Video Loading

**File:** `tests/e2e/editor-load.spec.ts`

**Purpose:** Verify the editor window loads video and renders the UI correctly.

#### Test 1.1: Editor renders with no video

```
1. Navigate to /?windowType=editor
2. Mock API returns no current video/session
3. Assert: "Loading video..." eventually hidden or fallback UI shown
4. Assert: Timeline visible but empty
5. Assert: Settings panel visible
6. Assert: Top bar buttons (New Recording, Load Project, Save Project) visible
```

#### Test 1.2: Editor loads video from current session

```
1. Mock getCurrentRecordingSession -> { success: true, session: { screenVideoPath: "..." } }
2. Mock readBinaryFile -> success with fixture video data
3. Navigate to /?windowType=editor
4. Wait for "Loading video..." to disappear (15s timeout)
5. Assert: <video> element exists and has src
6. Assert: Timeline shows video duration
7. Assert: Playback controls visible (play/pause, time display)
```

#### Test 1.3: Editor loads video via file picker

```
1. Navigate to /?windowType=editor (no current video)
2. Mock openVideoFilePicker -> { success: true, path: "/fixtures/sample.webm" }
3. Mock setCurrentVideoPath -> { success: true }
4. Trigger file open (either via button click or mock the initial load)
5. Assert: Video loads and plays
```

### Suite 2: Playback Controls

**File:** `tests/e2e/playback.spec.ts`

**Prerequisites:** Video loaded in editor (use beforeEach with mock session).

#### Test 2.1: Play/pause toggle

```
1. Assert: Video paused initially
2. Click play button (or press Space)
3. Assert: Play button becomes pause icon
4. Assert: Current time advances (wait ~500ms, check time > 0)
5. Click pause (or press Space)
6. Assert: Video paused, time stops advancing
```

#### Test 2.2: Timeline scrubbing

```
1. Locate the timeline scrubber/progress bar
2. Click at 50% position
3. Assert: Current time ~ 50% of duration
4. Click at 0% position
5. Assert: Current time ~ 0
```

#### Test 2.3: Preview speed selector

```
1. Locate speed dropdown
2. Select "2x"
3. Play video for 1 real second
4. Assert: Video time advanced ~ 2 seconds
5. Select "0.5x"
6. Play for 1 second
7. Assert: Video time advanced ~ 0.5 seconds
```

#### Test 2.4: Frame stepping with arrow keys

```
1. Focus the video area
2. Press Right arrow
3. Assert: Current time advanced by one frame (~33ms at 30fps)
4. Press Left arrow
5. Assert: Current time moved back one frame
```

### Suite 3: Keyboard Shortcuts

**File:** `tests/e2e/keyboard-shortcuts.spec.ts`

**Prerequisites:** Video loaded in editor.

**Fixed shortcuts (cannot be rebound):**

| Key | Action |
|---|---|
| Space | Play/Pause |
| Ctrl+Z / Cmd+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Delete / Backspace | Delete selected region |
| Left/Right arrow | Frame step |
| Tab / Shift+Tab | Cycle annotation selection |

**Configurable shortcuts (defaults):**

| Key | Action |
|---|---|
| Z | Add Zoom region |
| T | Add Trim region |
| S | Add Speed region |
| A | Add Annotation |
| I | Set trim start mark |
| O | Trim from mark to playhead |
| C | Add chapter |
| [ | Previous chapter |
| ] | Next chapter |

#### Test 3.1: Play/pause with Space

```
1. Press Space
2. Assert: Video playing
3. Press Space
4. Assert: Video paused
```

#### Test 3.2: Undo/Redo

```
1. Press Z to create zoom region
2. Assert: Zoom region appears in timeline
3. Press Ctrl+Z (undo)
4. Assert: Zoom region removed
5. Press Ctrl+Y (redo)
6. Assert: Zoom region restored
```

#### Test 3.3: Quick trim (I/O marks)

```
1. Scrub to 25% of video
2. Press I (set trim start mark)
3. Assert: Trim mark indicator visible (red badge with time)
4. Scrub to 75% of video
5. Press O (create trim from mark)
6. Assert: Trim region created from 25% to 75%
```

#### Test 3.4: Chapter markers

```
1. Scrub to 1 second
2. Press C (add chapter)
3. Assert: Chapter marker visible on timeline
4. Scrub to 3 seconds
5. Press C (add another chapter)
6. Press [ (prev chapter)
7. Assert: Playhead jumps to ~1s
8. Press ] (next chapter)
9. Assert: Playhead jumps to ~3s
```

#### Test 3.5: Delete selected region

```
1. Press Z to create zoom
2. Select the zoom region (click on it in timeline)
3. Press Delete
4. Assert: Region removed
```

### Suite 4: Timeline Regions

**File:** `tests/e2e/timeline.spec.ts`

**Prerequisites:** Video loaded in editor.

#### Test 4.1: Create zoom region

```
1. Press Z (or click Zoom tool)
2. Assert: Zoom region created at playhead
3. Assert: Settings panel shows Zoom section (depth slider, focus mode)
```

#### Test 4.2: Create trim region

```
1. Press T (or click Trim tool)
2. Assert: Trim region created at playhead
3. Assert: Timeline shows trim overlay
```

#### Test 4.3: Create speed region

```
1. Press S (or click Speed tool)
2. Assert: Speed region created
3. Assert: Settings panel shows Speed section with slider (0.1x - 16x)
```

#### Test 4.4: Create annotation

```
1. Press A (or click Annotation tool)
2. Assert: Annotation region created
3. Assert: Settings panel shows Annotation section
4. Assert: Text input field focused
5. Type "Hello World"
6. Assert: Annotation text visible on video preview
```

#### Test 4.5: Multiple region types coexist

```
1. Create zoom at 0s
2. Create trim at 1s
3. Create speed at 2s
4. Create annotation at 3s
5. Assert: All 4 regions visible on timeline (different rows)
6. Click zoom region -> settings panel shows zoom controls
7. Click speed region -> settings panel shows speed controls
```

### Suite 5: Export Flow

**File:** `tests/e2e/export.spec.ts`

**Prerequisites:** Video loaded in editor.

#### Test 5.1: MP4 export

```
1. Assert: Export button visible (testId-export-button)
2. Click Export button
3. Assert: Export dialog opens
4. Assert: Progress indicator appears ("Rendering Frames X%")
5. Wait for progress to reach 100% (up to 120s for CPU encoding)
6. Assert: saveExportedVideo called with MP4 data
7. Assert: "Export Complete" state shown OR success toast
```

#### Test 5.2: GIF export with size preset

```
1. Click GIF format button (testId-gif-format-button)
2. Assert: GIF options visible (size presets, FPS selector)
3. Click "Large" size preset (testId-gif-size-button-large)
4. Click Export button
5. Assert: "Compiling GIF" phase appears
6. Wait for completion
7. Assert: saveExportedVideo called with .gif filename
```

#### Test 5.3: Export cancel

```
1. Click Export button
2. Wait for progress to show (> 0%)
3. Click Cancel
4. Assert: Export stops
5. Assert: Dialog returns to idle state
```

#### Test 5.4: Export with effects applied

```
1. Enable blur in settings
2. Adjust shadow intensity to 0.7
3. Create a zoom region
4. Click Export
5. Wait for completion
6. Assert: Export succeeds (effects are applied during frame rendering)
```

### Suite 6: Settings Panel

**File:** `tests/e2e/settings.spec.ts`

**Prerequisites:** Video loaded in editor.

#### Test 6.1: Background selection

```
1. Open Background accordion
2. Assert: Wallpaper options visible
3. Click a wallpaper thumbnail
4. Assert: Video preview background changes
```

#### Test 6.2: Effects toggles

```
1. Open Effects accordion
2. Toggle Blur ON
3. Assert: Blur enabled in preview
4. Adjust padding slider
5. Assert: Video preview padding changes
6. Adjust border radius slider
7. Assert: Video preview corners round
```

#### Test 6.3: Export format persistence

```
1. Select GIF format
2. Select "Large" size preset
3. Reload page (navigate away and back)
4. Assert: GIF format still selected (persisted via localStorage)
5. Assert: "Large" size still selected
```

### Suite 7: Project Persistence

**File:** `tests/e2e/project.spec.ts`

**Prerequisites:** Video loaded in editor.

#### Test 7.1: Save project

```
1. Create zoom region
2. Create trim region
3. Click Save Project button
4. Assert: saveProjectFile called with project data containing:
   - media.screenVideoPath
   - editor state with zoom + trim regions
```

#### Test 7.2: Load project restores state

```
1. Mock loadProjectFile -> returns project JSON with:
   - 2 zoom regions, 1 trim, 1 speed, wallpaper: "gradient-blue"
2. Click Load Project button
3. Assert: Timeline shows all regions
4. Assert: Wallpaper applied
```

#### Test 7.3: Unsaved changes tracking

```
1. Load video (no edits)
2. Assert: setHasUnsavedChanges called with false
3. Create zoom region
4. Assert: setHasUnsavedChanges called with true
5. Save project
6. Assert: setHasUnsavedChanges called with false
```

### Suite 8: HUD Overlay

**File:** `tests/e2e/hud.spec.ts`

#### Test 8.1: HUD renders with controls

```
1. Navigate to /?windowType=hud-overlay
2. Assert: Record button visible
3. Assert: Source selector button visible (default "Screen")
4. Assert: Minimize and close buttons visible
```

#### Test 8.2: Recording state UI changes

```
1. Mock getSources -> [{ id: "screen:0", name: "Display 1" }]
2. Mock getSelectedSource -> { id: "screen:0", name: "Display 1" }
3. Navigate to HUD
4. Click record button
5. Assert: Timer appears (00:00)
6. Assert: Record button becomes stop button
7. Assert: Pause button appears
8. Wait 1 second
9. Assert: Timer shows ~00:01
10. Click stop
11. Assert: switchToEditor called
```

#### Test 8.3: Open file switches to editor

```
1. Navigate to HUD
2. Mock openVideoFilePicker -> { success: true, path: "/test.webm" }
3. Click "Open Video File" button
4. Assert: switchToEditor called
```

### Suite 9: Source Selector

**File:** `tests/e2e/source-selector.spec.ts`

#### Test 9.1: Displays screens and windows

```
1. Mock getSources -> [
     { id: "screen:0", name: "Display 1" },
     { id: "screen:1", name: "Display 2" },
     { id: "window:100", name: "Firefox" },
   ]
2. Navigate to /?windowType=source-selector
3. Assert: "Screens" tab shows count (2)
4. Assert: "Windows" tab shows count (1)
5. Click "Windows" tab
6. Assert: "Firefox" source card visible
```

#### Test 9.2: Select and confirm source

```
1. Mock getSources with screens
2. Navigate to source selector
3. Click "Display 1" card
4. Assert: Card highlighted (selection indicator)
5. Click "Share" button
6. Assert: selectSource called with { id: "screen:0", name: "Display 1" }
```

### Suite 10: Internationalization

**File:** `tests/e2e/i18n.spec.ts`

#### Test 10.1: Language switching

```
1. Navigate to /?windowType=editor
2. Assert: UI in default language (English)
3. Change language selector to another locale
4. Assert: Button labels update
5. Assert: setLocale API called
```

---

## CI Integration

Add to `.github/workflows/ci.yml`:

```yaml
e2e-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
```

The Vite dev server is started automatically by Playwright's `webServer` config.

## Test Data Requirements

| Fixture | Location | Notes |
|---|---|---|
| `sample.webm` | `tests/fixtures/sample.webm` | ~100KB, 2s, 320x240, VP8/VP9 |
| `sample-long.webm` | `tests/fixtures/sample-long.webm` | ~500KB, 10s, for trim/chapter tests |
| `sample-project.openscreen` | `tests/fixtures/sample-project.openscreen` | Valid project JSON with regions |

## Priority Order

Implement in this order (highest impact first):

1. **Suite 5: Export** -- most bug-prone, user-critical
2. **Suite 2: Playback** -- core functionality
3. **Suite 4: Timeline** -- region creation, the heart of editing
4. **Suite 3: Keyboard Shortcuts** -- high-frequency user actions
5. **Suite 7: Project Persistence** -- data loss prevention
6. **Suite 1: Editor Load** -- baseline smoke tests
7. **Suite 6: Settings** -- UI correctness
8. **Suite 8: HUD** -- recording flow
9. **Suite 9: Source Selector** -- recording flow
10. **Suite 10: i18n** -- low risk

## Notes for Implementer

- `isTauri()` returns `false` when `__TAURI_INTERNALS__` is absent. Do NOT inject it. The app falls back to `window.electronAPI` automatically.
- The export pipeline uses `OffscreenCanvas` and Pixi.js for frame rendering. Chromium headless needs `--enable-unsafe-swiftshader` for WebGL. This is already configured in `vitest.browser.config.ts` -- replicate in Playwright's `use.launchOptions`.
- Video elements need an actual playable source. Either serve the fixture via Vite's `public/` directory or create a blob URL in the mock.
- The `useExport` hook calls `saveExportedVideo()` with the final blob. Mock this to capture the output without triggering a native file dialog.
- Tests that involve Pixi.js rendering (export, annotations on canvas) are slower. Use the 120s timeout.
- Frame-by-frame keyboard navigation (`Left`/`Right` arrows) only works when the video area is focused.
- The app loads user preferences from `localStorage` key `"openscreen_user_preferences"`. Clear it in `beforeEach` for isolation, or seed it for persistence tests.
