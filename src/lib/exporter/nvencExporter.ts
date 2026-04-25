import type {
	AnnotationRegion,
	CropRegion,
	SpeedRegion,
	TrimRegion,
	WebcamLayoutPreset,
	WebcamSizePreset,
	ZoomRegion,
} from "@/components/video-editor/types";
import { getNvencAPI } from "@/lib/tauriBridge";
import { AsyncVideoFrameQueue } from "./asyncVideoFrameQueue";
import { FrameRenderer } from "./frameRenderer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import type { ExportConfig, ExportProgress } from "./types";

interface NvencExporterConfig extends ExportConfig {
	videoUrl: string;
	webcamVideoUrl?: string;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	showBlur: boolean;
	motionBlurAmount?: number;
	borderRadius?: number;
	padding?: number;
	videoPadding?: number;
	cropRegion: CropRegion;
	webcamLayoutPreset?: WebcamLayoutPreset;
	webcamMaskShape?: import("@/components/video-editor/types").WebcamMaskShape;
	webcamSizePreset?: WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	annotationRegions?: AnnotationRegion[];
	previewWidth?: number;
	previewHeight?: number;
	cursorTelemetry?: import("@/components/video-editor/types").CursorTelemetryPoint[];
	onProgress?: (progress: ExportProgress) => void;
	outputPath: string;
}

export interface NvencExportResult {
	success: boolean;
	path?: string;
	error?: string;
}

export class NvencVideoExporter {
	private config: NvencExporterConfig;
	private cancelled = false;

	constructor(config: NvencExporterConfig) {
		this.config = config;
	}

	async export(): Promise<NvencExportResult> {
		const nvencAPI = getNvencAPI();
		if (!nvencAPI) {
			return { success: false, error: "NVENC API not available" };
		}

		this.cancelled = false;

		const decoder = new StreamingVideoDecoder();
		let renderer: FrameRenderer | null = null;
		let sessionId: string | null = null;
		let webcamDecoder: StreamingVideoDecoder | null = null;
		let webcamFrameQueue: AsyncVideoFrameQueue | null = null;

		try {
			const videoInfo = await decoder.loadMetadata(this.config.videoUrl);
			let webcamInfo = null;
			if (this.config.webcamVideoUrl) {
				webcamDecoder = new StreamingVideoDecoder();
				webcamInfo = await webcamDecoder.loadMetadata(this.config.webcamVideoUrl);
			}

			renderer = new FrameRenderer({
				width: this.config.width,
				height: this.config.height,
				wallpaper: this.config.wallpaper,
				zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow,
				shadowIntensity: this.config.shadowIntensity,
				showBlur: this.config.showBlur,
				motionBlurAmount: this.config.motionBlurAmount,
				borderRadius: this.config.borderRadius,
				padding: this.config.videoPadding ?? this.config.padding,
				cropRegion: this.config.cropRegion,
				videoWidth: videoInfo.width,
				videoHeight: videoInfo.height,
				webcamSize: webcamInfo ? { width: webcamInfo.width, height: webcamInfo.height } : null,
				webcamLayoutPreset: this.config.webcamLayoutPreset,
				webcamMaskShape: this.config.webcamMaskShape,
				webcamSizePreset: this.config.webcamSizePreset,
				webcamPosition: this.config.webcamPosition,
				annotationRegions: this.config.annotationRegions,
				speedRegions: this.config.speedRegions,
				previewWidth: this.config.previewWidth,
				previewHeight: this.config.previewHeight,
				cursorTelemetry: this.config.cursorTelemetry,
			});
			await renderer.initialize();

			const startResult = await nvencAPI.startNvencExport({
				width: this.config.width,
				height: this.config.height,
				fps: this.config.frameRate,
				bitrate: this.config.bitrate,
				outputPath: this.config.outputPath,
			});

			if (!startResult.success) {
				return { success: false, error: startResult.error || "Failed to start NVENC export" };
			}

			sessionId = startResult.sessionId;
			console.log(
				`[NvencExporter] Session started: ${sessionId}, NVENC: ${startResult.usingNvenc}`,
			);

			const effectiveDuration = decoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
			);
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
			let frameIndex = 0;

			console.log(`[NvencExporter] Total frames: ${totalFrames}`);

			webcamFrameQueue = this.config.webcamVideoUrl ? new AsyncVideoFrameQueue() : null;
			const webcamDecodePromise =
				webcamDecoder && webcamFrameQueue
					? (() => {
							const queue = webcamFrameQueue!;
							return webcamDecoder!.decodeAll(
								this.config.frameRate,
								this.config.trimRegions,
								this.config.speedRegions,
								async (frame) => {
									if (this.cancelled) return;
									await queue.enqueue(frame);
								},
							);
						})()
					: null;

			await decoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
					let webcamFrame: VideoFrame | null = null;
					try {
						if (this.cancelled) return;

						webcamFrame = webcamFrameQueue
							? await webcamFrameQueue.dequeue()
							: null;
						if (this.cancelled) return;

						const sourceTimestampUs = sourceTimestampMs * 1000;
						await renderer!.renderFrame(videoFrame, sourceTimestampUs, webcamFrame);

						const canvas = renderer!.getCanvas();
						const ctx = canvas.getContext("2d")!;
						const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

						const { writeFile } = await import("@tauri-apps/plugin-fs");
						const { tempDir } = await import("@tauri-apps/api/path");
						let dir = await tempDir();
						if (!dir.endsWith("/")) dir += "/";
						const framePath = `${dir}nvenc-frame-${frameIndex}.raw`;
						await writeFile(framePath, new Uint8Array(imageData.data.buffer));

						const result = await nvencAPI.feedFrame(
							sessionId!,
							framePath,
							canvas.width,
							canvas.height,
							frameIndex % 150 === 0,
						);

						if (!result.success) {
							throw new Error(result.error || "Failed to encode frame");
						}

						frameIndex++;

						this.config.onProgress?.({
							currentFrame: frameIndex,
							totalFrames,
							percentage: (frameIndex / totalFrames) * 100,
							estimatedTimeRemaining: 0,
						});
					} finally {
						videoFrame.close();
						webcamFrame?.close();
					}
				},
			);

			if (this.cancelled) {
				await nvencAPI.cancelExport(sessionId);
				return { success: false, error: "Export cancelled" };
			}

			webcamFrameQueue?.destroy();
			webcamDecoder?.cancel();
			if (webcamDecodePromise) await webcamDecodePromise;

			this.config.onProgress?.({
				currentFrame: totalFrames,
				totalFrames,
				percentage: 100,
				estimatedTimeRemaining: 0,
				phase: "finalizing",
			});

			const finishResult = await nvencAPI.finishExport(sessionId);
			sessionId = null;

			if (!finishResult.success) {
				return {
					success: false,
					error: finishResult.error || "Failed to finalize export",
				};
			}

			console.log(
				`[NvencExporter] Complete: ${finishResult.totalFrames} frames → ${finishResult.path}`,
			);

			// File is already on disk — return the path directly, no blob round-trip
			return { success: true, path: finishResult.path };
		} catch (error) {
			if (sessionId) {
				await nvencAPI.cancelExport(sessionId).catch(() => {});
			}
			const message = error instanceof Error ? error.message : String(error);
			console.error("[NvencExporter] Export failed:", message);
			return { success: false, error: message };
		} finally {
			renderer?.destroy();
			decoder.destroy();
			webcamFrameQueue?.destroy();
			webcamDecoder?.cancel();
		}
	}

	cancel(): void {
		this.cancelled = true;
	}
}
