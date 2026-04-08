import { useEffect, useRef } from "react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import { StreamingVideoDecoder } from "@/lib/exporter/streamingDecoder";
import { VideoExporter } from "@/lib/exporter/videoExporter";

export default function HeadlessExport() {
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		runExport();
	}, []);

	return null;
}

async function runExport() {
	try {
		const config = await window.electronAPI.getHeadlessExportConfig();
		if (!config) {
			await window.electronAPI.sendHeadlessExportDone({
				success: false,
				error: "No export config received",
			});
			return;
		}

		// Probe video metadata to determine dimensions
		const videoUrl = toFileUrl(config.inputFile);
		const probe = new StreamingVideoDecoder();
		const videoInfo = await probe.loadMetadata(videoUrl);
		probe.destroy();

		// Calculate export dimensions
		const { width: exportWidth, height: exportHeight } = resolveExportDimensions(
			config,
			videoInfo.width,
			videoInfo.height,
		);

		// Calculate bitrate if not specified
		const bitrate = resolveBitrate(config.bitrate, exportWidth, exportHeight);

		// Resolve background — convert relative wallpaper paths to absolute URLs
		const background = await resolveBackground(config.background);

		const exporter = new VideoExporter({
			videoUrl,
			width: exportWidth,
			height: exportHeight,
			frameRate: config.fps,
			bitrate,
			codec: "avc1.640033",
			wallpaper: background,
			zoomRegions: [],
			trimRegions: [],
			speedRegions: [],
			showShadow: config.shadow,
			shadowIntensity: config.shadowIntensity,
			showBlur: config.blur,
			motionBlurAmount: config.motionBlur,
			borderRadius: config.roundness,
			padding: config.padding,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			annotationRegions: [],
			previewWidth: exportWidth,
			previewHeight: exportHeight,
			onProgress: (progress) => {
				window.electronAPI.sendHeadlessExportProgress(progress.percentage);
			},
		});

		const result = await exporter.export();

		if (result.success && result.blob) {
			const arrayBuffer = await result.blob.arrayBuffer();
			await window.electronAPI.sendHeadlessExportDone({
				success: true,
				data: arrayBuffer,
			});
		} else {
			await window.electronAPI.sendHeadlessExportDone({
				success: false,
				error: result.error || "Export failed",
			});
		}
	} catch (error) {
		await window.electronAPI.sendHeadlessExportDone({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function resolveExportDimensions(
	config: HeadlessExportConfig,
	sourceWidth: number,
	sourceHeight: number,
): { width: number; height: number } {
	if (config.resolution) {
		return config.resolution;
	}

	// Use source resolution, ensure even dimensions
	return {
		width: Math.floor(sourceWidth / 2) * 2,
		height: Math.floor(sourceHeight / 2) * 2,
	};
}

function resolveBitrate(configBitrate: number | null, width: number, height: number): number {
	if (configBitrate) return configBitrate;

	const totalPixels = width * height;
	if (totalPixels > 2560 * 1440) return 80_000_000;
	if (totalPixels > 1920 * 1080) return 50_000_000;
	return 30_000_000;
}

async function resolveBackground(background: string): Promise<string> {
	// If it's a hex color or gradient, use as-is
	if (
		background.startsWith("#") ||
		background.startsWith("linear-gradient") ||
		background.startsWith("radial-gradient") ||
		background.startsWith("http") ||
		background.startsWith("data:")
	) {
		return background;
	}

	// If it's a relative wallpaper path (e.g. /wallpapers/wallpaper1.jpg),
	// resolve it relative to the app's assets
	if (background.startsWith("/")) {
		const basePath = await window.electronAPI.getAssetBasePath();
		if (basePath) {
			// basePath is like file:///path/to/assets/ — the wallpaper paths
			// are stored as /wallpapers/X.jpg, so strip the leading slash
			return basePath + background.slice(1);
		}
		// In dev mode, relative paths work as-is via the dev server
		return background;
	}

	return background;
}
