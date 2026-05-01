import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import {
	calculateOutputDimensions,
	type ExportFormat,
	type ExportQuality,
	GIF_SIZE_PRESETS,
	type GifFrameRate,
	type GifSizePreset,
} from "@/lib/exporter";
import { getAPI, isTauri, readFileAsBlobUrl } from "@/lib/tauriBridge";
import { useThrottledCallback } from "@/lib/useThrottledCallback";
import { useEditorPreferencesStore } from "@/stores/useEditorPreferencesStore";
import { useEditorSelectionStore } from "@/stores/useEditorSelectionStore";
import {
	type EditorState,
	INITIAL_EDITOR_STATE,
	pauseEditorHistory,
	redoEditor,
	resumeEditorHistory,
	undoEditor,
	useEditorStore,
} from "@/stores/useEditorStore";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { formatMsCompact } from "@/utils/timeUtils";
import { ExportDialog } from "./ExportDialog";
import { ExportSettingsDialog } from "./ExportSettingsDialog";
import { computeEffectiveMs } from "./exportUtils";
import { useEditorKeyboard } from "./hooks/useEditorKeyboard";
import { useExport } from "./hooks/useExport";
import { useTrimPlayback } from "./hooks/useTrimPlayback";
import PlaybackControls from "./PlaybackControls";
import { PreferencesDialog } from "./PreferencesDialog";
import {
	createProjectData,
	createProjectSnapshot,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	type ProjectMedia,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import TimelineEditor from "./timeline/TimelineEditor";
import type { CursorTelemetryPoint } from "./types";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";

async function toPlayableUrl(filePath: string): Promise<string> {
	if (isTauri()) {
		return readFileAsBlobUrl(filePath);
	}
	return toFileUrl(filePath);
}

export default function VideoEditor() {
	// ── Zustand stores ────────────────────────────────────────────
	const store = useEditorStore();
	const {
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		chapters,
		cropRegion,
		wallpaper,
		shadowIntensity,
		showBlur,
		motionBlurAmount,
		borderRadius,
		padding,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamSizePreset,
		webcamPosition,
	} = store;

	const editorState: EditorState = useMemo(
		() => ({
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			chapters,
			cropRegion,
			wallpaper,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamSizePreset,
			webcamPosition,
		}),
		[
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			chapters,
			cropRegion,
			wallpaper,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamSizePreset,
			webcamPosition,
		],
	);

	const sel = useEditorSelectionStore();

	// ── Non-undoable state
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
	const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const currentTimeRef = useRef(0);
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);

	const handleTimeUpdate = useThrottledCallback(
		(time: number) => {
			currentTimeRef.current = time;
			setCurrentTime(time);
		},
		100,
		isPlaying,
	);

	const {
		selectedZoomId,
		selectedAnnotationId,
		selectZoom: handleSelectZoom,
		selectAnnotation: handleSelectAnnotation,
		selectChapter,
		setEditingChapterId,
		clearStale,
	} = sel;

	useEffect(() => {
		clearStale({
			zoomIds: zoomRegions.map((r) => r.id),
			trimIds: trimRegions.map((r) => r.id),
			speedIds: speedRegions.map((r) => r.id),
			annotationIds: annotationRegions.map((r) => r.id),
			chapterIds: chapters.map((r) => r.id),
		});
	}, [zoomRegions, trimRegions, speedRegions, annotationRegions, chapters, clearStale]);

	const [exportQuality, setExportQuality] = useState<ExportQuality>("good");
	const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(15);
	const [gifLoop, setGifLoop] = useState(true);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>("medium");
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showPreferences, setShowPreferences] = useState(false);
	const [showExportSettings, setShowExportSettings] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(
		() => useEditorPreferencesStore.getState().sidebarWidth,
	);
	const sidebarWidthRef = useRef(sidebarWidth);
	sidebarWidthRef.current = sidebarWidth;

	const playerContainerRef = useRef<HTMLDivElement>(null);
	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	// Preview playback speed (not applied on export)
	const [previewSpeed, setPreviewSpeed] = useState(1);

	const { shortcuts, isMac } = useShortcuts();
	const t = useScopedT("editor");

	// ── Trim playback (needs DOM refs, can't live in store) ──
	const {
		loopRegion,
		loopingTrimId,
		clearLoop,
		trimMarkStartMs,
		handleTrimPlayFromStart,
		handleTrimPlayFromEnd,
		handleTrimToggleLoop,
		handleQuickTrimStart,
		handleQuickTrimEnd,
	} = useTrimPlayback(videoPlaybackRef, currentTimeRef, durationRef);

	// ── Chapter helpers that need DOM refs ─────────────────
	const handleAddChapter = useCallback(() => {
		const totalMs = Math.round(durationRef.current * 1000);
		if (totalMs <= 0) return;
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
		const prevCh = [...sorted].reverse().find((ch) => ch.startMs <= nowMs);
		const startMs = prevCh ? Math.max(prevCh.startMs + 100, nowMs) : 0;
		if (startMs >= totalMs) return;
		if (prevCh) {
			useEditorStore.getState().setChapterSpan(prevCh.id, { start: prevCh.startMs, end: startMs });
		}
		const id = useEditorStore.getState().addChapter(startMs, totalMs);
		setEditingChapterId(id);
		selectChapter(id);
	}, [chapters, setEditingChapterId, selectChapter]);

	const chaptersRef = useRef(chapters);
	chaptersRef.current = chapters;
	const handleChapterNavigatePrev = useCallback(() => {
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const prev = [...chaptersRef.current]
			.sort((a, b) => a.startMs - b.startMs)
			.reverse()
			.find((ch) => ch.startMs < nowMs - 100);
		if (prev && videoPlaybackRef.current?.video)
			videoPlaybackRef.current.video.currentTime = prev.startMs / 1000;
	}, []);
	const handleChapterNavigateNext = useCallback(() => {
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const next = [...chaptersRef.current]
			.sort((a, b) => a.startMs - b.startMs)
			.find((ch) => ch.startMs > nowMs + 100);
		if (next && videoPlaybackRef.current?.video)
			videoPlaybackRef.current.video.currentTime = next.startMs / 1000;
	}, []);

	const commitState = resumeEditorHistory;

	const {
		isExporting,
		exportProgress,
		exportError,
		showExportDialog,
		setShowExportDialog,
		exportedFilePath,
		unsavedExport,
		handleOpenExportDialog,
		handleCancelExport,
		handleSaveUnsavedExport,
		handleShowExportedFile,
	} = useExport({
		videoPath,
		webcamVideoPath,
		editorState,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		isPlaying,
		videoPlaybackRef,
		cursorTelemetry,
		chapters,
	});

	const effectiveDurationMs = useMemo(
		() => computeEffectiveMs(Math.round(duration * 1000), trimRegions, speedRegions),
		[duration, trimRegions, speedRegions],
	);

	const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
		const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!screenVideoPath) {
			return null;
		}

		const webcamSourcePath =
			webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
		return webcamSourcePath
			? { screenVideoPath, webcamVideoPath: webcamSourcePath }
			: { screenVideoPath };
	}, [videoPath, videoSourcePath, webcamVideoPath, webcamVideoSourcePath]);

	const applyLoadedProject = useCallback(async (candidate: unknown, path?: string | null) => {
		if (!validateProjectData(candidate)) {
			return false;
		}

		const project = candidate;
		const media = resolveProjectMedia(project);
		if (!media) {
			return false;
		}
		const sourcePath = fromFileUrl(media.screenVideoPath);
		const webcamSourcePath = media.webcamVideoPath ? fromFileUrl(media.webcamVideoPath) : null;
		const normalizedEditor = normalizeProjectEditor(project.editor);

		try {
			videoPlaybackRef.current?.pause();
		} catch {
			// no-op
		}
		setIsPlaying(false);
		currentTimeRef.current = 0;
		setCurrentTime(0);
		setDuration(0);

		setError(null);
		await getAPI().setCurrentVideoPath(sourcePath);
		setVideoSourcePath(sourcePath);
		setVideoPath(await toPlayableUrl(sourcePath));
		setWebcamVideoSourcePath(webcamSourcePath);
		setWebcamVideoPath(webcamSourcePath ? await toPlayableUrl(webcamSourcePath) : null);
		setCurrentProjectPath(path ?? null);

		const editorStore = useEditorStore.getState();
		editorStore.loadState(normalizedEditor);
		const fullState = { ...INITIAL_EDITOR_STATE, ...normalizedEditor };
		editorStore.resetIdCounters(fullState);
		setExportQuality(normalizedEditor.exportQuality);
		setExportFormat(normalizedEditor.exportFormat);
		setGifFrameRate(normalizedEditor.gifFrameRate);
		setGifLoop(normalizedEditor.gifLoop);
		setGifSizePreset(normalizedEditor.gifSizePreset);

		useEditorSelectionStore.getState().clearAll();

		setLastSavedSnapshot(
			createProjectSnapshot(
				webcamSourcePath
					? { screenVideoPath: sourcePath, webcamVideoPath: webcamSourcePath }
					: { screenVideoPath: sourcePath },
				normalizedEditor,
			),
		);
		return true;
	}, []);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentProjectMedia) {
			return null;
		}
		return createProjectSnapshot(currentProjectMedia, {
			wallpaper,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
		});
	}, [
		currentProjectMedia,
		wallpaper,
		shadowIntensity,
		showBlur,
		motionBlurAmount,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamPosition,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);

	useEffect(() => {
		async function loadInitialData() {
			try {
				// Check if a file was provided via CLI argument
				const cliFile = await getAPI().getCliInputFile();
				console.log("[VideoEditor] CLI input file:", cliFile);
				if (cliFile) {
					const videoUrl = await toPlayableUrl(cliFile);
					console.log("[VideoEditor] Video URL:", videoUrl);
					await getAPI().setCurrentVideoPath(cliFile);
					setVideoSourcePath(cliFile);
					setVideoPath(videoUrl);
					setWebcamVideoSourcePath(null);
					setWebcamVideoPath(null);
					setCurrentProjectPath(null);

					const cliConfig = await getAPI().getCliEditorConfig();
					if (cliConfig) {
						useEditorStore.getState().loadState({
							shadowIntensity: cliConfig.shadowIntensity,
							showBlur: cliConfig.showBlur,
							motionBlurAmount: cliConfig.motionBlurAmount,
							borderRadius: cliConfig.borderRadius,
							padding: cliConfig.padding,
							wallpaper: cliConfig.wallpaper,
						});
					}

					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: cliFile }, INITIAL_EDITOR_STATE),
					);
					return;
				}

				const currentProjectResult = await getAPI().loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const result = await getAPI().getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					setVideoSourcePath(sourcePath);
					setVideoPath(await toPlayableUrl(sourcePath));
					setWebcamVideoSourcePath(null);
					setWebcamVideoPath(null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: sourcePath }, INITIAL_EDITOR_STATE),
					);
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	const updatePrefs = useEditorPreferencesStore((s) => s.update);

	// Apply persisted preferences to the editor store on mount
	useEffect(() => {
		const prefs = useEditorPreferencesStore.getState();
		const editorStore = useEditorStore.getState();
		editorStore.setPadding(prefs.padding);
		editorStore.setAspectRatio(prefs.aspectRatio);
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
	}, []);

	// Persist preference changes back to localStorage
	useEffect(() => {
		updatePrefs({ padding, aspectRatio, exportQuality, exportFormat });
	}, [padding, aspectRatio, exportQuality, exportFormat, updatePrefs]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return false;
			}

			if (!currentProjectMedia) {
				toast.error(t("errors.unableToDetermineSourcePath"));
				return false;
			}

			const projectData = createProjectData(currentProjectMedia, {
				wallpaper,
				shadowIntensity,
				showBlur,
				motionBlurAmount,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				trimRegions,
				speedRegions,
				annotationRegions,
				aspectRatio,
				webcamLayoutPreset,
				webcamMaskShape,
				webcamSizePreset,
				webcamPosition,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
			});

			const fileNameBase =
				currentProjectMedia.screenVideoPath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			const projectSnapshot = JSON.stringify(projectData);
			const result = await getAPI().saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
			);

			if (result.canceled) {
				toast.info(t("project.saveCanceled"));
				return false;
			}

			if (!result.success) {
				toast.error(result.message || t("project.failedToSave"));
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(projectSnapshot);

			toast.success(t("project.savedTo", { path: result.path ?? "" }));
			return true;
		},
		[
			currentProjectMedia,
			currentProjectPath,
			wallpaper,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			videoPath,
			t,
		],
	);

	useEffect(() => {
		getAPI().setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	const saveProjectRef = useRef(saveProject);
	saveProjectRef.current = saveProject;

	useEffect(() => {
		const cleanup = getAPI().onRequestSaveBeforeClose(async () => {
			return saveProjectRef.current(false);
		});
		return () => cleanup();
	}, []);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleOpenVideo = useCallback(async () => {
		const result = await getAPI().openVideoFilePicker();

		if (result.canceled || !result.path) {
			return;
		}

		if (!result.success) {
			toast.error("Selected file is not a supported video");
			return;
		}

		try {
			videoPlaybackRef.current?.pause();
		} catch {
			// no-op
		}
		setIsPlaying(false);
		currentTimeRef.current = 0;
		setCurrentTime(0);
		setDuration(0);

		setError(null);
		await getAPI().setCurrentVideoPath(result.path);
		setVideoSourcePath(result.path);
		setVideoPath(await toPlayableUrl(result.path));
		setWebcamVideoSourcePath(null);
		setWebcamVideoPath(null);
		setCurrentProjectPath(null);

		useEditorStore.getState().loadState(INITIAL_EDITOR_STATE);
		useEditorSelectionStore.getState().clearAll();

		setLastSavedSnapshot(
			createProjectSnapshot({ screenVideoPath: result.path }, INITIAL_EDITOR_STATE),
		);

		toast.success("Video loaded");
	}, []);

	const handleLoadProject = useCallback(async () => {
		const result = await getAPI().loadProjectFile();

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || "Failed to load project");
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error("Invalid project file format");
			return;
		}

		toast.success(`Project loaded from ${result.path}`);
	}, [applyLoadedProject]);

	const handleOpenVideoRef = useRef(handleOpenVideo);
	handleOpenVideoRef.current = handleOpenVideo;
	const handleLoadProjectRef = useRef(handleLoadProject);
	handleLoadProjectRef.current = handleLoadProject;
	const handleSaveProjectRef = useRef(handleSaveProject);
	handleSaveProjectRef.current = handleSaveProject;
	const handleSaveProjectAsRef = useRef(handleSaveProjectAs);
	handleSaveProjectAsRef.current = handleSaveProjectAs;

	useEffect(() => {
		const removeOpenVideoListener = getAPI().onMenuOpenVideo(() => handleOpenVideoRef.current());
		const removeLoadListener = getAPI().onMenuLoadProject(() => handleLoadProjectRef.current());
		const removeSaveListener = getAPI().onMenuSaveProject(() => handleSaveProjectRef.current());
		const removeSaveAsListener = getAPI().onMenuSaveProjectAs(() =>
			handleSaveProjectAsRef.current(),
		);
		const removePrefsListener = getAPI().onMenuPreferences(() => setShowPreferences(true));

		return () => {
			removeOpenVideoListener?.();
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
			removePrefsListener?.();
		};
	}, []);

	useEffect(() => {
		let mounted = true;

		async function loadCursorTelemetry() {
			const sourcePath = currentProjectMedia?.screenVideoPath ?? null;

			if (!sourcePath) {
				if (mounted) {
					setCursorTelemetry([]);
				}
				return;
			}

			try {
				const result = await getAPI().getCursorTelemetry(sourcePath);
				if (mounted) {
					setCursorTelemetry(result.success ? result.samples : []);
				}
			} catch (telemetryError) {
				console.warn("Unable to load cursor telemetry:", telemetryError);
				if (mounted) {
					setCursorTelemetry([]);
				}
			}
		}

		loadCursorTelemetry();

		return () => {
			mounted = false;
		};
	}, [currentProjectMedia]);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		if (isPlaying) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
	}, []);

	const handleSidebarResizeStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = sidebarWidthRef.current;

			const onMouseMove = (ev: MouseEvent) => {
				const delta = startX - ev.clientX;
				const newWidth = Math.max(200, Math.min(500, startWidth + delta));
				setSidebarWidth(newWidth);
				sidebarWidthRef.current = newWidth;
			};

			const onMouseUp = () => {
				window.removeEventListener("mousemove", onMouseMove);
				window.removeEventListener("mouseup", onMouseUp);
				document.body.style.cursor = "";
				updatePrefs({ sidebarWidth: sidebarWidthRef.current });
			};

			document.body.style.cursor = "col-resize";
			window.addEventListener("mousemove", onMouseMove);
			window.addEventListener("mouseup", onMouseUp);
		},
		[updatePrefs],
	);

	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = time;
	}

	useEditorKeyboard({
		undo: undoEditor,
		redo: redoEditor,
		shortcuts,
		isMac,
		videoPlaybackRef,
		durationRef,
		handleQuickTrimStart,
		handleQuickTrimEnd,
		handleAddChapter,
		handleChapterNavigatePrev,
		handleChapterNavigateNext,
		toggleFullscreen,
	});

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">Loading video...</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleOpenVideo}
							className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
						>
							Open Video
						</button>
						<button
							type="button"
							onClick={handleLoadProject}
							className="px-3 py-1.5 rounded-md bg-white/10 text-slate-200 text-sm hover:bg-white/15 border border-white/10"
						>
							Open Project
						</button>
					</div>
				</div>
			</div>
		);
	}

	if (!videoPath) {
		return (
			<div className="flex items-center justify-center h-screen bg-[#09090b]">
				<div className="flex flex-col items-center gap-4">
					<div className="text-slate-400 text-sm">No video loaded</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleOpenVideo}
							className="px-4 py-2 rounded-md bg-[#34B27B] text-white text-sm font-medium hover:bg-[#34B27B]/90"
						>
							Open Video
						</button>
						<button
							type="button"
							onClick={handleLoadProject}
							className="px-4 py-2 rounded-md bg-white/10 text-slate-200 text-sm font-medium hover:bg-white/15 border border-white/10"
						>
							Open Project
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
			<div className="flex-1 flex min-h-0 relative">
				{/* Left Column - Video & Timeline */}
				<div className="flex-1 flex flex-col min-w-0 h-full">
					<PanelGroup direction="vertical">
						{/* Top section: video preview and controls */}
						<Panel defaultSize={70} maxSize={95} minSize={15}>
							<div
								ref={playerContainerRef}
								className={
									isFullscreen
										? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
										: "w-full h-full flex flex-col items-center justify-center bg-black/40 overflow-hidden relative"
								}
							>
								{/* Quick-trim mark indicator */}
								{trimMarkStartMs != null && (
									<div className="absolute top-2 right-2 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/90 text-white text-xs font-medium shadow-lg">
										<span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
										Trim start: {formatMsCompact(trimMarkStartMs)} — press O to trim
									</div>
								)}
								{/* Video preview */}
								<div className="w-full flex justify-center items-center flex-auto mt-1.5">
									<div
										className="relative flex justify-center items-center w-auto h-full max-w-full box-border"
										style={{
											aspectRatio:
												aspectRatio === "native"
													? getNativeAspectRatioValue(
															videoPlaybackRef.current?.video?.videoWidth || 1920,
															videoPlaybackRef.current?.video?.videoHeight || 1080,
															cropRegion,
														)
													: getAspectRatioValue(aspectRatio),
										}}
									>
										<VideoPlayback
											key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
											aspectRatio={aspectRatio}
											ref={videoPlaybackRef}
											videoPath={videoPath}
											webcamVideoPath={webcamVideoPath || undefined}
											webcamLayoutPreset={webcamLayoutPreset}
											webcamMaskShape={webcamMaskShape}
											webcamSizePreset={webcamSizePreset}
											webcamPosition={webcamPosition}
											onWebcamPositionChange={(pos) => {
												pauseEditorHistory();
												store.setWebcamPosition(pos);
											}}
											onWebcamPositionDragEnd={commitState}
											onDurationChange={setDuration}
											onTimeUpdate={handleTimeUpdate}
											currentTime={currentTime}
											onPlayStateChange={setIsPlaying}
											onError={setError}
											wallpaper={wallpaper}
											zoomRegions={zoomRegions}
											selectedZoomId={selectedZoomId}
											onSelectZoom={handleSelectZoom}
											onZoomFocusChange={store.setZoomFocus}
											onZoomFocusDragEnd={commitState}
											isPlaying={isPlaying}
											showShadow={shadowIntensity > 0}
											shadowIntensity={shadowIntensity}
											showBlur={showBlur}
											motionBlurAmount={motionBlurAmount}
											borderRadius={borderRadius}
											padding={padding}
											cropRegion={cropRegion}
											trimRegions={trimRegions}
											speedRegions={speedRegions}
											annotationRegions={annotationRegions}
											selectedAnnotationId={selectedAnnotationId}
											onSelectAnnotation={handleSelectAnnotation}
											onAnnotationPositionChange={store.setAnnotationPosition}
											onAnnotationSizeChange={store.setAnnotationSize}
											cursorTelemetry={cursorTelemetry}
											loopRegion={loopRegion}
											previewSpeed={previewSpeed}
										/>
									</div>
								</div>
								{/* Playback controls */}
								<div className="w-full flex justify-center items-center h-12 flex-shrink-0 px-3 py-1.5 my-1.5 gap-2">
									<div className="flex-1 max-w-[700px]">
										<PlaybackControls
											isPlaying={isPlaying}
											currentTime={currentTime}
											duration={duration}
											isFullscreen={isFullscreen}
											onToggleFullscreen={toggleFullscreen}
											onTogglePlayPause={togglePlayPause}
											onSeek={handleSeek}
											previewSpeed={previewSpeed}
											onPreviewSpeedChange={setPreviewSpeed}
											isLooping={loopingTrimId != null}
											onStopLoop={clearLoop}
											trimMarkStartMs={trimMarkStartMs}
										/>
									</div>
									<div className="flex items-center gap-2 shrink-0">
										{effectiveDurationMs !== Math.round(duration * 1000) && (
											<span className="text-[10px] text-slate-500 tabular-nums">
												{formatMsCompact(effectiveDurationMs)}
											</span>
										)}
										<button
											type="button"
											onClick={() => setShowExportSettings(true)}
											className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#34B27B] text-white text-xs font-semibold shadow-lg shadow-[#34B27B]/20 hover:bg-[#34B27B]/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 shrink-0"
										>
											<Download className="w-3.5 h-3.5" />
											Export
										</button>
									</div>
								</div>
							</div>
						</Panel>

						<PanelResizeHandle className="h-px cursor-row-resize hover:bg-white/10 transition-colors" />

						{/* Timeline section */}
						<Panel defaultSize={30} maxSize={85} minSize={5}>
							<div className="h-full bg-[#09090b] overflow-hidden flex flex-col">
								<TimelineEditor
									videoDuration={duration}
									currentTime={currentTime}
									onSeek={handleSeek}
									cursorTelemetry={cursorTelemetry}
									onTrimPlayFromStart={handleTrimPlayFromStart}
									onTrimPlayFromEnd={handleTrimPlayFromEnd}
									onTrimToggleLoop={handleTrimToggleLoop}
									loopingTrimId={loopingTrimId}
									trimMarkStartMs={trimMarkStartMs}
									aspectRatio={aspectRatio}
									onAspectRatioChange={(ar) => {
										store.setAspectRatio(ar);
										if (!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack") {
											store.setWebcamLayoutPreset("picture-in-picture");
										}
									}}
								/>
							</div>
						</Panel>
					</PanelGroup>
				</div>

				{/* Right section: settings panel */}
				<div
					className="h-full flex-shrink-0 overflow-hidden relative"
					style={{ width: sidebarWidth }}
				>
					{/* Edge resize zone */}
					<div
						className="absolute left-0 top-0 bottom-0 w-[4px] cursor-col-resize z-10 hover:bg-white/10 transition-colors"
						onMouseDown={handleSidebarResizeStart}
					/>
					<SettingsPanel
						videoElement={videoPlaybackRef.current?.video || null}
						hasCursorTelemetry={cursorTelemetry.length > 0}
						videoDuration={duration}
						currentTimeMs={Math.round(currentTime * 1000)}
						hasWebcam={Boolean(webcamVideoPath)}
						onSeek={handleSeek}
						onAddChapter={handleAddChapter}
					/>
				</div>
			</div>

			<PreferencesDialog isOpen={showPreferences} onClose={() => setShowPreferences(false)} />

			<ExportSettingsDialog
				isOpen={showExportSettings}
				onClose={() => setShowExportSettings(false)}
				exportFormat={exportFormat}
				onExportFormatChange={setExportFormat}
				exportQuality={exportQuality}
				onExportQualityChange={setExportQuality}
				gifFrameRate={gifFrameRate}
				onGifFrameRateChange={setGifFrameRate}
				gifLoop={gifLoop}
				onGifLoopChange={setGifLoop}
				gifSizePreset={gifSizePreset}
				onGifSizePresetChange={setGifSizePreset}
				gifOutputDimensions={calculateOutputDimensions(
					videoPlaybackRef.current?.video?.videoWidth || 1920,
					videoPlaybackRef.current?.video?.videoHeight || 1080,
					gifSizePreset,
					GIF_SIZE_PRESETS,
					aspectRatio === "native"
						? getNativeAspectRatioValue(
								videoPlaybackRef.current?.video?.videoWidth || 1920,
								videoPlaybackRef.current?.video?.videoHeight || 1080,
								cropRegion,
							)
						: getAspectRatioValue(aspectRatio),
				)}
				onExport={handleOpenExportDialog}
				unsavedExport={unsavedExport}
				onSaveUnsavedExport={handleSaveUnsavedExport}
				effectiveDurationMs={effectiveDurationMs}
			/>

			<ExportDialog
				isOpen={showExportDialog}
				onClose={() => setShowExportDialog(false)}
				progress={exportProgress}
				isExporting={isExporting}
				error={exportError}
				onCancel={handleCancelExport}
				exportFormat={exportFormat}
				exportedFilePath={exportedFilePath || undefined}
				onShowInFolder={
					exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
				}
			/>
		</div>
	);
}
