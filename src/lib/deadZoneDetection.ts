import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { isTauri } from "./tauriBridge";

const DeadZoneSchema = z.object({
	startMs: z.number(),
	endMs: z.number(),
});

export type DeadZone = z.infer<typeof DeadZoneSchema>;

export const DetectionConfigSchema = z.object({
	silenceThresholdDb: z.number().catch(-30).default(-30),
	silenceMinDurationMs: z.number().min(0).catch(500).default(500),
	freezeNoiseThreshold: z.number().min(0).catch(0.003).default(0.003),
	freezeMinDurationMs: z.number().min(0).catch(500).default(500),
	minDeadZoneMs: z.number().min(0).catch(1000).default(1000),
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = DetectionConfigSchema.parse({});

const DetectionMetricsSchema = z.object({
	silenceIntervalsFound: z.number(),
	freezeIntervalsFound: z.number(),
	effectiveSilenceThresholdDb: z.number(),
	audioNoiseFloorDb: z.number().nullable(),
	analysisDurationMs: z.number(),
});

export type DetectionMetrics = z.infer<typeof DetectionMetricsSchema>;

const DetectionResultSchema = z.object({
	deadZones: z.array(DeadZoneSchema),
	hasAudio: z.boolean(),
	durationMs: z.number(),
	metrics: DetectionMetricsSchema,
});

export type DetectionResult = z.infer<typeof DetectionResultSchema>;

const DetectionProgressSchema = z.object({
	phase: z.enum(["audio", "video"]),
	percent: z.number(),
});

export type DetectionProgress = z.infer<typeof DetectionProgressSchema>;

export async function listenDeadZoneProgress(
	callback: (progress: DetectionProgress) => void,
): Promise<() => void> {
	return listen<DetectionProgress>("dead-zone-progress", (event) => {
		callback(event.payload);
	});
}

export async function detectDeadZones(
	videoPath?: string,
	config?: Partial<DetectionConfig>,
): Promise<DetectionResult> {
	if (!isTauri()) {
		throw new Error("Dead zone detection requires the desktop app");
	}

	const fullConfig = DetectionConfigSchema.parse(config ?? {});

	return invoke<DetectionResult>("detect_dead_zones", {
		videoPath: videoPath ?? null,
		config: fullConfig,
	});
}
