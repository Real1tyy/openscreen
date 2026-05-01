import { describe, expect, it } from "vitest";
import type { DeadZone, DetectionResult } from "./deadZoneDetection";
import { DEFAULT_DETECTION_CONFIG, DetectionConfigSchema } from "./deadZoneDetection";

describe("deadZoneDetection", () => {
	describe("DetectionConfigSchema", () => {
		it("parses empty object to defaults", () => {
			const config = DetectionConfigSchema.parse({});
			expect(config).toEqual(DEFAULT_DETECTION_CONFIG);
		});

		it("has expected default values", () => {
			expect(DEFAULT_DETECTION_CONFIG.silenceThresholdDb).toBe(-30);
			expect(DEFAULT_DETECTION_CONFIG.silenceMinDurationMs).toBe(500);
			expect(DEFAULT_DETECTION_CONFIG.freezeNoiseThreshold).toBe(0.003);
			expect(DEFAULT_DETECTION_CONFIG.freezeMinDurationMs).toBe(500);
			expect(DEFAULT_DETECTION_CONFIG.minDeadZoneMs).toBe(1000);
		});

		it("allows partial overrides", () => {
			const config = DetectionConfigSchema.parse({
				silenceThresholdDb: -25,
				minDeadZoneMs: 2000,
			});
			expect(config.silenceThresholdDb).toBe(-25);
			expect(config.minDeadZoneMs).toBe(2000);
			expect(config.freezeNoiseThreshold).toBe(0.003);
		});

		it("catches invalid values and falls back to defaults", () => {
			const config = DetectionConfigSchema.parse({
				silenceMinDurationMs: "not a number",
				freezeMinDurationMs: -5,
			});
			expect(config.silenceMinDurationMs).toBe(500);
			expect(config.freezeMinDurationMs).toBe(500);
		});
	});

	describe("type contracts", () => {
		const sampleMetrics = {
			silenceIntervalsFound: 3,
			freezeIntervalsFound: 5,
			effectiveSilenceThresholdDb: -28,
			audioNoiseFloorDb: -55,
			analysisDurationMs: 1234,
		};

		it("DetectionResult contains expected fields", () => {
			const result: DetectionResult = {
				deadZones: [
					{ startMs: 1000, endMs: 2000 },
					{ startMs: 5000, endMs: 7000 },
				],
				hasAudio: true,
				durationMs: 10000,
				metrics: sampleMetrics,
			};
			expect(result.deadZones).toHaveLength(2);
			expect(result.hasAudio).toBe(true);
			expect(result.durationMs).toBe(10000);
			expect(result.metrics.effectiveSilenceThresholdDb).toBe(-28);
		});

		it("handles empty dead zones result", () => {
			const result: DetectionResult = {
				deadZones: [],
				hasAudio: false,
				durationMs: 5000,
				metrics: { ...sampleMetrics, audioNoiseFloorDb: null },
			};
			expect(result.deadZones).toHaveLength(0);
			expect(result.metrics.audioNoiseFloorDb).toBeNull();
		});
	});

	describe("dead zone to trim region mapping", () => {
		it("dead zones convert to trim spans", () => {
			const zones: DeadZone[] = [
				{ startMs: 1500, endMs: 3000 },
				{ startMs: 6000, endMs: 8000 },
			];

			const trimSpans = zones.map((z) => ({ start: z.startMs, end: z.endMs }));
			expect(trimSpans).toEqual([
				{ start: 1500, end: 3000 },
				{ start: 6000, end: 8000 },
			]);
		});

		it("filters overlapping dead zones against existing trims", () => {
			const existingTrims = [{ startMs: 2000, endMs: 4000 }];
			const zones: DeadZone[] = [
				{ startMs: 1000, endMs: 2500 },
				{ startMs: 5000, endMs: 7000 },
			];

			const nonOverlapping = zones.filter(
				(zone) =>
					!existingTrims.some((trim) => zone.endMs > trim.startMs && zone.startMs < trim.endMs),
			);
			expect(nonOverlapping).toHaveLength(1);
			expect(nonOverlapping[0].startMs).toBe(5000);
		});

		it("all zones overlap existing trims", () => {
			const existingTrims = [
				{ startMs: 0, endMs: 5000 },
				{ startMs: 5000, endMs: 10000 },
			];
			const zones: DeadZone[] = [
				{ startMs: 1000, endMs: 2000 },
				{ startMs: 6000, endMs: 7000 },
			];

			const nonOverlapping = zones.filter(
				(zone) =>
					!existingTrims.some((trim) => zone.endMs > trim.startMs && zone.startMs < trim.endMs),
			);
			expect(nonOverlapping).toHaveLength(0);
		});
	});
});
