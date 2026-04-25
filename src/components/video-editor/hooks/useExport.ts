import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { EditorState } from "@/hooks/useEditorHistory";
import { getAssetPath } from "@/lib/assetPath";
import { getAPI, isTauri } from "@/lib/tauriBridge";
import {
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	VideoExporter,
} from "@/lib/exporter";
import { computeExportDimensions } from "@/lib/exporter/exportDimensions";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { formatChaptersForExport } from "../exportUtils";
import type { ChapterMarker, CursorTelemetryPoint } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseExportParams {
	videoPath: string | null;
	webcamVideoPath: string | null;
	editorState: EditorState;
	exportQuality: ExportQuality;
	exportFormat: ExportFormat;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
	isPlaying: boolean;
	videoPlaybackRef: React.RefObject<VideoPlaybackRef>;
	cursorTelemetry: CursorTelemetryPoint[];
	chapters: ChapterMarker[];
}

async function resolveWallpaperPath(wallpaper: string): Promise<string> {
	if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
		return getAssetPath(wallpaper.replace(/^\//, ""));
	}
	return wallpaper;
}

async function saveExportResult(
	blob: Blob,
	extension: string,
	formatLabel: "GIF" | "Video",
	onSaved: (label: "GIF" | "Video", path: string) => void,
	onUnsaved: (data: { arrayBuffer: ArrayBuffer; fileName: string; format: string }) => void,
	onError: (msg: string) => void,
	chapters?: ChapterMarker[],
	trimRegions?: EditorState["trimRegions"],
) {
	const arrayBuffer = await blob.arrayBuffer();
	const fileName = `export-${Date.now()}.${extension}`;
	const saveResult = await getAPI().saveExportedVideo(arrayBuffer, fileName);

	if (saveResult.canceled) {
		onUnsaved({ arrayBuffer, fileName, format: extension });
		toast.info("Export canceled");
	} else if (saveResult.success && saveResult.path) {
		onSaved(formatLabel, saveResult.path);
		if (extension === "mp4" && chapters && chapters.length > 0 && trimRegions) {
			const chaptersText = formatChaptersForExport(chapters, trimRegions);
			const chaptersPath = saveResult.path.replace(/\.mp4$/i, "-chapters.txt");
			getAPI().writeTextFile(chaptersPath, chaptersText).catch(() => {});
		}
	} else {
		const msg = saveResult.message || `Failed to save ${formatLabel}`;
		onError(msg);
		toast.error(msg);
	}
}

export function useExport({
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
}: UseExportParams) {
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
	const [unsavedExport, setUnsavedExport] = useState<{
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null>(null);
	const exporterRef = useRef<VideoExporter | null>(null);

	const {
		wallpaper, zoomRegions, trimRegions, speedRegions, annotationRegions,
		shadowIntensity, showBlur, motionBlurAmount, borderRadius, padding,
		cropRegion, aspectRatio, webcamLayoutPreset, webcamMaskShape, webcamSizePreset, webcamPosition,
	} = editorState;

	const handleShowExportedFile = useCallback(async (filePath: string) => {
		try {
			const result = await getAPI().revealInFolder(filePath);
			if (!result.success) {
				const msg = result.error || result.message || "Failed to reveal item in folder.";
				console.error("Failed to reveal in folder:", msg);
				toast.error(msg);
			}
		} catch (error) {
			const msg = String(error);
			console.error("Error calling revealInFolder IPC:", msg);
			toast.error(`Error revealing in folder: ${msg}`);
		}
	}, []);

	const handleExportSaved = useCallback(
		(formatLabel: "GIF" | "Video", filePath: string) => {
			setExportedFilePath(filePath);
			setUnsavedExport(null);
			toast.success(`${formatLabel} exported successfully`, {
				description: filePath,
				action: {
					label: "Show in Folder",
					onClick: () => void handleShowExportedFile(filePath),
				},
			});
		},
		[handleShowExportedFile],
	);

	const handleSaveUnsavedExport = useCallback(async () => {
		if (!unsavedExport) return;
		try {
			const saveResult = await getAPI().saveExportedVideo(
				unsavedExport.arrayBuffer,
				unsavedExport.fileName,
			);
			if (saveResult.canceled) {
				toast.info("Export canceled");
			} else if (saveResult.success && saveResult.path) {
				handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
			} else {
				toast.error(saveResult.message || "Failed to save export");
			}
		} catch (error) {
			console.error("Error saving unsaved export:", error);
			toast.error("Failed to save exported video");
		}
	}, [unsavedExport, handleExportSaved]);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) { toast.error("No video loaded"); return; }
			const video = videoPlaybackRef.current?.video;
			if (!video) { toast.error("Video not ready"); return; }

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);

			try {
				const wasPlaying = isPlaying;
				if (wasPlaying) videoPlaybackRef.current?.pause();

				const sourceWidth = video.videoWidth || 1920;
				const sourceHeight = video.videoHeight || 1080;
				const aspectRatioValue =
					aspectRatio === "native"
						? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
						: getAspectRatioValue(aspectRatio);

				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;

				const resolvedWallpaper = await resolveWallpaperPath(wallpaper);

				const commonConfig = {
					videoUrl: videoPath,
					webcamVideoUrl: webcamVideoPath || undefined,
					wallpaper: resolvedWallpaper,
					zoomRegions, trimRegions, speedRegions,
					showShadow: shadowIntensity > 0,
					shadowIntensity, showBlur, motionBlurAmount, borderRadius, padding,
					cropRegion, annotationRegions,
					webcamLayoutPreset, webcamMaskShape, webcamSizePreset, webcamPosition,
					previewWidth, previewHeight, cursorTelemetry,
					onProgress: (progress: ExportProgress) => setExportProgress(progress),
				};

				if (settings.format === "gif" && settings.gifConfig) {
					const gifExporter = new GifExporter({
						...commonConfig,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						videoPadding: padding,
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						await saveExportResult(
							result.blob, "gif", "GIF", handleExportSaved,
							(data) => setUnsavedExport(data),
							(msg) => setExportError(msg),
						);
					} else {
						setExportError(result.error || "GIF export failed");
						toast.error(result.error || "GIF export failed");
					}
				} else {
					const quality = settings.quality || exportQuality;
					const dims = computeExportDimensions(sourceWidth, sourceHeight, aspectRatioValue, quality);

					// Try NVENC hardware encoding in Tauri, fall back to WebCodecs
					let exported = false;
					let nvencFailReason: string | null = null;
					if (isTauri()) {
						try {
							const { NvencVideoExporter } = await import("@/lib/exporter/nvencExporter");
							const { tempDir } = await import("@tauri-apps/api/path");
							const dir = await tempDir();
							const tmpOutput = `${dir}openscreen-export-${Date.now()}.mp4`;

							const nvencExporter = new NvencVideoExporter({
								...commonConfig,
								width: dims.width,
								height: dims.height,
								frameRate: 60,
								bitrate: dims.bitrate,
								outputPath: tmpOutput,
							});

							exporterRef.current = nvencExporter as unknown as VideoExporter;
							const result = await nvencExporter.export();

							if (result.success && result.blob) {
								await saveExportResult(
									result.blob, "mp4", "Video", handleExportSaved,
									(data) => setUnsavedExport(data),
									(msg) => setExportError(msg),
									chapters, trimRegions,
								);
								exported = true;
							} else {
								nvencFailReason = result.error || "NVENC returned failure";
								console.warn("[Export] NVENC export failed, falling back:", nvencFailReason);
							}
						} catch (nvencError) {
							nvencFailReason = nvencError instanceof Error ? nvencError.message : String(nvencError);
							console.warn("[Export] NVENC path failed, falling back to WebCodecs:", nvencFailReason);
						}
					}

					if (!exported) {
						const exporter = new VideoExporter({
							...commonConfig,
							width: dims.width,
							height: dims.height,
							frameRate: 60,
							bitrate: dims.bitrate,
							codec: "avc1.640033",
						});

						exporterRef.current = exporter;
						const result = await exporter.export();

						if (result.success && result.blob) {
							await saveExportResult(
								result.blob, "mp4", "Video", handleExportSaved,
								(data) => setUnsavedExport(data),
								(msg) => setExportError(msg),
								chapters, trimRegions,
							);
						} else {
							const baseError = result.error || "Export failed";
							const fullError = nvencFailReason
								? `${baseError} (NVENC also failed: ${nvencFailReason})`
								: baseError;
							setExportError(fullError);
							toast.error(fullError);
						}
					}
				}

				if (wasPlaying) videoPlaybackRef.current?.play();
			} catch (error) {
				console.error("Export error:", error);
				const msg = error instanceof Error ? error.message : String(error);
				setExportError(msg);
				toast.error(`Export failed: ${msg}`);
			} finally {
				setIsExporting(false);
				exporterRef.current = null;
				setShowExportDialog(false);
				setExportProgress(null);
			}
		},
		[
			videoPath, webcamVideoPath, wallpaper, zoomRegions, trimRegions, speedRegions,
			shadowIntensity, showBlur, motionBlurAmount, borderRadius, padding,
			cropRegion, annotationRegions, isPlaying, aspectRatio,
			webcamLayoutPreset, webcamMaskShape, webcamSizePreset, webcamPosition,
			exportQuality, handleExportSaved, cursorTelemetry, chapters, videoPlaybackRef,
		],
	);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) { toast.error("No video loaded"); return; }
		const video = videoPlaybackRef.current?.video;
		if (!video) { toast.error("Video not ready"); return; }

		const sourceWidth = video.videoWidth || 1920;
		const sourceHeight = video.videoHeight || 1080;
		const aspectRatioValue =
			aspectRatio === "native"
				? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
				: getAspectRatioValue(aspectRatio);
		const gifDimensions = calculateOutputDimensions(
			sourceWidth, sourceHeight, gifSizePreset, GIF_SIZE_PRESETS, aspectRatioValue,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig: exportFormat === "gif"
				? {
					frameRate: gifFrameRate, loop: gifLoop, sizePreset: gifSizePreset,
					width: gifDimensions.width, height: gifDimensions.height,
				}
				: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);
		setExportedFilePath(null);
		handleExport(settings);
	}, [videoPath, exportFormat, exportQuality, gifFrameRate, gifLoop, gifSizePreset, aspectRatio, cropRegion, handleExport, videoPlaybackRef]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
		}
	}, []);

	return {
		isExporting,
		exportProgress,
		exportError,
		showExportDialog,
		setShowExportDialog,
		exportedFilePath,
		unsavedExport,
		handleOpenExportDialog,
		handleCancelExport,
		handleExportSaved,
		handleSaveUnsavedExport,
		handleShowExportedFile,
	};
}
