# Code Quality Audit: Entire Repository

**Date**: 2026-04-25
**Scope**: Full repository audit — `src/`, `electron/`, `src-tauri/`
**Source files analyzed**: 108
**Test files analyzed**: 40
**Total lines of source (non-test)**: ~18,500
**Total lines of test**: ~4,500

---

## Executive Summary

OpenScreen is a screen recorder + video editor supporting Electron and Tauri backends. The codebase has **solid TypeScript foundations** and **well-tested utility modules**, but suffers from **god components** (3 files over 1000 lines), **massive duplication** between Electron/Tauri layers, **zero integration tests**, and **untested critical paths** (export pipeline, recording, UI components). The biggest quality risk is the export pipeline: `frameRenderer.ts` (912 lines, 0 tests) renders every exported frame and has potential VideoFrame memory leaks. A secondary concern is **two security vulnerabilities** in both Electron and Tauri `write-text-file` handlers that accept arbitrary file paths without validation.

**Highest-impact improvements**:
1. Fix `write-text-file` path validation (security)
2. Split the 3 god components (VideoEditor, VideoPlayback, TimelineEditor)
3. Add tests for `frameRenderer.ts`, `useExport.ts`, `useScreenRecorder.ts`
4. Consolidate duplicated logic across Electron/Tauri
5. Extract shared region operation utilities (DRY)

---

## Quality Scorecard

| Module | Read | Maint | DRY | Mod | Test | Robust | Extend | Consist |
|---|---|---|---|---|---|---|---|---|
| `src/components/video-editor/` | 3 | 2 | 2 | 2 | 2 | 3 | 2 | 3 |
| `src/components/video-editor/hooks/` | 4 | 4 | 3 | 4 | 4 | 3 | 4 | 4 |
| `src/components/video-editor/videoPlayback/` | 4 | 3 | 3 | 3 | 4 | 3 | 3 | 4 |
| `src/components/video-editor/timeline/` | 3 | 2 | 2 | 3 | 3 | 3 | 2 | 3 |
| `src/components/video-editor/settings/` | 3 | 3 | 2 | 3 | 1 | 3 | 3 | 3 |
| `src/lib/exporter/` | 3 | 2 | 3 | 3 | 2 | 2 | 2 | 3 |
| `src/lib/` (utilities) | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 |
| `src/hooks/` | 3 | 3 | 3 | 3 | 2 | 3 | 3 | 3 |
| `electron/` | 3 | 2 | 2 | 2 | 1 | 2 | 2 | 3 |
| `src-tauri/` | 3 | 2 | 2 | 2 | 3 | 2 | 2 | 3 |

Scale: 1 (poor) - 5 (excellent)

---

## Source Code Issues

### Critical (High Impact, Safe to Fix)

| Location | Smell | Dimension | Technique | Effort | Risk |
|---|---|---|---|---|---|
| `electron/ipc/handlers.ts:955` | **SECURITY**: `write-text-file` accepts arbitrary path, no validation | Robustness | Add `isPathAllowed()` check before write | Quick | Low |
| `src-tauri/src/commands/file_io.rs:1077` | **SECURITY**: `write_text_file` accepts arbitrary path, no validation | Robustness | Add `is_path_allowed()` check before write | Quick | Low |
| `TimelineEditor.tsx` (1698 lines) | God component: 52 props, 5 inner components, timeline + keyboard + context menu | Modularity | Extract inner components to files, group props into interfaces | Large | Medium |
| `VideoPlayback.tsx` (1391 lines) | God component: 37 props, 21 refs, Pixi rendering + playback + zoom + annotations | Modularity | Split into VideoCanvas, VideoOverlays, PlaybackController | Large | Medium |
| `VideoEditor.tsx` (1125 lines) | God component: 16 useState calls, 8 hooks, orchestrator + layout + persistence | Modularity | Extract useProjectState, reduce prop drilling with context | Large | Medium |
| `frameRenderer.ts:584-738` | `updateAnimationState()` is 154 lines mixing zoom, smoothing, transitions, motion | Modularity | Extract `computeAutoFollowSmoothing()`, `applyZoomTransition()`, `computeMotionIntensity()` | Medium | Low |
| `frameRenderer.ts:275-396` | `setupBackground()` is 121 lines handling 5 background types with nested async | Modularity | Extract handler per background type | Medium | Low |
| `ipc/handlers.ts` (962 lines) | God module: 40+ IPC handlers, cursor telemetry, session storage, project loading | Modularity | Split into paths.ts, sessions.ts, telemetry.ts, projects.ts | Large | Medium |
| `file_io.rs` (1347 lines) | God module: file I/O, telemetry, projects, dialogs, all mixed | Modularity | Split into paths.rs, sessions.rs, telemetry.rs, projects.rs | Large | Medium |
| `TimelineEditor.tsx:985-1031` | 4 nearly identical forEach blocks normalizing zoom/trim/speed/chapter regions | DRY | Extract `normalizeRegionSpan(region, totalMs, minDurationMs)` | Quick | Low |
| `TimelineEditor.tsx:1080-1110 vs 1209-1239` | `handleAddZoom` and `handleAddTrim` are near-identical (sort, find next, check overlap) | DRY | Extract `createRegionAtPosition(regions, startPos, duration)` | Quick | Low |
| `SettingsPanel.tsx` (705 lines) | 54 props interface, crop modal + export controls inline | Modularity | Extract CropModal, ExportControls as separate components | Medium | Low |
| `AnnotationSettingsPanel.tsx` (624 lines) | 6 tabs + styling + color selectors all in one file | Modularity | Extract TextStyleControls, ArrowControls, ColorPicker | Medium | Low |

### Important (Medium Impact)

| Location | Smell | Dimension | Technique | Effort | Risk |
|---|---|---|---|---|---|
| `projectPersistence.ts:182-403` | `normalizeProjectEditor()` is 221 lines doing 6 normalizations | Modularity | Extract normalizer per region type | Medium | Low |
| `useScreenRecorder.ts` (732 lines) | Single hook managing stream acquisition, audio mixing, encoding, file I/O, state | Modularity | Split into useAudioMixing, useRecordingState | Large | Medium |
| `compositeLayout.ts:128-270` | `computeCompositeLayout()` is 143 lines mixing layout, sizing, border radius | Modularity | Extract WebcamSizeCalculator, LayoutPresetHandler | Medium | Low |
| `streamingDecoder.ts:366-399` | VideoFrame clone not closed if `onFrame()` throws | Robustness | Wrap in try/finally | Quick | Low |
| `videoExporter.ts:256-269` | Busy-wait with 5ms sleep for encoder backpressure | Robustness | Increase to 10ms, add exponential backoff | Quick | Low |
| `src/lib/mathUtils.ts` vs `videoPlayback/mathUtils.ts` | Two separate mathUtils modules with no shared code | DRY | Consolidate into single module | Quick | Low |
| `useCameraDevices.ts` / `useMicrophoneDevices.ts` | Both implement identical device enumeration + devicechange pattern | DRY | Extract generic `useMediaDevices(kind)` hook | Medium | Low |
| `LaunchWindow.tsx:258-374` | Mic and webcam selectors are identical structure, duplicated | DRY | Extract DeviceSelector component | Medium | Low |
| `BackgroundSection.tsx` / `AnnotationSettingsPanel.tsx` | `handleImageUpload` duplicated in both files | DRY | Extract to shared `lib/imageHandling.ts` | Quick | Low |
| `regionReducers.ts:24-31` | Unsafe `as Array<{...}>` cast loses type safety | Testability | Use TypeScript generics or discriminated unions | Quick | Low |
| `electron/ipc/handlers.ts:554-615` | Cursor telemetry handler is 62 lines with nested parsing | Readability | Extract `parseCursorSamples()` helper | Quick | Low |
| Color `"#34B27B"` | Hardcoded 50+ times across all components | Consistency | Extract `BRAND_COLOR` constant | Quick | Low |
| `videoDecoder.ts` (58 lines) | Dead code: class never imported or used anywhere | Maintainability | Delete file | Quick | Low |

### Minor (Quick Wins)

| Location | Smell | Dimension | Technique | Effort | Risk |
|---|---|---|---|---|---|
| `TimelineEditor.tsx:63` | `SUGGESTION_SPACING_MS = 1800` unexplained | Readability | Add const name or comment | Quick | Low |
| `useScreenRecorder.ts:138-146` | Bitrate thresholds (45M, 28M, 18M) hardcoded | Readability | Extract BITRATE_4K, BITRATE_QHD, BITRATE_BASE constants | Quick | Low |
| `frameRenderer.ts:819-825` | Shadow blur/alpha values (48,16,8 / 0.7,0.5,0.3) hardcoded | Readability | Extract SHADOW_LAYERS config | Quick | Low |
| `gifExporter.ts:166` | `quality: 10` without explaining scale | Readability | Name constant with explanation | Quick | Low |
| `windows.ts/windows.rs` | Window sizes (600x160, 1200x800, 620x420) hardcoded | Consistency | Extract window dimension constants | Quick | Low |
| `VideoEditor.tsx:751,782` | Hardcoded color `#34B27B` in JSX | Consistency | Use BRAND_COLOR constant | Quick | Low |
| `VideoPlayback.tsx:1319-1331` | Annotation filtering/sorting inline in render, not memoized | Extensibility | Extract to useMemo | Quick | Low |
| `frameRenderer.ts:411,417` | Double cast `as unknown as TextureSourceLike` | Readability | Fix type alignment or single cast | Quick | Low |
| `EffectsSection.tsx:135-169` | SliderControl defined inline, should be shared | DRY | Extract to `components/ui/slider-control.tsx` | Quick | Low |
| `focusUtils.ts:61` | Parameter `_stageSize: StageSize` unused | Maintainability | Remove parameter | Quick | Low |

---

## Duplication Map

### 1. Region Operations (3-5 instances)

**Locations**:
- `TimelineEditor.tsx:985-1031` (normalization, 4x)
- `TimelineEditor.tsx:1080-1110` (add zoom) / `1209-1239` (add trim)
- `TimelineEditor.tsx:935-958` (delete handlers, 5x)
- `videoPlayback/zoomRegionUtils.ts` (overlap detection)

**Unifying pattern**: Extract `regionOperations.ts` with:
- `normalizeRegionSpan(region, totalMs, minDurationMs)`
- `createRegionAtPosition(regions, startPos, defaults)`
- `deleteRegion(regions, id)`
- `detectOverlap(regions, startMs, endMs)`

### 2. Session Storage (3 implementations)

**Locations**:
- `electron/ipc/handlers.ts:257-299` (Electron)
- `src-tauri/src/commands/file_io.rs:129-200` (Tauri from files)
- `src-tauri/src/commands/file_io.rs:399-466` (Tauri from buffer)

**All three write**: video file + session manifest JSON + cursor telemetry JSON + update state.
~92 lines duplicated between Electron/Tauri, plus Tauri duplicates itself internally.

### 3. Device Enumeration (2 hooks)

**Locations**:
- `src/hooks/useCameraDevices.ts`
- `src/hooks/useMicrophoneDevices.ts`

**Both implement**: selectedDeviceId tracking, devicechange listener, enumerate + filter by kind, fallback to first device.

**Unifying pattern**: `useMediaDevices(kind: "audioinput" | "videoinput")`

### 4. Path Validation (2 implementations)

**Locations**:
- `electron/ipc/handlers.ts:43-53` (`isPathWithinDir`, `isPathAllowed`)
- `src-tauri/src/commands/file_io.rs:23-35` (`is_path_within_dir`, `is_path_allowed`)

**Same intent**: Canonicalize path, check if within approved directory, check against approved set.
Different implementations with different edge-case handling (symlinks, fallbacks).

### 5. Cursor Telemetry Parsing (2 implementations)

**Locations**:
- `electron/ipc/handlers.ts:554-615`
- `src-tauri/src/commands/file_io.rs:999-1044`

**Both**: Read JSON file, handle array vs `{samples:[]}` format, filter, clamp, return.

### 6. UI Patterns (not extracted)

| Pattern | Locations | Count |
|---|---|---|
| Button grid (`grid-cols-N`, active/inactive styling) | SpeedSection, ZoomSection, WebcamSection | 3 |
| Color selector popup | AnnotationSettingsPanel (text, bg, arrow) | 3 |
| Tab UI (Radix Tabs with brand color active state) | BackgroundSection, AnnotationSettingsPanel, ExportDialog | 3 |
| Image upload handler | BackgroundSection:89, AnnotationSettingsPanel:106 | 2 |
| Device selector dropdown | LaunchWindow:258 (mic), LaunchWindow:302 (webcam) | 2 |

---

## Testing Gaps

### Unprotected Critical Logic

| Module | Lines | Risk | Why it matters |
|---|---|---|---|
| `frameRenderer.ts` | 912 | **Critical** | Renders every exported frame. VideoFrame leaks, zoom animation, compositing untested |
| `useExport.ts` | 337 | **Critical** | Export orchestration hook. No test file exists |
| `useScreenRecorder.ts` | 732 | **Critical** | Recording state machine. Complex audio mixing, stream setup untested |
| `annotationRenderer.ts` | 309 | High | Text rendering, arrow rendering, clipping logic untested |
| `audioEncoder.ts` | 255 | High | Timestamp adjustment with trims/speed. Zero tests |
| `muxer.ts` | 90 | Medium | Muxing logic untested |
| `VideoEditor.tsx` | 1125 | High | Main orchestrator, project loading, state management |
| `VideoPlayback.tsx` | 1391 | High | Pixi.js rendering, 167-line ticker function |
| `TimelineEditor.tsx` | 1698 | High | Timeline interactions, zoom suggestions |
| All `electron/*.ts` files | 2256 | High | Desktop app: IPC, windows, CLI, preload. Zero tests |

### Weak Tests

| Test File | Problem | Action |
|---|---|---|
| `zoomRegionUtils.test.ts` | Hardcodes `TRANSITION_WINDOW_MS = 1015.05` instead of importing from source | Import constants |
| `overlayUtils.test.ts` | Assertions like `toBeGreaterThanOrEqual(0)` too weak | Assert specific values |
| `useTrimHandlers.test.ts` | Only tests rounding direction, not precision; missing invalid ID case | Add edge cases |
| `useAnnotationHandlers.test.ts` | Type switching tested but old data not cleared; no bounds check | Add data cleanup tests |
| `gifExporter.test.ts` | Only 20 lines (2 tests) for 379-line module | Expand substantially |

### Missing Test Types

- **Integration tests**: Zero. No tests verify VideoEditor + VideoPlayback + Timeline together
- **Property-based tests**: `fast-check` is installed but only used in `mathUtils.test.ts`; good candidates: `gradientParser.ts`, `compositeLayout.ts`, `timelineScaleUtils.ts`
- **E2E coverage**: Only `gif-export.spec.ts` exists; no record-edit-export flow test
- **Electron tests**: Zero coverage for desktop-specific code

---

## SOLID Violations

### Single Responsibility

| Location | Violation | Fix |
|---|---|---|
| `VideoPlayback.tsx` | Canvas rendering + video playback + zoom animation + webcam overlay + annotation rendering | Split into VideoCanvas, ZoomAnimator, OverlayRenderer |
| `TimelineEditor.tsx` | Timeline rendering + keyboard shortcuts + context menus + zoom suggestions + keyframe management | Extract KeyboardShortcutsProvider, ZoomSuggestionEngine |
| `useScreenRecorder.ts` | Stream acquisition + audio mixing + encoder selection + file I/O + state management | Split into useAudioMixing, useRecordingState, useStreamCapture |
| `ipc/handlers.ts` | 40+ handlers for paths, sessions, telemetry, projects, dialogs | Split into handler modules |
| `file_io.rs` | File I/O + telemetry + projects + dialogs + path validation | Split into focused modules |

### Open/Closed

| Location | Violation | Fix |
|---|---|---|
| `frameRenderer.ts:275-396` | 5-way if/else for background types | Strategy pattern: `BackgroundRenderer` interface per type |
| `TimelineEditor.tsx:1401-1461` | Growing conditional for each region type (zoom, trim, speed, chapter, annotation) | Region type registry with render function per type |
| `SettingsPanel.tsx` | New settings sections require modifying 705-line file | Composition: register sections via config array |

### Dependency Inversion

| Location | Violation | Fix |
|---|---|---|
| `useExport.ts` | Directly imports VideoExporter, GifExporter constructors | Inject exporter factory |
| `useScreenRecorder.ts` | Direct MediaRecorder construction, file system access inline | Inject recording backend interface |
| `compositeLayout.ts` | Hardcoded layout presets | Accept preset config as parameter |

---

## Pattern Alignment Gaps

### Inconsistent Error Handling

- **Electron**: Mix of `.ok()` (silent), `catch(() => {})` (swallow), and `catch(e => console.error(e))` (log-only)
- **Tauri**: Mix of `.ok()` (silent) and `Result<>` (propagate)
- **Frontend hooks**: Mix of try-catch with state update and unhandled promise rejections
- **Recommendation**: Adopt single pattern per layer; all file ops should propagate errors

### Inconsistent Result Types (Tauri)

6 different result structs: `GenericResult`, `SessionResult`, `ReadBinaryResult`, `VideoPathResult`, `ProjectLoadResult`, `CursorTelemetryResult`

All share `success: bool` + optional error. Should unify into generic `ApiResult<T>`.

### Ref-State Duplication Pattern

Multiple hooks maintain both a `useState` value and a `useRef` pointing to the same data:
- `useTrimHandlers.ts:37-39` (trimMarkStartMsRef + state)
- `VideoPlayback.tsx:163-220` (21 refs duplicating props)
- `useChapterHandlers.ts:29-30` (chaptersRef synced every render)

This is a valid React pattern for closure access but applied inconsistently. Should document as project convention or consolidate.

---

## Quality Plan

### Phase 1: Quick Wins (Safe, Mechanical)

1. **Fix `write-text-file` security vulnerability** in both Electron and Tauri
   - Add `isPathAllowed()` / `is_path_allowed()` check
   - Effort: 30 min | Risk: None

2. **Delete dead code** `src/lib/exporter/videoDecoder.ts` (58 lines, never imported)
   - Effort: 5 min | Risk: None

3. **Extract brand color constant** `BRAND_COLOR = "#34B27B"` used 50+ times
   - Create `src/lib/constants/colors.ts`
   - Effort: 1 hour | Risk: None

4. **Extract region normalization** from TimelineEditor
   - `normalizeRegionSpan(region, totalMs, minDurationMs)` replaces 4 identical blocks
   - Effort: 30 min | Risk: Low

5. **Extract region creation** from TimelineEditor
   - `createRegionAtPosition(regions, startPos, defaults)` replaces handleAddZoom/handleAddTrim
   - Effort: 30 min | Risk: Low

6. **Extract delete handlers** from VideoEditor
   - Single `handleDeleteRegion(type, id)` replaces 5 identical callbacks
   - Effort: 30 min | Risk: Low

7. **Remove unused parameter** `_stageSize` from `focusUtils.ts:61`
   - Effort: 5 min | Risk: None

8. **Fix hardcoded constants in tests** (import from source instead)
   - `zoomRegionUtils.test.ts:7-9`, `overlayUtils.test.ts:10`
   - Effort: 30 min | Risk: None

### Phase 2: DRY Consolidation

9. **Consolidate mathUtils** (`src/lib/mathUtils.ts` + `videoPlayback/mathUtils.ts`)
   - Move easing/bezier functions to shared module
   - Effort: 1 hour | Risk: Low

10. **Extract `useMediaDevices(kind)` hook**
    - Replaces useCameraDevices + useMicrophoneDevices duplication
    - Effort: 2 hours | Risk: Low

11. **Extract `handleImageUpload` to shared utility**
    - Used in BackgroundSection and AnnotationSettingsPanel
    - Effort: 30 min | Risk: Low

12. **Extract SliderControl component**
    - Currently inline in EffectsSection, usable in WebcamSection
    - Effort: 1 hour | Risk: Low

13. **Extract DeviceSelector component from LaunchWindow**
    - Mic and webcam selectors are structural duplicates
    - Effort: 1 hour | Risk: Low

14. **Consolidate Tauri session storage**
    - `store_recorded_session_from_files()` and `store_recorded_session()` share 90% logic
    - Effort: 2 hours | Risk: Medium

### Phase 3: Structural Cleanup

15. **Split TimelineEditor.tsx** (1698 lines)
    - Extract inner components (PlaybackCursor, TimelineAxis, TrimContextMenuItems) to files
    - Group 52 props into interfaces (RegionHandlers, SelectionHandlers, LayoutHandlers)
    - Effort: 8 hours | Risk: Medium

16. **Split VideoPlayback.tsx** (1391 lines)
    - Extract ticker function (167 lines) to `usePlaybackTicker` hook
    - Split into VideoCanvas (Pixi), VideoOverlays (annotations), PlaybackController
    - Effort: 12 hours | Risk: Medium

17. **Split VideoEditor.tsx** (1125 lines)
    - Extract `applyLoadedProject` (74 lines) to utility
    - Introduce context for shared state to reduce prop drilling
    - Effort: 8 hours | Risk: Medium

18. **Split ipc/handlers.ts** (962 lines)
    - pathHandlers.ts, sessionHandlers.ts, telemetryHandlers.ts, projectHandlers.ts
    - Effort: 4 hours | Risk: Low

19. **Split file_io.rs** (1347 lines)
    - paths.rs, sessions.rs, telemetry.rs, projects.rs
    - Effort: 4 hours | Risk: Low

20. **Split frameRenderer.ts** (912 lines)
    - Extract `updateAnimationState()` (154 lines) to ZoomStateComputer
    - Extract `setupBackground()` (121 lines) to BackgroundRenderer
    - Extract `compositeWithShadows()` (88 lines) to CompositeRenderer
    - Effort: 6 hours | Risk: Medium

21. **Split SettingsPanel.tsx** (705 lines) and AnnotationSettingsPanel.tsx (624 lines)
    - Extract crop modal, export controls, color pickers to separate files
    - Effort: 6 hours | Risk: Low

### Phase 4: Test Hardening

22. **Add `frameRenderer.test.ts`** - highest priority untested module
    - Test setupBackground per type, updateAnimationState zoom logic, VideoFrame cleanup
    - Effort: 8 hours | Risk: None

23. **Add `useExport.test.ts`** - untested export orchestration
    - Test format selection, dimension calculation, cancellation, progress
    - Effort: 4 hours | Risk: None

24. **Add `useScreenRecorder.test.ts`** - untested recording state machine
    - Test start/pause/resume/stop lifecycle, audio mixing, device management
    - Effort: 6 hours | Risk: None

25. **Add `audioEncoder.test.ts`** - untested timestamp adjustment
    - Test computeAdjustedTimestamp with trims and speed regions
    - Effort: 2 hours | Risk: None

26. **Strengthen existing test assertions**
    - Replace `toBeGreaterThanOrEqual(0)` with specific values
    - Add edge cases to useTrimHandlers (invalid ID, boundary durations)
    - Effort: 4 hours | Risk: None

27. **Add property-based tests** (fast-check already installed)
    - `gradientParser.ts`, `compositeLayout.ts`, `timelineScaleUtils.ts`
    - Effort: 4 hours | Risk: None

28. **Add integration test scaffold** for VideoEditor
    - Verify trim+zoom+speed regions propagate through editor pipeline
    - Effort: 8 hours | Risk: None

### Phase 5: Composition & Extensibility

29. **Introduce EditorContext** for shared state
    - Replace 54-prop drilling through SettingsPanel
    - Replace 52-prop drilling through TimelineEditor
    - Effort: 12 hours | Risk: Medium

30. **Background renderer strategy pattern**
    - Replace 5-way if/else in frameRenderer.setupBackground()
    - Register renderer per background type
    - Effort: 4 hours | Risk: Low

31. **Region type registry** for TimelineEditor
    - Register render function, normalization, creation per region type
    - Replaces growing conditional chains
    - Effort: 6 hours | Risk: Medium

32. **Unify Electron/Tauri result types**
    - Single `ApiResult<T>` envelope for all backend responses
    - Effort: 4 hours | Risk: Medium

---

## Changes Applied

None (analysis only).

---

## Remaining Opportunities

- **i18n gaps**: Several hardcoded strings in TimelineEditor ("Press C to add chapter"), VideoEditor ("trim start: X")
- **Performance**: VideoPlayback ticker runs `findActiveTrimRegion()` and `findActiveSpeedRegion()` with O(n) array scans every frame; pre-sorting or binary search would help
- **Accessibility**: No keyboard navigation tests, no ARIA roles on custom controls
- **Electron/Tauri path validation unification**: Both have subtly different canonicalization behavior (symlinks, fallbacks) that could lead to security divergence
- **State machine formalization**: Recording state (idle/recording/paused/stopped) and export state transitions are implicit; a formal state machine would prevent invalid transitions

---

## Risk Areas

| Area | Risk | Why skipped |
|---|---|---|
| Refactoring VideoPlayback Pixi.js ticker | Behavior change risk | 167-line function with animation state, motion blur, adaptive smoothing. Needs comprehensive tests first |
| Changing Electron/Tauri path validation | Security regression risk | Both have different edge-case handling; unifying could introduce bypasses |
| Moving types.ts definitions | Breaking import chains | 30+ files import from this; needs coordinated update |
| Changing useEditorHistory undo/redo structure | Data loss risk | History snapshots stored in specific format; changing could corrupt undo stack |
| Removing approval path accumulation | Feature regression | Security improvement but might break legitimate multi-file workflows |
