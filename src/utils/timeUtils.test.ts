// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatMsCompact, formatTimePadded, formatTimePlayback } from "./timeUtils";

describe("formatTimePadded", () => {
	it("formats 0 seconds as 00:00", () => {
		expect(formatTimePadded(0)).toBe("00:00");
	});

	it("formats single-digit seconds with padding", () => {
		expect(formatTimePadded(5)).toBe("00:05");
	});

	it("formats double-digit seconds", () => {
		expect(formatTimePadded(30)).toBe("00:30");
	});

	it("formats exactly 60 seconds as 01:00", () => {
		expect(formatTimePadded(60)).toBe("01:00");
	});

	it("formats 61 seconds as 01:01", () => {
		expect(formatTimePadded(61)).toBe("01:01");
	});

	it("formats minutes and seconds correctly", () => {
		expect(formatTimePadded(125)).toBe("02:05");
	});

	it("pads single-digit minutes", () => {
		expect(formatTimePadded(300)).toBe("05:00");
	});

	it("handles large values beyond 99 minutes", () => {
		expect(formatTimePadded(6000)).toBe("100:00");
	});

	it("handles 59 seconds", () => {
		expect(formatTimePadded(59)).toBe("00:59");
	});

	it("handles decimal seconds (floating-point remainder preserved)", () => {
		const result = formatTimePadded(90.7);
		expect(result).toMatch(/^01:30\.7/);
	});

	it("formats exactly 10 minutes", () => {
		expect(formatTimePadded(600)).toBe("10:00");
	});
});

describe("formatTimePlayback", () => {
	it("formats 0 seconds", () => {
		expect(formatTimePlayback(0)).toBe("0:00");
	});

	it("formats seconds with floor", () => {
		expect(formatTimePlayback(5.9)).toBe("0:05");
	});

	it("formats minutes and seconds", () => {
		expect(formatTimePlayback(65)).toBe("1:05");
	});

	it("returns 0:00 for NaN", () => {
		expect(formatTimePlayback(NaN)).toBe("0:00");
	});

	it("returns 0:00 for Infinity", () => {
		expect(formatTimePlayback(Infinity)).toBe("0:00");
	});

	it("returns 0:00 for negative values", () => {
		expect(formatTimePlayback(-5)).toBe("0:00");
	});

	it("pads seconds to 2 digits", () => {
		expect(formatTimePlayback(3)).toBe("0:03");
	});

	it("handles exact minute boundaries", () => {
		expect(formatTimePlayback(120)).toBe("2:00");
	});
});

describe("formatMsCompact", () => {
	it("formats sub-minute as Xs", () => {
		expect(formatMsCompact(2300)).toBe("2.3s");
	});

	it("formats zero", () => {
		expect(formatMsCompact(0)).toBe("0.0s");
	});

	it("formats sub-second values", () => {
		expect(formatMsCompact(500)).toBe("0.5s");
	});

	it("formats over a minute with M:SS.s", () => {
		expect(formatMsCompact(62300)).toBe("1:02.3");
	});

	it("pads seconds to 4 chars after minute", () => {
		expect(formatMsCompact(61000)).toBe("1:01.0");
	});

	it("formats exact minute boundary", () => {
		expect(formatMsCompact(60000)).toBe("1:00.0");
	});

	it("handles large values", () => {
		expect(formatMsCompact(600000)).toBe("10:00.0");
	});
});
