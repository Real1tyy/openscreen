import { FolderOpen, Languages, Save, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { type Locale, SUPPORTED_LOCALES } from "@/i18n/config";
import { getLocaleName } from "@/i18n/loader";
import {
	calculateOutputDimensions,
	type ExportFormat,
	type ExportQuality,
	GIF_SIZE_PRESETS,
	type GifFrameRate,
	type GifSizePreset,
} from "@/lib/exporter";
import type { ProjectMedia } from "@/lib/recordingSession";
import { getAPI, isTauri, readFileAsBlobUrl } from "@/lib/tauriBridge";
import { useEditorPreferencesStore } from "@/stores/useEditorPreferencesStore";
import {
	type EditorState,
	INITIAL_EDITOR_STATE,
	pauseEditorHistory,
	redoEditor,
	resumeEditorHistory,
	undoEditor,
	useEditorStore,
} from "@/stores/useEditorStore";
import { useEditorSelectionStore } from "@/stores/useEditorSelectionStore";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { formatMsCompact } from "@/utils/timeUtils";
import { ExportDialog } from "./ExportDialog";
import { useEditorKeyboard } from "./hooks/useEditorKeyboard";
import { useExport } from "./hooks/useExport";
import { useTrimPlayback } from "./hooks/useTrimPlayback";
import PlaybackControls from "./PlaybackControls";
import {
	createProjectData,
	createProjectSnapshot,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
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
			zoomRegions, trimRegions, speedRegions, annotationRegions, chapters,
			cropRegion, wallpaper, shadowIntensity, showBlur, motionBlurAmount,
			borderRadius, padding, aspectRatio, webcamLayoutPreset, webcamMaskShape,
			webcamSizePreset, webcamPosition,
		}),
		[zoomRegions, trimRegions, speedRegions, annotationRegions, chapters,
			cropRegion, wallpaper, shadowIntensity, showBlur, motionBlurAmount,
			borderRadius, padding, aspectRatio, webcamLayoutPreset, webcamMaskShape,
			webcamSizePreset, webcamPosition],
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
	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);

	const {
		selectedZoomId,
		selectedAnnotationId,
		selectZoom: handleSelectZoom,
		selectAnnotation: handleSelectAnnotation,
		selectChapter,
		setEditingChapterId,
		clearAll: clearSelection,
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

	const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
	const [exportQuality, setExportQuality] = useState<ExportQuality>("good");
	const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(15);
	const [gifLoop, setGifLoop] = useState(true);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>("medium");
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	const playerContainerRef = useRef<HTMLDivElement>(null);
	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	// Preview playback speed (not applied on export)
	const [previewSpeed, setPreviewSpeed] = useState(1);

	const { shortcuts, isMac } = useShortcuts();
	const t = useScopedT("editor");
	const ts = useScopedT("settings");
	const { locale, setLocale } = useI18n();

	// ── Trim playback (needs DOM refs, can't live in store) ──
	const {
		loopRegion, loopingTrimId, clearLoop, trimMarkStartMs,
		handleTrimPlayFromStart, handleTrimPlayFromEnd, handleTrimToggleLoop,
		handleQuickTrimStart, handleQuickTrimEnd,
	} = useTrimPlayback(videoPlaybackRef, currentTimeRef, durationRef);

	// ── Chapter helpers that need DOM refs ─────────────────
	const handleAddChapter = useCallback(() => {
		const totalMs = Math.round(durationRef.current * 1000);
		if (totalMs <= 0) return;
		const startMs = Math.max(0, Math.min(Math.round(currentTimeRef.current * 1000), totalMs - 100));
		const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
		const nextCh = sorted.find((ch) => ch.startMs > startMs);
		const endMs = Math.max(startMs + 100, nextCh ? nextCh.startMs : totalMs);
		const id = store.addChapter(startMs, endMs);
		setEditingChapterId(id);
		selectChapter(id);
	}, [store, chapters, setEditingChapterId, selectChapter, currentTimeRef, durationRef]);

	const handleSelectChapter = useCallback(
		(id: string | null) => {
			selectChapter(id);
			if (id) {
				const ch = chapters.find((c) => c.id === id);
				if (ch && videoPlaybackRef.current?.video) {
					videoPlaybackRef.current.video.currentTime = ch.startMs / 1000;
				}
			}
		},
		[selectChapter, chapters, videoPlaybackRef],
	);

	const chaptersRef = useRef(chapters);
	chaptersRef.current = chapters;
	const handleChapterNavigatePrev = useCallback(() => {
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const prev = [...chaptersRef.current].sort((a, b) => a.startMs - b.startMs).reverse().find((ch) => ch.startMs < nowMs - 100);
		if (prev && videoPlaybackRef.current?.video) videoPlaybackRef.current.video.currentTime = prev.startMs / 1000;
	}, [currentTimeRef, videoPlaybackRef]);
	const handleChapterNavigateNext = useCallback(() => {
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const next = [...chaptersRef.current].sort((a, b) => a.startMs - b.startMs).find((ch) => ch.startMs > nowMs + 100);
		if (next && videoPlaybackRef.current?.video) videoPlaybackRef.current.video.currentTime = next.startMs / 1000;
	}, [currentTimeRef, videoPlaybackRef]);

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

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
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
			setCurrentTime(0);
			setDuration(0);

			setError(null);
			await getAPI().setCurrentVideoPath(sourcePath);
			setVideoSourcePath(sourcePath);
			setVideoPath(await toPlayableUrl(sourcePath));
			setWebcamVideoSourcePath(webcamSourcePath);
			setWebcamVideoPath(webcamSourcePath ? await toPlayableUrl(webcamSourcePath) : null);
			setCurrentProjectPath(path ?? null);

			store.loadState(normalizedEditor);
			const fullState = { ...INITIAL_EDITOR_STATE, ...normalizedEditor };
			store.resetIdCounters(fullState);
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);

			clearSelection();

			setLastSavedSnapshot(
				createProjectSnapshot(
					webcamSourcePath
						? { screenVideoPath: sourcePath, webcamVideoPath: webcamSourcePath }
						: { screenVideoPath: sourcePath },
					normalizedEditor,
				),
			);
			return true;
		},
		[store, clearSelection],
	);

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
						store.loadState({
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

				const currentSessionResult = await getAPI().getCurrentRecordingSession();
				if (currentSessionResult.success && currentSessionResult.session) {
					const session = currentSessionResult.session;
					const sourcePath = fromFileUrl(session.screenVideoPath);
					const webcamSourcePath = session.webcamVideoPath
						? fromFileUrl(session.webcamVideoPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(await toPlayableUrl(sourcePath));
					setWebcamVideoSourcePath(webcamSourcePath);
					setWebcamVideoPath(webcamSourcePath ? await toPlayableUrl(webcamSourcePath) : null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot(
							webcamSourcePath
								? { screenVideoPath: sourcePath, webcamVideoPath: webcamSourcePath }
								: { screenVideoPath: sourcePath },
							INITIAL_EDITOR_STATE,
						),
					);
					return;
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
				} else {
					setError("No video to load. Please record or select a video.");
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject, store]);

	const updatePrefs = useEditorPreferencesStore((s) => s.update);

	// Apply persisted preferences to the editor store on mount
	useEffect(() => {
		const prefs = useEditorPreferencesStore.getState();
		store.setPadding(prefs.padding);
		store.setAspectRatio(prefs.aspectRatio);
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
	}, [store]);

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

	useEffect(() => {
		const cleanup = getAPI().onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});
		return () => cleanup();
	}, [saveProject]);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleNewRecordingConfirm = useCallback(async () => {
		const result = await getAPI().startNewRecording();
		if (result.success) {
			setShowNewRecordingDialog(false);
		} else {
			console.error("Failed to start new recording:", result.error);
			setError("Failed to start new recording: " + (result.error || "Unknown error"));
		}
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

	useEffect(() => {
		const removeLoadListener = getAPI().onMenuLoadProject(handleLoadProject);
		const removeSaveListener = getAPI().onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = getAPI().onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleLoadProject, handleSaveProject, handleSaveProjectAs]);

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
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
					>
						Load Project File
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
			<Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
				<DialogContent
					className="sm:max-w-[425px]"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("newRecording.title")}</DialogTitle>
						<DialogDescription>{t("newRecording.description")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setShowNewRecordingDialog(false)}
							className="px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
						>
							{t("newRecording.cancel")}
						</button>
						<button
							type="button"
							onClick={handleNewRecordingConfirm}
							className="px-4 py-2 rounded-md bg-[#34B27B] text-white hover:bg-[#34B27B]/90 text-sm font-medium transition-colors"
						>
							{t("newRecording.confirm")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div
				className="h-10 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-6 z-50"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div
					className="flex-1 flex items-center gap-1"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<div
						className={`flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 ${isMac ? "ml-14" : "ml-2"}`}
					>
						<Languages size={14} />
						<select
							value={locale}
							onChange={(e) => setLocale(e.target.value as Locale)}
							className="bg-transparent text-[11px] font-medium outline-none cursor-pointer appearance-none pr-1"
							style={{ color: "inherit" }}
						>
							{SUPPORTED_LOCALES.map((loc) => (
								<option key={loc} value={loc} className="bg-[#09090b] text-white">
									{getLocaleName(loc)}
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						onClick={() => setShowNewRecordingDialog(true)}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 text-[11px] font-medium"
					>
						<Video size={14} />
						{t("newRecording.title")}
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 text-[11px] font-medium"
					>
						<FolderOpen size={14} />
						{ts("project.load")}
					</button>
					<button
						type="button"
						onClick={handleSaveProject}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-white/50 hover:text-white/90 hover:bg-white/10 transition-all duration-150 text-[11px] font-medium"
					>
						<Save size={14} />
						{ts("project.save")}
					</button>
				</div>
			</div>

			<div className="flex-1 p-5 gap-4 flex min-h-0 relative">
				{/* Left Column - Video & Timeline */}
				<div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
					<PanelGroup direction="vertical" className="gap-3">
						{/* Top section: video preview and controls */}
						<Panel defaultSize={70} maxSize={70} minSize={40}>
							<div
								ref={playerContainerRef}
								className={
									isFullscreen
										? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
										: "w-full h-full flex flex-col items-center justify-center bg-black/40 rounded-2xl border border-white/5 shadow-2xl overflow-hidden relative"
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
											videoPath={videoPath || ""}
											webcamVideoPath={webcamVideoPath || undefined}
											webcamLayoutPreset={webcamLayoutPreset}
											webcamMaskShape={webcamMaskShape}
											webcamSizePreset={webcamSizePreset}
											webcamPosition={webcamPosition}
											onWebcamPositionChange={(pos) => { pauseEditorHistory(); store.setWebcamPosition(pos); }}
											onWebcamPositionDragEnd={commitState}
											onDurationChange={setDuration}
											onTimeUpdate={setCurrentTime}
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
								<div className="w-full flex justify-center items-center h-12 flex-shrink-0 px-3 py-1.5 my-1.5">
									<div className="w-full max-w-[700px]">
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
										/>
									</div>
								</div>
							</div>
						</Panel>

						<PanelResizeHandle className="bg-[#09090b]/80 hover:bg-[#09090b] transition-colors rounded-full flex items-center justify-center">
							<div className="w-8 h-1 bg-white/20 rounded-full"></div>
						</PanelResizeHandle>

						{/* Timeline section */}
						<Panel defaultSize={30} maxSize={60} minSize={30}>
							<div className="h-full bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
								<TimelineEditor
									videoDuration={duration}
									currentTime={currentTime}
									onSeek={handleSeek}
									cursorTelemetry={cursorTelemetry}
									onAddChapter={handleAddChapter}
									onSelectChapter={handleSelectChapter}
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
				<div className="flex-[3] min-w-[280px] max-w-[420px] h-full">
					<SettingsPanel
						videoElement={videoPlaybackRef.current?.video || null}
						exportQuality={exportQuality}
						onExportQualityChange={setExportQuality}
						exportFormat={exportFormat}
						onExportFormatChange={setExportFormat}
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
						hasCursorTelemetry={cursorTelemetry.length > 0}
						videoDuration={duration}
						hasWebcam={Boolean(webcamVideoPath)}
					/>
				</div>
			</div>

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
