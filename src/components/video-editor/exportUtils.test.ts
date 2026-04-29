// @vitest-environment node
import { describe, expect, it } from "vitest";
import { adjustMsForTrims, computeEffectiveMs, formatChaptersForExport } from "./exportUtils";
import type { ChapterMarker, SpeedRegion, TrimRegion } from "./types";

const ch = (startMs: number, endMs: number, name = ""): ChapterMarker => ({
	id: `ch-${startMs}`,
	startMs,
	endMs,
	name,
});

const trim = (startMs: number, endMs: number): TrimRegion => ({
	id: `t-${startMs}`,
	startMs,
	endMs,
});

const speed = (startMs: number, endMs: number, s: number): SpeedRegion => ({
	id: `s-${startMs}`,
	startMs,
	endMs,
	speed: s,
});

describe("computeEffectiveMs", () => {
	it("returns unchanged time with no trims or speed", () => {
		expect(computeEffectiveMs(10000, [], [])).toBe(10000);
	});

	it("subtracts full trim duration when trim is before", () => {
		expect(computeEffectiveMs(10000, [trim(2000, 5000)], [])).toBe(7000);
	});

	it("subtracts only the overlapping portion for partial overlap", () => {
		expect(computeEffectiveMs(8000, [trim(5000, 10000)], [])).toBe(5000);
	});

	it("does not adjust for trims after the time", () => {
		expect(computeEffectiveMs(5000, [], [speed(8000, 12000, 2)])).toBe(5000);
	});

	it("accumulates multiple trims", () => {
		expect(computeEffectiveMs(20000, [trim(2000, 5000), trim(8000, 12000)], [])).toBe(13000);
	});

	it("clamps to zero", () => {
		expect(computeEffectiveMs(3000, [trim(0, 5000)], [])).toBe(0);
	});

	it("compresses time for 2x speed region", () => {
		// 10s total, speed 2x from 0-10s → 5s effective
		expect(computeEffectiveMs(10000, [], [speed(0, 10000, 2)])).toBe(5000);
	});

	it("expands time for 0.5x speed region", () => {
		// 10s total, speed 0.5x from 0-10s → 20s effective
		expect(computeEffectiveMs(10000, [], [speed(0, 10000, 0.5)])).toBe(20000);
	});

	it("handles speed region in the middle", () => {
		// 20s total: 0-5s at 1x (5s) + 5-15s at 2x (5s) + 15-20s at 1x (5s) = 15s
		expect(computeEffectiveMs(20000, [], [speed(5000, 15000, 2)])).toBe(15000);
	});

	it("handles both trims and speed together", () => {
		// 30s total, trim 5-10s (removes 5s), speed 2x at 15-25s
		// Kept: 0-5s (5s at 1x=5s) + 10-15s (5s at 1x=5s) + 15-25s (10s at 2x=5s) + 25-30s (5s at 1x=5s) = 20s
		expect(computeEffectiveMs(30000, [trim(5000, 10000)], [speed(15000, 25000, 2)])).toBe(20000);
	});
});

describe("adjustMsForTrims", () => {
	it("delegates to computeEffectiveMs with empty speed regions", () => {
		expect(adjustMsForTrims(10000, [trim(2000, 5000)])).toBe(7000);
	});
});

describe("formatChaptersForExport", () => {
	it("formats a single chapter with no trims", () => {
		const result = formatChaptersForExport([ch(0, 5000, "Intro")], [], []);
		expect(result).toBe("0:00 Intro");
	});

	it("formats multiple chapters sorted by time", () => {
		const result = formatChaptersForExport(
			[ch(60000, 90000, "Second"), ch(0, 30000, "First")],
			[],
			[],
		);
		expect(result).toBe("0:00 First\n1:00 Second");
	});

	it("uses 'Untitled' for nameless chapters", () => {
		const result = formatChaptersForExport([ch(0, 5000)], [], []);
		expect(result).toBe("0:00 Untitled");
	});

	it("adjusts chapter time for a trim before it", () => {
		const result = formatChaptersForExport(
			[ch(10000, 15000, "After Trim")],
			[trim(2000, 5000)],
			[],
		);
		expect(result).toBe("0:07 After Trim");
	});

	it("adjusts for multiple trims before a chapter", () => {
		const result = formatChaptersForExport(
			[ch(20000, 25000, "Late")],
			[trim(2000, 5000), trim(8000, 12000)],
			[],
		);
		expect(result).toBe("0:13 Late");
	});

	it("adjusts for a trim partially overlapping the chapter start", () => {
		const result = formatChaptersForExport([ch(8000, 12000, "Mid")], [trim(5000, 10000)], []);
		expect(result).toBe("0:05 Mid");
	});

	it("does not adjust for trims after the chapter", () => {
		const result = formatChaptersForExport([ch(5000, 10000, "Early")], [trim(15000, 20000)], []);
		expect(result).toBe("0:05 Early");
	});

	it("formats hours when total exceeds 60 minutes", () => {
		const result = formatChaptersForExport([ch(3660000, 3700000, "Hour Mark")], [], []);
		expect(result).toBe("1:01:00 Hour Mark");
	});

	it("clamps adjusted time to 0", () => {
		const result = formatChaptersForExport([ch(3000, 6000, "Intro")], [trim(0, 5000)], []);
		expect(result).toBe("0:00 Intro");
	});

	it("handles empty chapter list", () => {
		expect(formatChaptersForExport([], [trim(0, 5000)], [])).toBe("");
	});

	it("adjusts chapters for speed regions", () => {
		// Chapter at 20s, speed 2x from 5-15s: 0-5s (5s) + 5-15s at 2x (5s) + 15-20s (5s) = 15s
		const result = formatChaptersForExport(
			[ch(20000, 25000, "After Speed")],
			[],
			[speed(5000, 15000, 2)],
		);
		expect(result).toBe("0:15 After Speed");
	});
});

describe("real-world scenario: 5min video with trims + speed + chapters", () => {
	// 5:00 video (300s), chapters 0:00-2:30 and 2:30-5:00
	// Trim 2:00-3:30 (removes 90s from the middle)
	// Speed 2x at 3:30-5:00 (90s plays in 45s)
	//
	// Timeline after trims+speed:
	//   Kept: 0:00-2:00 (120s at 1x = 120s) + 3:30-5:00 (90s at 2x = 45s)
	//   Total effective: 165s = 2:45
	//
	// Chapter 1 starts at 0:00 → effective 0:00 (untouched, before any trim/speed)
	// Chapter 2 starts at 2:30 → inside trimmed region (2:00-3:30)
	//   Kept segments up to 2:30: only 0:00-2:00 (120s at 1x) = 120s = 2:00
	//   The 2:00-2:30 portion is trimmed, so chapter 2 lands at effective 2:00
	// Chapter 1 ends at 2:30 → same as chapter 2 start = 2:00 effective
	// Chapter 2 ends at 5:00 → full video end = 2:45 effective

	const CHAPTERS = [ch(0, 150_000, "Intro"), ch(150_000, 300_000, "Main")];
	const TRIMS = [trim(120_000, 210_000)];
	const SPEEDS = [speed(210_000, 300_000, 2)];

	it("computes effective total duration as 2:45", () => {
		expect(computeEffectiveMs(300_000, TRIMS, SPEEDS)).toBe(165_000);
	});

	it("chapter 1 start (0:00) is unchanged", () => {
		expect(computeEffectiveMs(0, TRIMS, SPEEDS)).toBe(0);
	});

	it("chapter 1 end / chapter 2 start (2:30) maps to 2:00 effective", () => {
		// 2:30 is inside the trim (2:00-3:30), so only kept time up to 2:30 is 0:00-2:00 = 120s
		expect(computeEffectiveMs(150_000, TRIMS, SPEEDS)).toBe(120_000);
	});

	it("chapter 2 end (5:00) maps to 2:45 effective", () => {
		expect(computeEffectiveMs(300_000, TRIMS, SPEEDS)).toBe(165_000);
	});

	it("formatChaptersForExport produces correct YouTube timestamps", () => {
		const result = formatChaptersForExport(CHAPTERS, TRIMS, SPEEDS);
		expect(result).toBe("0:00 Intro\n2:00 Main");
	});

	it("a point right after trim end (3:30) maps to 2:00 effective", () => {
		expect(computeEffectiveMs(210_000, TRIMS, SPEEDS)).toBe(120_000);
	});

	it("midpoint of speed region (4:15 = 255s) maps correctly", () => {
		// 4:15 (255s): kept 0:00-2:00 (120s at 1x) + 3:30-4:15 (45s at 2x = 22.5s)
		// effective = 120_000 + 22_500 = 142_500ms
		expect(computeEffectiveMs(255_000, TRIMS, SPEEDS)).toBe(142_500);
	});

	it("right before trim (1:59) is effectively 1:59", () => {
		expect(computeEffectiveMs(119_000, TRIMS, SPEEDS)).toBe(119_000);
	});

	it("right at trim start (2:00) is effectively 2:00", () => {
		// 2:00 is the trim start — all time up to 2:00 is kept
		expect(computeEffectiveMs(120_000, TRIMS, SPEEDS)).toBe(120_000);
	});

	it("inside trim (2:45 = 165s) still maps to 2:00 effective", () => {
		// Everything from 2:00-3:30 is trimmed, so any point inside maps to 2:00
		expect(computeEffectiveMs(165_000, TRIMS, SPEEDS)).toBe(120_000);
	});
});
