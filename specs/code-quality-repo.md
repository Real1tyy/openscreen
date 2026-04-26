# Code Quality Audit: OpenScreen (Full Repository)

**Date**: 2026-04-26
**Scope**: Full repository — `src/`, `electron/`, `src-tauri/`
**Source files analyzed**: 134 (118 TS/TSX + 9 Rust + 7 Electron)
**Test files analyzed**: 42
**Total lines of source (non-test)**: ~21,600
**Total lines of test**: ~5,200

---

## Executive Summary

OpenScreen is a dual-runtime (Tauri + Electron) desktop video editor with a React/TypeScript frontend and Rust backend. The codebase has **solid architecture in its hook/handler layer** (well-tested, good separation) but suffers from **5 god files totaling 5,534 lines** that concentrate 15+ responsibilities each, **85+ DRY violations** across the Electron/Tauri bridge layer, **3 security issues** (disabled webSecurity, symlink traversal, unsafe Send), and **64% of source files lacking any test coverage** — with the entire export pipeline (the highest-risk code) essentially untested.

**Highest-impact improvements**:
1. Fix security issues (webSecurity, symlink traversal, write-text-file validation)
2. Split the 3 god components (TimelineEditor, VideoPlayback, VideoEditor)
3. Close export pipeline test gaps (frameRenderer, audioEncoder, videoExporter)
4. Deduplicate IPC handler boilerplate (50+ handlers, ~1,200 lines of repetition)
5. Extract shared region operation utilities

---

## Quality Scorecard

| Module | Read | Maint | DRY | Mod | Test | Robust | Ext | Consist |
|---|---|---|---|---|---|---|---|---|
| `src/components/video-editor/` | 2 | 2 | 2 | 2 | 1 | 3 | 2 | 3 |
| `src/components/video-editor/hooks/` | 4 | 4 | 3 | 4 | 5 | 4 | 4 | 4 |
| `src/components/video-editor/timeline/` | 2 | 2 | 2 | 2 | 4 | 3 | 2 | 3 |
| `src/components/video-editor/videoPlayback/` | 3 | 3 | 3 | 3 | 4 | 3 | 3 | 3 |
| `src/hooks/` | 3 | 3 | 3 | 3 | 2 | 3 | 3 | 3 |
| `src/lib/exporter/` | 3 | 2 | 3 | 2 | 2 | 2 | 2 | 3 |
| `src/lib/` (other) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| `src/utils/` | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 |
| `src/contexts/` | 3 | 3 | 4 | 3 | 1 | 3 | 3 | 3 |
| `src-tauri/src/` | 3 | 3 | 3 | 3 | 2 | 2 | 3 | 3 |
| `electron/` | 2 | 2 | 1 | 2 | 1 | 2 | 2 | 2 |

Scale: 1 = poor, 5 = excellent

---

## Source Code Issues

### Critical (High Impact)

| Location | Smell | Dimension | Technique | Effort | Risk |
|---|---|---|---|---|---|
| `electron/windows.ts:100` | **SECURITY**: `webSecurity: false` disables CORS, allows mixed content, enables script injection | Robustness | Remove flag; add specific CORS exceptions if needed | Quick | High |
| `electron/ipc/handlers.ts:43-47` + `src-tauri/src/commands/file_io.rs:23-27` | **SECURITY**: Symlink traversal — `path.resolve()` / `canonicalize()` fallback allows sandbox escape | Robustness | Always require canonicalization success; use `fs.realpathSync()` | Quick | High |
| `electron/ipc/handlers.ts:955` + `src-tauri/src/commands/file_io.rs:1077` | **SECURITY**: `write-text-file` accepts arbitrary path without validation | Robustness | Add `isPathAllowed()` / `is_path_allowed()` check | Quick | Low |
| `src-tauri/src/encoder.rs:12-13,42` | **SECURITY**: `unsafe impl Send` on `SendScaler` and `NvencEncoder` — FFmpeg `SwsContext` may not be thread-safe | Robustness | Add synchronization or document single-threaded access guarantee | Medium | High |
| `TimelineEditor.tsx` (1,667 LOC) | God component: ~15 responsibilities (playback cursor, axis labels, context menus, keyboard shortcuts, zoom suggestions, trim/annotation/speed/chapter management, selection, state mutations) | Modularity | Extract `<TrimContextMenu>`, `useTimelineKeyboard` hook, zoom suggestion algorithm to pure utility | Large | Medium |
| `VideoPlayback.tsx` (1,391 LOC) | Monolithic PixiJS renderer mixing video loading, layout calc, overlay rendering, zoom transforms, motion blur, webcam compositing, annotation rendering | Modularity | Extract rendering layers into composable modules | Large | Medium |
| `VideoEditor.tsx` (1,125 LOC) | Orchestrator handling 15+ concerns: state sync, project persistence, undo/redo, export coordination, keyboard shortcuts, fullscreen, project dialogs, locale | Modularity | Create intermediate orchestrators for project management, export coordination | Large | Medium |
| `frameRenderer.ts` (919 LOC) | Mixed abstraction: gradient parsing + annotation rendering + webcam masking + zoom transforms + motion blur all sequential in one `renderFrame()` call | Modularity, Testability | Split into gradientRenderer, annotationRenderer, webcamCompositor, zoomTransformer | Medium | Low |
| `useScreenRecorder.ts` (732 LOC) | Single hook managing screen capture, webcam recording, audio mixing, media encoding, bitrate calc, device enumeration, codec selection | Modularity | Split into `useScreenCapture`, `useWebcamCapture`, `useAudioMixing` | Medium | Medium |
| `handlers.ts` (966 LOC) | 50+ IPC handlers with identical try/catch/response boilerplate; no handler factory | DRY | Extract `createHandler<Args, Return>()` factory | Medium | Low |
| `file_io.rs` (1,347 LOC) | God module: file I/O, telemetry, projects, dialogs all mixed | Modularity | Split into paths.rs, sessions.rs, telemetry.rs, projects.rs | Large | Medium |

### Important (Medium Impact)

| Location | Smell | Dimension | Technique | Effort | Risk |
|---|---|---|---|---|---|
| `SettingsPanel.tsx` (695 LOC) | 54-prop interface, nested accordion sections for 8+ settings areas | Modularity | Extract per-section components | Medium | Low |
| `AnnotationSettingsPanel.tsx` (611 LOC) | Handles text, image, figure annotations with complex font/color/style state in one render | Modularity | Extract per-annotation-type sub-panels | Medium | Low |
| `streamingDecoder.ts` (624 LOC) | WebCodecs decoder + frame extraction + timestamp tracking + error handling mixed | Modularity | Separate decoder lifecycle from frame management | Medium | Medium |
| `TimelineEditor.tsx:1334-1357` | `useEffect` with **21 dependencies** for keyboard handler | Maintainability | Extract to `useTimelineKeyboard` hook with `useRef` for mutable state | Medium | Low |
| `TimelineEditor.tsx:647-685` | 5-level deep nesting in `handleTimelineWheel` | Readability | Guard clauses (early returns) | Quick | Low |
| `VideoPlayback.tsx` zoom calc | 6-level deep nesting in zoom region calculation | Readability | Extract conditions into named helper functions | Quick | Low |
| 68+ locations across codebase | Hardcoded magic numbers: `1800` (suggestion spacing), `45_000_000` (4K bitrate), `150` (keyframe snap), `500` (zoom overlap), etc. | Readability | Create `src/lib/constants/{timing,encoding,ui}.ts` | Medium | Low |
| `projectPersistence.ts:182-403` | `normalizeProjectEditor()` is 221 lines doing 6 normalizations | Modularity | Extract normalizer per region type | Medium | Low |
| `cli.rs:66-98` | Lossy argument parsing silently defaults on parse failure | Robustness | Error on invalid input instead of silent default | Quick | Low |
| `platform.rs:17-23` | `request_camera_access()` always returns `granted: true` without checking | Robustness | Implement platform-specific permission request | Medium | Medium |
| `windows.rs:231-253` | Cursor capture thread spawned without lifecycle tracking; no join handle stored | Robustness | Store handle, join on app exit, add single-thread guard | Medium | Medium |
| `export.rs:9,149` | Export session HashMap grows without cleanup/timeout for abandoned sessions | Robustness | Add session expiry or garbage collection | Medium | Low |
| `main.rs:85-86` | `.expect()` on path operations crashes app on failure | Robustness | Propagate error with `?` | Quick | Low |
| `encoder.rs:147-154` | No validation that width/height are even (required for YUV420P) | Robustness | Validate dimensions before encoding | Quick | Low |
| `encoder.rs:54-183` | All errors propagated as `Result<(), String>` — no structured error types | Maintainability | Create custom `Error` enum | Medium | Low |
| `electron/preload.ts:5-166` | `ipcRenderer.invoke()` returns `Promise<any>` — no type safety on returns | Robustness | Add type guards or return serializable DTOs | Medium | Low |
| `electron/ipc/handlers.ts:33` | Global mutable `approvedPaths` Set with no synchronization for concurrent IPC | Robustness | Use typed state management | Quick | Low |

### Minor (Quick Wins)

| Location | Smell | Dimension | Technique | Effort | Risk |
|---|---|---|---|---|---|
| 15+ locations | `Math.max(0, Math.min(val, lim))` instead of `clamp()` | DRY | Add generic `clamp(value, min, max)` to mathUtils | Quick | Low |
| `handlers.ts:316` | Local `clamp()` copy instead of importing from mathUtils | DRY | Import from shared module | Quick | Low |
| 5 handler files | Identical "add region" boilerplate: ID generation, state push, selection | DRY | Extract `createRegionFactory<T>(prefix)` | Quick | Low |
| 3 locations | `if (e.target instanceof HTMLInputElement \|\| e.target instanceof HTMLTextAreaElement)` | DRY | Extract `isInputTarget(target)` utility | Quick | Low |
| 5 handler files | Identical "delete region + clear selection" pattern | DRY | Consolidate into shared handler | Quick | Low |
| 8+ locations | `if (!videoDuration \|\| videoDuration === 0 \|\| totalMs === 0)` validation gate | DRY | Extract `isValidDuration()` guard | Quick | Low |
| `useCameraDevices.ts`, `useMicrophoneDevices.ts` | Duplicate `MediaDevice` interface definitions | DRY | Use single shared type | Quick | Low |
| Multiple files | Scattered hardcoded color `#34B27B` (50+ instances) | Consistency | Extract to Tailwind config or constants | Quick | Low |
| 5 different approaches | ID generation: `nextIdRef++` vs `deriveNextIdFromList` vs `uuidv4()` | Consistency | Standardize per context | Quick | Low |
| Various | Inconsistent error returns: `{ success, error }` vs throw vs toast | Consistency | Document and enforce convention | Medium | Low |
| `videoDecoder.ts` (58 lines) | Dead code: class never imported or used | Maintainability | Delete file | Quick | Low |
| `focusUtils.ts:61` | Unused parameter `_stageSize` | Maintainability | Remove parameter | Quick | Low |
| `src/lib/mathUtils.ts` vs `videoPlayback/mathUtils.ts` | Two separate mathUtils modules | DRY | Consolidate into single module | Quick | Low |
| `BackgroundSection.tsx` / `AnnotationSettingsPanel.tsx` | `handleImageUpload` duplicated | DRY | Extract to shared utility | Quick | Low |

---

## Duplication Map

### Group 1: IPC Handler Boilerplate (~1,200 lines)
**Locations**: `electron/ipc/handlers.ts` (50+ handlers), `electron/preload.ts` (30+ proxies), `src/lib/tauriBridge.ts` (30+ proxies)
**Pattern**: Every handler wraps try/catch with `{ success: true/false }` response. Every preload/bridge method proxies with identical structure.
**Unifying pattern**: Handler factory `createHandler<Args, Return>()` + typed response builders `success<T>(data)`, `error(msg)`
**Effort**: 3-4 hours | **Saves**: ~600 lines

### Group 2: Event Listener Registration (5 instances x 2 runtimes)
**Locations**: `electron/preload.ts:56-143`, `src/lib/tauriBridge.ts:114-220`
**Pattern**: 5 identical event listeners (`stop-recording-from-tray`, `menu-load-project`, `menu-save-project`, `menu-save-project-as`, `request-save-before-close`) with platform-specific cleanup
**Unifying pattern**: `createEventListener(channel, callback)` abstraction
**Effort**: 2-3 hours | **Saves**: ~80 lines

### Group 3: Region Handler Operations (5 files)
**Locations**: `useTrimHandlers.ts`, `useZoomHandlers.ts`, `useSpeedHandlers.ts`, `useAnnotationHandlers.ts`, `useChapterHandlers.ts`
**Pattern**: Each implements add (ID gen + state push + select), delete (filter + clear selection), span change
**Unifying pattern**: Generic `createRegionHandler<T>(prefix, list, pushState, select)` factory
**Effort**: 2-3 hours | **Saves**: ~150 lines

### Group 4: Response Object Construction (40+ instances)
**Locations**: `electron/ipc/handlers.ts` throughout, `electron-env.d.ts` type definitions (30+ inline types)
**Pattern**: `{ success: true, path, ... }` / `{ success: false, message, error }` repeated 40+ times
**Unifying pattern**: `type ApiResponse<T> = SuccessResponse<T> | ErrorResponse` + builder functions
**Effort**: 2-3 hours | **Saves**: ~200 lines of type definitions

### Group 5: Path Validation Logic (3 files)
**Locations**: `handlers.ts:39-52`, `file_io.rs:23-35`, `tauriBridge.ts:33-62`
**Pattern**: Canonicalize path, check within approved directory, check against approved set
**Unifying pattern**: Shared path validation module
**Effort**: 2-3 hours

### Group 6: Math Clamping (15+ inline instances)
**Locations**: `TimelineEditor.tsx` (lines 162, 254, 319, 628, 857, 909, 926, 1057, 1072), `handlers.ts:316-318`
**Pattern**: `Math.max(0, Math.min(val, lim))` instead of `clamp()`
**Unifying pattern**: Add `clamp(value, min, max)` to mathUtils, import everywhere
**Effort**: 30 min | **Saves**: ~30 lines + readability

### Group 7: Constants (scattered)
**Locations**: `handlers.ts:24-27` (file extensions), `types.ts:55-69` (GIF presets), various (encoding bitrates, timing thresholds, UI dimensions)
**Unifying pattern**: Centralized `src/lib/constants/` directory
**Effort**: 1-2 hours

### Group 8: Session Storage (3 implementations)
**Locations**: `handlers.ts:257-299` (Electron), `file_io.rs:129-200` (Tauri from files), `file_io.rs:399-466` (Tauri from buffer)
**Pattern**: All three write video file + session manifest + cursor telemetry + update state
**Unifying pattern**: Shared session writer abstraction
**Effort**: 2-3 hours

---

## Testing Gaps

### Unprotected Critical Logic

| Source File | LOC | Risk | Why It Matters |
|---|---|---|---|
| `lib/exporter/videoExporter.ts` | ~300 | **CRITICAL** | Main video export orchestration — no tests for frame pipeline, progress, cancellation |
| `lib/exporter/audioEncoder.ts` | ~255 | **CRITICAL** | Audio processing with trim/speed — bugs cause silent audio loss, sync issues |
| `lib/exporter/frameRenderer.ts` | 919 | **CRITICAL** | Complex PixiJS rendering with zoom, crop, filters, annotations — all untested |
| `lib/exporter/nvencExporter.ts` | ~150 | **HIGH** | GPU-accelerated export path — no fallback testing |
| `lib/exporter/muxer.ts` | ~90 | **HIGH** | MP4 muxing — muxing bugs produce corrupt files |
| `lib/exporter/annotationRenderer.ts` | ~309 | **HIGH** | Text/arrow rendering, clipping logic untested |
| `hooks/useScreenRecorder.ts` | 732 | **HIGH** | Bitrate calculation, device switching, recording lifecycle untested |
| `hooks/useMediaDevices.ts` | 136 | **MEDIUM** | Permission flow, device enumeration untested |
| `components/video-editor/VideoPlayback.tsx` | 1,391 | **MEDIUM** | Crop interaction, zoom viewport, webcam overlay untested |
| `contexts/I18nContext.tsx` | ~100 | **MEDIUM** | Context consumers could break silently |
| `contexts/ShortcutsContext.tsx` | ~100 | **MEDIUM** | Keyboard shortcut registration untested |
| All `electron/*.ts` files | 2,256 | **HIGH** | Desktop app: IPC, windows, CLI, preload — zero tests |

### Weak Tests

| Test File | Problem | Action |
|---|---|---|
| `gifExporter.test.ts` (19 lines) | Only 2 dimension calculation tests; no aspect ratio edge cases | Add 8+ test cases for edge cases |
| `videoExporter.browser.test.ts` (43 lines) | Only 1 test checking `success === true` | Add error path, audio sync, progress tests |
| `gifExporter.browser.test.ts` | Minimal — only blob type/size check | Add frame accuracy, color fidelity tests |
| `overlayUtils.test.ts` | Assertions like `toBeGreaterThanOrEqual(0)` too weak | Assert specific values |
| `zoomRegionUtils.test.ts` | Hardcodes `TRANSITION_WINDOW_MS = 1015.05` instead of importing | Import constants from source |

### Missing Test Types

- **Property-based tests**: Export dimension calculations, time-range clamping, region overlap detection (fast-check is a devDependency already)
- **Integration tests**: No tests verify VideoEditor + VideoPlayback + Timeline together
- **E2E tests**: Only 1 GIF export spec; need Record-Trim-Export, Load-Edit-Save, Zoom+Annotation+Export
- **Visual regression tests**: No snapshot tests for complex rendering
- **Performance assertions**: No export completion time tests, no frame rate benchmarks
- **Electron tests**: Zero coverage for any desktop-specific code
- **Accessibility tests**: No a11y testing at all

### Coverage by Domain

| Domain | Source Files | Tested | Coverage | Quality |
|---|---|---|---|---|
| Editor Hooks | 10 | 10 | 100% | Excellent |
| Timeline/Playback Utils | 11 | 10 | 91% | Good |
| Lib (math, shortcuts, etc.) | 10 | 8 | 80% | Good |
| Export/Encoding | 12 | 4 | 33% | Poor |
| Media Hooks | 3 | 1 | 33% | Poor |
| UI Components | 54 | 0 | 0% | N/A (presentation) |
| Contexts | 2 | 0 | 0% | Poor |
| Electron IPC | 7 | 0 | 0% | Poor |
| Rust Backend | 9 | 1 (inline) | 11% | Poor |
| **Total** | **118 + 16** | **42** | **31%** | **Fair** |

---

## SOLID Violations

### Single Responsibility

| Location | Violation | Fix |
|---|---|---|
| `TimelineEditor.tsx` | 15+ responsibilities in one component | Extract sub-components and hooks per concern |
| `VideoPlayback.tsx` | Mixes React state management with PixiJS rendering internals | Separate rendering engine from React lifecycle |
| `VideoEditor.tsx` | Orchestrator + layout + persistence + export coordination | Create intermediate orchestrator components |
| `frameRenderer.ts` | `renderFrame()` does gradient, annotation, webcam, zoom, motion blur | One function per rendering concern |
| `useScreenRecorder.ts` | Screen + webcam + audio + encoding + bitrate + device enum | Split into single-concern hooks |
| `handlers.ts` | 50+ IPC handlers with shared mutable state | Group by domain, extract to handler modules |
| `file_io.rs` | File I/O + telemetry + projects + dialogs + path validation | Split into focused modules |

### Open/Closed

| Location | Violation | Fix |
|---|---|---|
| `frameRenderer.ts:275-396` | 5-way if/else for background types | Strategy pattern: renderer per background type |
| `TimelineEditor.tsx:1401-1461` | Growing conditional for each region type | Region type registry with render function per type |
| `AnnotationSettingsPanel.tsx` | Growing if/switch chains for annotation types | Type-keyed renderer strategy |
| `cli.rs:66-98` | Growing match on argument types | Config struct with field-level parsing |

### Dependency Inversion

| Location | Violation | Fix |
|---|---|---|
| `VideoPlayback.tsx` | Direct PixiJS dependency throughout component | Push PixiJS to boundary; abstract renderer |
| `handlers.ts:33` | Global mutable `approvedPaths` Set | Inject via dependency; use state management |
| `useExport.ts` | Directly imports VideoExporter, GifExporter constructors | Inject exporter factory |

### Interface Segregation

| Location | Violation | Fix |
|---|---|---|
| `electron-env.d.ts` | `ElectronAPI` interface with 50+ methods | Group into focused sub-interfaces: `FileAPI`, `ExportAPI`, `RecordingAPI` |
| `SettingsPanel.tsx` | 54-prop interface | Group into focused prop interfaces per section |

---

## Pattern Alignment Gaps

| Pattern | Expected | Actual | Impact |
|---|---|---|---|
| Error handling | Consistent per layer | Electron: `.ok()` / `catch(()=>{})` / `console.error`. Tauri: `.ok()` / `Result<>`. Frontend: try-catch + state / unhandled rejections | Silent failures, inconsistent UX |
| ID generation | One approach per context | 5 approaches: `nextIdRef++`, `deriveNextIdFromList`, `uuidv4()`, sequential, timestamp | Collision risk, maintainability |
| Result types | Single `ApiResult<T>` | 6 different structs in Tauri, inline types in Electron | Frontend must handle multiple shapes |
| Region state updates | All use `pushState` for undo | Some bypass with local state | Undo/redo inconsistency |
| Hook return shape | Consistent `{ actions, state }` | `useZoomHandlers` returns functions; `useTrimHandlers` returns state + functions | API inconsistency |
| Ref-state duplication | Documented convention | Some hooks sync refs every render, others don't | Stale closure bugs |
| Platform bridge | Single abstraction | Two parallel implementations with different patterns | Maintenance burden doubles |

---

## Security Issues (Immediate Action Required)

| Issue | Location | Severity | Fix |
|---|---|---|---|
| `webSecurity: false` | `electron/windows.ts:100` | CRITICAL | Remove; add specific CORS exceptions if needed |
| Symlink traversal | `electron/ipc/handlers.ts:43-47`, `file_io.rs:23-27` | HIGH | Always require canonicalization success |
| Unvalidated write | `handlers.ts:955`, `file_io.rs:1077` | HIGH | Add path validation before write |
| `unsafe impl Send` | `encoder.rs:12-13,42` | HIGH | Add synchronization or document invariant |
| Unbounded path approval | `handlers.ts:33` | MEDIUM | Add size limit, TTL, or scope restriction |
| No IPC schema validation | Cross-cutting | MEDIUM | Validate messages against TS interfaces |
| Missing file size limits | `handlers.ts:518`, `file_io.rs:421-428` | MEDIUM | Add max file size check |
| No dimension validation | `encoder.rs:147-154` | MEDIUM | Validate even width/height for YUV420P |

---

## Quality Plan

### Phase 1: Quick Wins (1-2 days, safe mechanical changes)

1. **Fix security: `write-text-file` path validation** in Electron and Tauri — 30 min
2. **Fix security: remove `webSecurity: false`** in Electron windows.ts — 15 min
3. **Add `clamp(value, min, max)` to mathUtils** and replace 15+ inline calls — 1 hour
4. **Extract `isInputTarget(target)` utility** from 3 duplicated keyboard filters — 15 min
5. **Extract `isValidDuration()` guard** from 8+ duplicated validation gates — 15 min
6. **Import `clamp` in handlers.ts** instead of local copy — 5 min
7. **Consolidate `MediaDevice` type** — remove duplicate interfaces — 30 min
8. **Delete dead `videoDecoder.ts`** (never imported) — 5 min
9. **Remove unused `_stageSize` parameter** from focusUtils — 5 min
10. **Extract brand color `#34B27B`** to constants — 1 hour
11. **Fix hardcoded constants in tests** (import from source) — 30 min
12. **Fix `main.rs` `.expect()` calls** — propagate errors with `?` — 15 min

### Phase 2: DRY Consolidation (3-5 days)

13. **Create IPC handler factory** — reduce 50+ handlers from ~20 to ~5 lines each — 3-4 hours
14. **Create typed response builders** — `success<T>(data)`, `error(msg, err)` — 2-3 hours
15. **Extract event listener abstraction** — unify Electron/Tauri cleanup patterns — 2-3 hours
16. **Create `createRegionHandler<T>` factory** — unify add/delete/select boilerplate — 2-3 hours
17. **Consolidate path validation** into shared module — 2-3 hours
18. **Group `ElectronAPI` interface** into `FileAPI`, `ExportAPI`, `RecordingAPI` — 2 hours
19. **Consolidate mathUtils modules** (lib/ + videoPlayback/) — 1 hour
20. **Extract `handleImageUpload` to shared utility** — 30 min
21. **Consolidate Tauri session storage** (two 90%-identical implementations) — 2 hours

### Phase 3: Structural Cleanup (1-2 weeks)

22. **Split `TimelineEditor.tsx`** (1,667 LOC) into:
    - `<TimelineEditor>` container/orchestrator (~400 LOC)
    - `<TrimContextMenu>` component
    - `useTimelineKeyboard` hook (21-dep useEffect extracted)
    - Flatten 5-level nesting with guard clauses
    - Effort: 8 hours | Risk: Medium

23. **Split `VideoPlayback.tsx`** (1,391 LOC) into:
    - `<VideoPlayback>` React lifecycle orchestrator
    - `pixiRenderer.ts` rendering engine
    - `zoomInterpolator.ts` zoom region interpolation
    - `motionBlurEngine.ts` motion blur calculation
    - Effort: 12 hours | Risk: Medium

24. **Split `VideoEditor.tsx`** (1,125 LOC) into:
    - `<VideoEditor>` layout orchestrator
    - `useProjectManager` hook (project load/save/reset)
    - `useExportCoordinator` hook (export state)
    - Effort: 8 hours | Risk: Medium

25. **Split `frameRenderer.ts`** (919 LOC) into:
    - `frameRenderer.ts` orchestrator (~200 LOC)
    - `gradientRenderer.ts` CSS gradient parsing + rendering
    - `annotationFrameRenderer.ts` annotation overlay
    - `webcamCompositor.ts` webcam mask + compositing
    - Effort: 6 hours | Risk: Medium

26. **Split `useScreenRecorder.ts`** (732 LOC) into:
    - `useScreenCapture` — screen/window capture
    - `useWebcamCapture` — webcam recording
    - `useAudioMixing` — audio track management
    - Effort: 6 hours | Risk: Medium

27. **Split `handlers.ts`** (966 LOC) into:
    - `pathHandlers.ts`, `sessionHandlers.ts`, `telemetryHandlers.ts`, `projectHandlers.ts`
    - Effort: 4 hours | Risk: Low

28. **Split `file_io.rs`** (1,347 LOC) into:
    - `paths.rs`, `sessions.rs`, `telemetry.rs`, `projects.rs`
    - Effort: 4 hours | Risk: Low

29. **Split `SettingsPanel.tsx`** (695 LOC) and `AnnotationSettingsPanel.tsx` (611 LOC)
    - Extract per-section components
    - Effort: 6 hours | Risk: Low

30. **Fix `encoder.rs` unsafe Send** — add proper synchronization or document invariant — 4 hours

### Phase 4: Test Hardening (1-2 weeks)

31. **Export pipeline tests** (CRITICAL):
    - `audioEncoder.test.ts` — trim/speed processing, codec validation (8+ tests)
    - `videoExporter.test.ts` — happy path, error handling, progress, cancellation (10+ tests)
    - `frameRenderer.test.ts` — basic render, with annotations, with zoom, with blur (12+ tests)
    - `nvencExporter.test.ts` — success path, fallback logic (5+ tests)
    - `muxer.test.ts` — basic mux, audio+video, corrupt input (6+ tests)
    - Effort: 20 hours

32. **Media device tests** (HIGH):
    - `useScreenRecorder.test.ts` — bitrate calc, device switching, pause/resume (10+ tests)
    - `useMediaDevices.test.ts` — permission flow, enumeration, disconnect (8+ tests)
    - Effort: 8 hours

33. **Context tests** (MEDIUM):
    - `I18nContext.test.tsx` — provider rendering, locale switching, fallback
    - `ShortcutsContext.test.tsx` — registration, conflict detection, cleanup
    - Effort: 4 hours

34. **Property-based tests** with fast-check (already installed):
    - Export dimension calculations
    - Time-range clamping
    - Region overlap detection
    - Gradient CSS parsing
    - Effort: 4 hours

35. **Strengthen weak tests**:
    - Replace `toBeGreaterThanOrEqual(0)` with specific values
    - Add edge cases to useTrimHandlers (invalid ID, boundary durations)
    - Expand gifExporter.test.ts from 2 to 10+ tests
    - Import constants from source instead of hardcoding in tests
    - Effort: 4 hours

36. **E2E tests** (3-5 new Playwright specs):
    - Record-Trim-Export workflow
    - Load-Edit-Save project workflow
    - Zoom + Annotation + Export workflow
    - Effort: 12 hours

37. **Test infrastructure**:
    - Create `src/__tests__/fixtures.ts` with mock factories (region builders, device mocks, Tauri bridge mock)
    - Add coverage reporting to vitest config (target: 60% statements)
    - Effort: 4 hours

### Phase 5: Composition & Extensibility (ongoing)

38. **Annotation type strategy pattern** — replace growing if/switch in AnnotationSettingsPanel — 4 hours
39. **Background renderer strategy pattern** — replace 5-way if/else in frameRenderer — 4 hours
40. **Region type registry** for TimelineEditor — register per-type render/normalize/create — 6 hours
41. **Standardize error handling** — document convention, enforce across layers — 4 hours
42. **Standardize ID generation** — one approach per context, documented — 2 hours
43. **Unify Electron/Tauri result types** — single `ApiResult<T>` envelope — 4 hours

---

## Changes Applied

None — this is an analysis-only audit. No source files were modified.

---

## Remaining Opportunities

- Visual regression testing (Chromatic/Percy) for complex rendering
- Structured logging framework (replace `console.error` / `eprintln!`)
- Export session garbage collection with timeout
- Cursor sample circular buffer (prevent OOM on 24+ hour recordings — currently unbounded at 10Hz)
- CSS module consolidation for scattered inline Tailwind colors
- Accessibility testing (no a11y tests exist)
- Performance benchmarks for frame rendering pipeline
- State machine formalization for recording (idle/recording/paused/stopped) and export states
- i18n gaps: several hardcoded strings in TimelineEditor and VideoEditor
- O(n) array scans per frame in VideoPlayback ticker (`findActiveTrimRegion`, `findActiveSpeedRegion`); pre-sorting or binary search would help

---

## Risk Areas

| Area | Risk | Why to proceed carefully |
|---|---|---|
| VideoPlayback.tsx decomposition | GPU resource leaks | PixiJS lifecycle tightly coupled to React effects; splitting requires careful resource management |
| TimelineEditor keyboard extraction | Behavior regression | 21-dependency useEffect; new hook must maintain same re-registration timing |
| Encoder unsafe Send removal | Architecture change | May require FFmpeg context access patterns to change |
| IPC handler factory | Response shape changes | Frontend depends on specific response fields; factory must preserve exact shapes |
| Electron webSecurity removal | Media loading breakage | Local file access may depend on disabled CORS; test thoroughly |
| Electron/Tauri path validation unification | Security regression | Both have different edge-case handling; unifying could introduce bypasses |
| Changing useEditorHistory structure | Data loss | History snapshots stored in specific format; changing could corrupt undo stack |
