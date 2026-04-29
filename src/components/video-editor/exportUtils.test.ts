// @vitest-environment node
import { describe, expect, it } from "vitest";
import { adjustMsForTrims, formatChaptersForExport } from "./exportUtils";
import type { ChapterMarker, TrimRegion } from "./types";

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

describe("formatChaptersForExport", () => {
	it("formats a single chapter with no trims", () => {
		const result = formatChaptersForExport([ch(0, 5000, "Intro")], []);
		expect(result).toBe("0:00 Intro");
	});

	it("formats multiple chapters sorted by time", () => {
		const result = formatChaptersForExport([ch(60000, 90000, "Second"), ch(0, 30000, "First")], []);
		expect(result).toBe("0:00 First\n1:00 Second");
	});

	it("uses 'Untitled' for nameless chapters", () => {
		const result = formatChaptersForExport([ch(0, 5000)], []);
		expect(result).toBe("0:00 Untitled");
	});

	it("adjusts chapter time for a trim before it", () => {
		const result = formatChaptersForExport([ch(10000, 15000, "After Trim")], [trim(2000, 5000)]);
		expect(result).toBe("0:07 After Trim");
	});

	it("adjusts for multiple trims before a chapter", () => {
		const result = formatChaptersForExport(
			[ch(20000, 25000, "Late")],
			[trim(2000, 5000), trim(8000, 12000)],
		);
		expect(result).toBe("0:13 Late");
	});

	it("adjusts for a trim partially overlapping the chapter start", () => {
		const result = formatChaptersForExport([ch(8000, 12000, "Mid")], [trim(5000, 10000)]);
		expect(result).toBe("0:05 Mid");
	});

	it("does not adjust for trims after the chapter", () => {
		const result = formatChaptersForExport([ch(5000, 10000, "Early")], [trim(15000, 20000)]);
		expect(result).toBe("0:05 Early");
	});

	it("formats hours when total exceeds 60 minutes", () => {
		const result = formatChaptersForExport([ch(3660000, 3700000, "Hour Mark")], []);
		expect(result).toBe("1:01:00 Hour Mark");
	});

	it("clamps adjusted time to 0", () => {
		const result = formatChaptersForExport([ch(3000, 6000, "Intro")], [trim(0, 5000)]);
		expect(result).toBe("0:00 Intro");
	});

	it("handles empty chapter list", () => {
		expect(formatChaptersForExport([], [trim(0, 5000)])).toBe("");
	});
});

describe("adjustMsForTrims", () => {
	it("returns unchanged time with no trims", () => {
		expect(adjustMsForTrims(10000, [])).toBe(10000);
	});

	it("subtracts full trim duration when trim is before", () => {
		expect(adjustMsForTrims(10000, [trim(2000, 5000)])).toBe(7000);
	});

	it("subtracts only the overlapping portion for partial overlap", () => {
		expect(adjustMsForTrims(8000, [trim(5000, 10000)])).toBe(5000);
	});

	it("does not adjust for trims after the time", () => {
		expect(adjustMsForTrims(5000, [trim(8000, 12000)])).toBe(5000);
	});

	it("accumulates multiple trims", () => {
		expect(adjustMsForTrims(20000, [trim(2000, 5000), trim(8000, 12000)])).toBe(13000);
	});

	it("clamps to zero", () => {
		expect(adjustMsForTrims(3000, [trim(0, 5000)])).toBe(0);
	});
});
