// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	clamp01,
	cubicBezier,
	easeInOutCubic,
	easeOutCubic,
	easeOutExpo,
	easeOutScreenStudio,
	smoothStep,
} from "./mathUtils";

describe("clamp01", () => {
	it("returns the value when within [0, 1]", () => {
		expect(clamp01(0.5)).toBe(0.5);
	});

	it("returns 0 for negative values", () => {
		expect(clamp01(-0.5)).toBe(0);
		expect(clamp01(-100)).toBe(0);
	});

	it("returns 1 for values above 1", () => {
		expect(clamp01(1.5)).toBe(1);
		expect(clamp01(100)).toBe(1);
	});

	it("returns exactly 0 for 0", () => {
		expect(clamp01(0)).toBe(0);
	});

	it("returns exactly 1 for 1", () => {
		expect(clamp01(1)).toBe(1);
	});
});

describe("cubicBezier", () => {
	it("returns 0 when t is 0", () => {
		expect(cubicBezier(0.25, 0.1, 0.25, 1.0, 0)).toBeCloseTo(0, 5);
	});

	it("returns 1 when t is 1", () => {
		expect(cubicBezier(0.25, 0.1, 0.25, 1.0, 1)).toBeCloseTo(1, 5);
	});

	it("returns approximately 0.5 at midpoint for a symmetric curve", () => {
		// linear-ish: (0.25, 0.25, 0.75, 0.75)
		const result = cubicBezier(0.25, 0.25, 0.75, 0.75, 0.5);
		expect(result).toBeCloseTo(0.5, 1);
	});

	it("handles linear curve (0, 0, 1, 1)", () => {
		expect(cubicBezier(0, 0, 1, 1, 0.3)).toBeCloseTo(0.3, 2);
		expect(cubicBezier(0, 0, 1, 1, 0.7)).toBeCloseTo(0.7, 2);
	});

	it("handles ease-out curve producing values > t", () => {
		// Ease-out: fast start, slow end
		const result = cubicBezier(0, 0, 0.58, 1.0, 0.3);
		expect(result).toBeGreaterThan(0.3);
	});

	it("clamps t below 0 to behave as 0", () => {
		expect(cubicBezier(0.25, 0.1, 0.25, 1.0, -0.5)).toBeCloseTo(0, 5);
	});

	it("clamps t above 1 to behave as 1", () => {
		expect(cubicBezier(0.25, 0.1, 0.25, 1.0, 2.0)).toBeCloseTo(1, 5);
	});

	it("returns monotonically increasing values for standard curves", () => {
		const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
		const values = steps.map((t) => cubicBezier(0.25, 0.1, 0.25, 1.0, t));
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
		}
	});
});

describe("easeOutExpo", () => {
	it("returns 0 at t=0", () => {
		expect(easeOutExpo(0)).toBeCloseTo(0, 5);
	});

	it("returns 1 at t=1", () => {
		expect(easeOutExpo(1)).toBe(1);
	});

	it("returns value close to 1 at t=0.9", () => {
		expect(easeOutExpo(0.9)).toBeGreaterThan(0.98);
	});

	it("rises steeply at the start (ease-out behavior)", () => {
		const early = easeOutExpo(0.2);
		// Exponential ease out rises quickly
		expect(early).toBeGreaterThan(0.5);
	});

	it("clamps negative t to 0", () => {
		expect(easeOutExpo(-1)).toBeCloseTo(0, 5);
	});

	it("clamps t > 1 to 1", () => {
		expect(easeOutExpo(2)).toBe(1);
	});
});

describe("easeOutScreenStudio", () => {
	it("returns 0 at t=0", () => {
		expect(easeOutScreenStudio(0)).toBeCloseTo(0, 5);
	});

	it("returns 1 at t=1", () => {
		expect(easeOutScreenStudio(1)).toBeCloseTo(1, 5);
	});

	it("overshoots slightly in the middle due to y1=1", () => {
		// cubicBezier(0.16, 1, 0.3, 1, t) with y control points at 1
		// At mid-values the output should be near or above 1
		const mid = easeOutScreenStudio(0.5);
		expect(mid).toBeGreaterThan(0.9);
	});
});

describe("smoothStep", () => {
	it("returns 0 at t=0", () => {
		expect(smoothStep(0)).toBe(0);
	});

	it("returns 1 at t=1", () => {
		expect(smoothStep(1)).toBe(1);
	});

	it("returns 0.5 at t=0.5", () => {
		expect(smoothStep(0.5)).toBe(0.5);
	});

	it("clamps negative values to 0", () => {
		expect(smoothStep(-1)).toBe(0);
	});

	it("clamps values above 1 to 1", () => {
		expect(smoothStep(2)).toBe(1);
	});

	it("is monotonically increasing in [0, 1]", () => {
		let prev = 0;
		for (let i = 0; i <= 10; i++) {
			const val = smoothStep(i / 10);
			expect(val).toBeGreaterThanOrEqual(prev);
			prev = val;
		}
	});
});

describe("easeInOutCubic", () => {
	it("returns 0 at t=0", () => {
		expect(easeInOutCubic(0)).toBe(0);
	});

	it("returns 1 at t=1", () => {
		expect(easeInOutCubic(1)).toBe(1);
	});

	it("returns 0.5 at t=0.5", () => {
		expect(easeInOutCubic(0.5)).toBe(0.5);
	});

	it("accelerates in the first half (values < t)", () => {
		expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
	});

	it("decelerates in the second half (values > t)", () => {
		expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
	});

	it("clamps negative to 0", () => {
		expect(easeInOutCubic(-1)).toBe(0);
	});

	it("clamps above 1 to 1", () => {
		expect(easeInOutCubic(5)).toBe(1);
	});
});

describe("easeOutCubic", () => {
	it("returns 0 at t=0", () => {
		expect(easeOutCubic(0)).toBe(0);
	});

	it("returns 1 at t=1", () => {
		expect(easeOutCubic(1)).toBe(1);
	});

	it("rises faster than linear at early values", () => {
		expect(easeOutCubic(0.3)).toBeGreaterThan(0.3);
	});

	it("clamps negative to 0", () => {
		expect(easeOutCubic(-1)).toBe(0);
	});

	it("clamps above 1 to 1", () => {
		expect(easeOutCubic(2)).toBe(1);
	});

	it("is monotonically increasing", () => {
		let prev = 0;
		for (let i = 0; i <= 20; i++) {
			const val = easeOutCubic(i / 20);
			expect(val).toBeGreaterThanOrEqual(prev);
			prev = val;
		}
	});
});
