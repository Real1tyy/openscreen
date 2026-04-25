// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeRegionSpan, computeNewRegionSpan } from "./regionUtils";

describe("normalizeRegionSpan", () => {
	it("returns null when region is already valid (no clamping needed)", () => {
		const result = normalizeRegionSpan({ startMs: 100, endMs: 500 }, 1000, 50);
		expect(result).toBeNull();
	});

	it("clamps startMs to 0 when negative", () => {
		const result = normalizeRegionSpan({ startMs: -100, endMs: 500 }, 1000, 50);
		expect(result).not.toBeNull();
		expect(result!.startMs).toBe(0);
	});

	it("clamps endMs to totalMs when exceeding", () => {
		const result = normalizeRegionSpan({ startMs: 100, endMs: 1500 }, 1000, 50);
		expect(result).not.toBeNull();
		expect(result!.endMs).toBe(1000);
	});

	it("enforces minimum duration", () => {
		const result = normalizeRegionSpan({ startMs: 100, endMs: 110 }, 1000, 200);
		expect(result).not.toBeNull();
		expect(result!.endMs - result!.startMs).toBeGreaterThanOrEqual(200);
	});

	it("handles region entirely outside bounds (startMs > totalMs)", () => {
		const result = normalizeRegionSpan({ startMs: 2000, endMs: 3000 }, 1000, 50);
		expect(result).not.toBeNull();
		// Start is pushed back to totalMs - minDurationMs
		expect(result!.startMs).toBe(950);
		// endMs may exceed totalMs to preserve minDuration
		expect(result!.endMs).toBe(1050);
	});

	it("handles zero-length region", () => {
		const result = normalizeRegionSpan({ startMs: 500, endMs: 500 }, 1000, 100);
		expect(result).not.toBeNull();
		// Should enforce minimum duration
		expect(result!.endMs - result!.startMs).toBeGreaterThanOrEqual(100);
	});

	it("handles region at exact boundaries (0 to totalMs)", () => {
		const result = normalizeRegionSpan({ startMs: 0, endMs: 1000 }, 1000, 50);
		expect(result).toBeNull();
	});

	it("handles edge case: totalMs less than minDurationMs", () => {
		// totalMs = 30, minDurationMs = 100
		const result = normalizeRegionSpan({ startMs: 0, endMs: 30 }, 30, 100);
		// The function should still return something clamped
		expect(result).not.toBeNull();
	});

	it("clamps both start and end when both are out of bounds", () => {
		const result = normalizeRegionSpan({ startMs: -50, endMs: 2000 }, 1000, 50);
		expect(result).not.toBeNull();
		expect(result!.startMs).toBe(0);
		expect(result!.endMs).toBe(1000);
	});

	it("adjusts start backward when region near end would violate minDuration", () => {
		// Region near end: start 980, end 990, totalMs 1000, minDuration 50
		const result = normalizeRegionSpan({ startMs: 980, endMs: 990 }, 1000, 50);
		expect(result).not.toBeNull();
		// Start pushed back to totalMs - minDurationMs = 950
		expect(result!.startMs).toBe(950);
		// endMs is max(minEnd=1030, clampedEnd=1000) = 1030
		// exceeds totalMs to preserve minDuration guarantee
		expect(result!.endMs).toBe(1030);
	});
});

describe("computeNewRegionSpan", () => {
	it("creates region with default duration when no other regions exist", () => {
		const result = computeNewRegionSpan([], 100, 500, 2000);
		expect(result.startMs).toBe(100);
		expect(result.endMs).toBe(600);
		expect(result.isOverlapping).toBe(false);
	});

	it("caps region end at next region's start", () => {
		const regions = [{ startMs: 400, endMs: 600 }];
		const result = computeNewRegionSpan(regions, 200, 500, 2000);
		expect(result.startMs).toBe(200);
		expect(result.endMs).toBe(400);
		expect(result.isOverlapping).toBe(false);
	});

	it("detects overlap when startPos is inside existing region", () => {
		const regions = [{ startMs: 100, endMs: 500 }];
		const result = computeNewRegionSpan(regions, 200, 300, 2000);
		expect(result.isOverlapping).toBe(true);
	});

	it("no overlap when startPos is between regions", () => {
		const regions = [
			{ startMs: 100, endMs: 300 },
			{ startMs: 700, endMs: 900 },
		];
		const result = computeNewRegionSpan(regions, 400, 200, 2000);
		expect(result.isOverlapping).toBe(false);
		expect(result.startMs).toBe(400);
		expect(result.endMs).toBe(600);
	});

	it("handles empty regions array", () => {
		const result = computeNewRegionSpan([], 0, 1000, 5000);
		expect(result.startMs).toBe(0);
		expect(result.endMs).toBe(1000);
		expect(result.isOverlapping).toBe(false);
	});

	it("caps end at totalMs when no next region", () => {
		const regions = [{ startMs: 100, endMs: 300 }];
		const result = computeNewRegionSpan(regions, 500, 2000, 1000);
		expect(result.startMs).toBe(500);
		expect(result.endMs).toBe(1000);
	});

	it("multiple regions sorted correctly regardless of input order", () => {
		const regions = [
			{ startMs: 800, endMs: 900 },
			{ startMs: 200, endMs: 400 },
			{ startMs: 500, endMs: 600 },
		];
		// Start at 410, default 500 — next region is at 500
		const result = computeNewRegionSpan(regions, 410, 500, 2000);
		expect(result.startMs).toBe(410);
		expect(result.endMs).toBe(500);
		expect(result.isOverlapping).toBe(false);
	});

	it("does not detect overlap when startPos equals region endMs (exclusive)", () => {
		const regions = [{ startMs: 100, endMs: 300 }];
		const result = computeNewRegionSpan(regions, 300, 200, 1000);
		expect(result.isOverlapping).toBe(false);
	});

	it("detects overlap when startPos equals region startMs", () => {
		const regions = [{ startMs: 100, endMs: 300 }];
		const result = computeNewRegionSpan(regions, 100, 200, 1000);
		expect(result.isOverlapping).toBe(true);
	});
});
