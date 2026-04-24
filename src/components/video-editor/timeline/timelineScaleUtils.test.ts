// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	calculateAxisScale,
	calculateTimelineScale,
	clampVisibleRange,
	createInitialRange,
	formatTimeLabel,
	normalizeWheelDelta,
} from "./timelineScaleUtils";

describe("calculateAxisScale", () => {
	it("returns smallest interval for very short visible range", () => {
		const result = calculateAxisScale(50);
		expect(result.intervalMs).toBe(50);
		expect(result.gridMs).toBe(10);
	});

	it("returns the largest interval for a very long visible range", () => {
		const result = calculateAxisScale(100_000_000);
		expect(result.intervalMs).toBe(3_600_000);
		expect(result.gridMs).toBe(300_000);
	});

	it("picks first candidate for zero visible range", () => {
		const result = calculateAxisScale(0);
		expect(result.intervalMs).toBe(50);
	});

	it("picks first candidate for negative visible range", () => {
		const result = calculateAxisScale(-100);
		expect(result.intervalMs).toBe(50);
	});

	it("returns a reasonable interval for a 10s video", () => {
		const result = calculateAxisScale(10_000);
		expect(result.intervalMs).toBe(1000);
		expect(result.gridMs).toBe(250);
	});

	it("returns a reasonable interval for a 60s video", () => {
		const result = calculateAxisScale(60_000);
		expect(result.intervalMs).toBe(5000);
		expect(result.gridMs).toBe(1000);
	});

	it("returns a reasonable interval for a 5min video", () => {
		const result = calculateAxisScale(300_000);
		expect(result.intervalMs).toBe(30_000);
		expect(result.gridMs).toBe(5000);
	});

	it("gridMs is always less than intervalMs", () => {
		for (const ms of [100, 500, 1000, 5000, 30000, 120000, 600000]) {
			const result = calculateAxisScale(ms);
			expect(result.gridMs).toBeLessThan(result.intervalMs);
		}
	});
});

describe("calculateTimelineScale", () => {
	it("returns correct config for a 60s video", () => {
		const config = calculateTimelineScale(60);
		expect(config.minItemDurationMs).toBe(100);
		expect(config.defaultItemDurationMs).toBe(3000);
		expect(config.minVisibleRangeMs).toBe(300);
	});

	it("computes 5% of video duration for short videos", () => {
		const config = calculateTimelineScale(5);
		expect(config.defaultItemDurationMs).toBe(250);
		expect(config.defaultItemDurationMs).toBeGreaterThanOrEqual(config.minItemDurationMs);
	});

	it("clamps defaultItemDurationMs to 30s maximum", () => {
		const config = calculateTimelineScale(3600);
		expect(config.defaultItemDurationMs).toBeLessThanOrEqual(30000);
	});

	it("defaults to 1s item duration for zero-duration video", () => {
		const config = calculateTimelineScale(0);
		expect(config.defaultItemDurationMs).toBe(1000);
	});

	it("defaults to 1s item duration for negative duration", () => {
		const config = calculateTimelineScale(-10);
		expect(config.defaultItemDurationMs).toBe(1000);
	});

	it("minItemDurationMs is always 100", () => {
		for (const dur of [0, 1, 10, 60, 3600]) {
			expect(calculateTimelineScale(dur).minItemDurationMs).toBe(100);
		}
	});

	it("minVisibleRangeMs is always 300", () => {
		for (const dur of [0, 1, 10, 60, 3600]) {
			expect(calculateTimelineScale(dur).minVisibleRangeMs).toBe(300);
		}
	});
});

describe("createInitialRange", () => {
	it("creates range [0, totalMs] for positive totalMs", () => {
		expect(createInitialRange(5000)).toEqual({ start: 0, end: 5000 });
	});

	it("falls back to [0, 1000] for zero totalMs", () => {
		expect(createInitialRange(0)).toEqual({ start: 0, end: 1000 });
	});

	it("falls back to [0, 1000] for negative totalMs", () => {
		expect(createInitialRange(-500)).toEqual({ start: 0, end: 1000 });
	});
});

describe("clampVisibleRange", () => {
	it("returns candidate unchanged when totalMs is zero", () => {
		const candidate = { start: 100, end: 500 };
		expect(clampVisibleRange(candidate, 0)).toEqual(candidate);
	});

	it("returns candidate unchanged when totalMs is negative", () => {
		const candidate = { start: 100, end: 500 };
		expect(clampVisibleRange(candidate, -100)).toEqual(candidate);
	});

	it("clamps to full range when span exceeds totalMs", () => {
		expect(clampVisibleRange({ start: 0, end: 10000 }, 5000)).toEqual({
			start: 0,
			end: 5000,
		});
	});

	it("shifts start back when range extends past end", () => {
		const result = clampVisibleRange({ start: 4500, end: 5500 }, 5000);
		expect(result.start).toBe(4000);
		expect(result.end).toBe(5000);
	});

	it("shifts start to 0 when start is negative", () => {
		const result = clampVisibleRange({ start: -100, end: 900 }, 5000);
		expect(result.start).toBe(0);
		expect(result.end).toBe(1000);
	});

	it("preserves span width when clamping", () => {
		const result = clampVisibleRange({ start: 4800, end: 5200 }, 5000);
		expect(result.end - result.start).toBe(400);
	});

	it("handles exact fit", () => {
		expect(clampVisibleRange({ start: 0, end: 5000 }, 5000)).toEqual({
			start: 0,
			end: 5000,
		});
	});
});

describe("normalizeWheelDelta", () => {
	it("returns delta unchanged for pixel mode (deltaMode=0)", () => {
		expect(normalizeWheelDelta(100, 0, 500)).toBe(100);
	});

	it("multiplies by 16 for line mode (deltaMode=1)", () => {
		expect(normalizeWheelDelta(3, 1, 500)).toBe(48);
	});

	it("multiplies by pageSizePx for page mode (deltaMode=2)", () => {
		expect(normalizeWheelDelta(2, 2, 800)).toBe(1600);
	});

	it("handles negative deltas", () => {
		expect(normalizeWheelDelta(-5, 1, 500)).toBe(-80);
	});
});

describe("formatTimeLabel", () => {
	it("formats 0ms at coarse interval", () => {
		expect(formatTimeLabel(0, 5000)).toBe("0:00");
	});

	it("formats 0ms at fine interval with 1 decimal", () => {
		expect(formatTimeLabel(0, 500)).toBe("0:00.0");
	});

	it("formats 0ms at very fine interval", () => {
		expect(formatTimeLabel(0, 50)).toBe("0:00.00");
	});

	it("formats 90 seconds with no fractional digits", () => {
		expect(formatTimeLabel(90_000, 5000)).toBe("1:30");
	});

	it("formats 90.5 seconds with 1 fractional digit", () => {
		expect(formatTimeLabel(90_500, 500)).toBe("1:30.5");
	});

	it("formats with hours when >= 3600s", () => {
		expect(formatTimeLabel(3_661_000, 5000)).toBe("1:01:01");
	});

	it("pads minutes and seconds in hour format", () => {
		expect(formatTimeLabel(3_600_000, 5000)).toBe("1:00:00");
	});

	it("formats sub-minute values", () => {
		expect(formatTimeLabel(5_000, 1000)).toBe("0:05");
	});

	it("formats sub-minute values with decimals", () => {
		expect(formatTimeLabel(5_500, 500)).toBe("0:05.5");
	});
});
