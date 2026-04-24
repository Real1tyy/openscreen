// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatTimePadded } from "./timeUtils";

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
		// 6000 seconds = 100 minutes
		expect(formatTimePadded(6000)).toBe("100:00");
	});

	it("handles 59 seconds", () => {
		expect(formatTimePadded(59)).toBe("00:59");
	});

	it("handles decimal seconds (floating-point remainder preserved)", () => {
		// 90.7 % 60 produces 30.700000000000003 due to IEEE 754 float math
		const result = formatTimePadded(90.7);
		expect(result).toMatch(/^01:30\.7/);
	});

	it("formats exactly 10 minutes", () => {
		expect(formatTimePadded(600)).toBe("10:00");
	});
});
