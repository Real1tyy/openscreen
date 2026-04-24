// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	detectZoomDwellCandidates,
	DWELL_MOVE_THRESHOLD,
	MAX_DWELL_DURATION_MS,
	MIN_DWELL_DURATION_MS,
	normalizeCursorTelemetry,
} from "./zoomSuggestionUtils";

describe("normalizeCursorTelemetry", () => {
	it("returns empty array for empty input", () => {
		expect(normalizeCursorTelemetry([], 10000)).toEqual([]);
	});

	it("filters out NaN samples", () => {
		const input = [
			{ timeMs: 100, cx: 0.5, cy: 0.5 },
			{ timeMs: NaN, cx: 0.5, cy: 0.5 },
			{ timeMs: 200, cx: NaN, cy: 0.5 },
			{ timeMs: 300, cx: 0.5, cy: NaN },
		];
		const result = normalizeCursorTelemetry(input, 10000);
		expect(result).toHaveLength(1);
		expect(result[0].timeMs).toBe(100);
	});

	it("filters out Infinity samples", () => {
		const input = [
			{ timeMs: 100, cx: 0.5, cy: 0.5 },
			{ timeMs: Infinity, cx: 0.5, cy: 0.5 },
		];
		const result = normalizeCursorTelemetry(input, 10000);
		expect(result).toHaveLength(1);
	});

	it("sorts samples by timeMs", () => {
		const input = [
			{ timeMs: 300, cx: 0.3, cy: 0.3 },
			{ timeMs: 100, cx: 0.1, cy: 0.1 },
			{ timeMs: 200, cx: 0.2, cy: 0.2 },
		];
		const result = normalizeCursorTelemetry(input, 10000);
		expect(result[0].timeMs).toBe(100);
		expect(result[1].timeMs).toBe(200);
		expect(result[2].timeMs).toBe(300);
	});

	it("clamps timeMs to [0, totalMs]", () => {
		const input = [
			{ timeMs: -50, cx: 0.5, cy: 0.5 },
			{ timeMs: 15000, cx: 0.5, cy: 0.5 },
		];
		const result = normalizeCursorTelemetry(input, 10000);
		expect(result[0].timeMs).toBe(0);
		expect(result[1].timeMs).toBe(10000);
	});

	it("clamps cx and cy to [0, 1]", () => {
		const input = [{ timeMs: 100, cx: -0.5, cy: 1.5 }];
		const result = normalizeCursorTelemetry(input, 10000);
		expect(result[0].cx).toBe(0);
		expect(result[0].cy).toBe(1);
	});

	it("does not mutate the original array", () => {
		const input = [
			{ timeMs: 200, cx: 0.5, cy: 0.5 },
			{ timeMs: 100, cx: 0.5, cy: 0.5 },
		];
		const original = [...input];
		normalizeCursorTelemetry(input, 10000);
		expect(input[0].timeMs).toBe(original[0].timeMs);
		expect(input[1].timeMs).toBe(original[1].timeMs);
	});
});

describe("detectZoomDwellCandidates", () => {
	it("returns empty for empty input", () => {
		expect(detectZoomDwellCandidates([])).toEqual([]);
	});

	it("returns empty for a single sample", () => {
		expect(detectZoomDwellCandidates([{ timeMs: 0, cx: 0.5, cy: 0.5 }])).toEqual([]);
	});

	function makeDwell(startMs: number, durationMs: number, cx: number, cy: number) {
		const count = 10;
		return Array.from({ length: count }, (_, i) => ({
			timeMs: startMs + (durationMs / (count - 1)) * i,
			cx: cx + (Math.random() - 0.5) * DWELL_MOVE_THRESHOLD * 0.5,
			cy: cy + (Math.random() - 0.5) * DWELL_MOVE_THRESHOLD * 0.5,
		}));
	}

	it("detects a dwell within duration range", () => {
		const samples = makeDwell(0, 600, 0.5, 0.5);
		const candidates = detectZoomDwellCandidates(samples);
		expect(candidates.length).toBeGreaterThanOrEqual(1);
		expect(candidates[0].centerTimeMs).toBeCloseTo(300, -2);
		expect(candidates[0].focus.cx).toBeCloseTo(0.5, 1);
		expect(candidates[0].focus.cy).toBeCloseTo(0.5, 1);
	});

	it("ignores dwells shorter than MIN_DWELL_DURATION_MS", () => {
		const samples = makeDwell(0, MIN_DWELL_DURATION_MS - 100, 0.5, 0.5);
		const candidates = detectZoomDwellCandidates(samples);
		expect(candidates).toHaveLength(0);
	});

	it("ignores dwells longer than MAX_DWELL_DURATION_MS", () => {
		const samples = makeDwell(0, MAX_DWELL_DURATION_MS + 500, 0.5, 0.5);
		const candidates = detectZoomDwellCandidates(samples);
		expect(candidates).toHaveLength(0);
	});

	it("detects multiple separate dwells", () => {
		const dwell1 = makeDwell(0, 600, 0.2, 0.2);
		const jump = [{ timeMs: 700, cx: 0.8, cy: 0.8 }];
		const dwell2 = makeDwell(800, 600, 0.8, 0.8);
		const samples = [...dwell1, ...jump, ...dwell2];
		const candidates = detectZoomDwellCandidates(samples);
		expect(candidates.length).toBeGreaterThanOrEqual(2);
	});

	it("breaks runs when movement exceeds threshold", () => {
		const samples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5 },
			{ timeMs: 200, cx: 0.5, cy: 0.5 },
			{ timeMs: 300, cx: 0.5 + DWELL_MOVE_THRESHOLD * 2, cy: 0.5 },
			{ timeMs: 500, cx: 0.5 + DWELL_MOVE_THRESHOLD * 2, cy: 0.5 },
		];
		const candidates = detectZoomDwellCandidates(samples);
		for (const c of candidates) {
			expect(c.strength).toBeLessThan(500);
		}
	});

	it("strength reflects dwell duration", () => {
		const samples = makeDwell(0, 800, 0.5, 0.5);
		const candidates = detectZoomDwellCandidates(samples);
		expect(candidates.length).toBeGreaterThanOrEqual(1);
		expect(candidates[0].strength).toBeGreaterThanOrEqual(MIN_DWELL_DURATION_MS);
		expect(candidates[0].strength).toBeLessThanOrEqual(MAX_DWELL_DURATION_MS);
	});
});
