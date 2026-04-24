// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	adaptiveSmoothFactor,
	interpolateCursorAt,
	smoothCursorFocus,
} from "./cursorFollowUtils";

describe("interpolateCursorAt", () => {
	it("returns null for empty telemetry", () => {
		expect(interpolateCursorAt([], 500)).toBeNull();
	});

	it("returns first point when time is before all samples", () => {
		const telemetry = [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 200, cx: 0.8, cy: 0.9 },
		];
		const result = interpolateCursorAt(telemetry, 50);
		expect(result).toEqual({ cx: 0.2, cy: 0.3 });
	});

	it("returns first point when time equals first sample", () => {
		const telemetry = [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 200, cx: 0.8, cy: 0.9 },
		];
		const result = interpolateCursorAt(telemetry, 100);
		expect(result).toEqual({ cx: 0.2, cy: 0.3 });
	});

	it("returns last point when time is after all samples", () => {
		const telemetry = [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 200, cx: 0.8, cy: 0.9 },
		];
		const result = interpolateCursorAt(telemetry, 300);
		expect(result).toEqual({ cx: 0.8, cy: 0.9 });
	});

	it("returns last point when time equals last sample", () => {
		const telemetry = [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 200, cx: 0.8, cy: 0.9 },
		];
		const result = interpolateCursorAt(telemetry, 200);
		expect(result).toEqual({ cx: 0.8, cy: 0.9 });
	});

	it("linearly interpolates between two samples", () => {
		const telemetry = [
			{ timeMs: 0, cx: 0.0, cy: 0.0 },
			{ timeMs: 100, cx: 1.0, cy: 1.0 },
		];
		const result = interpolateCursorAt(telemetry, 50);
		expect(result!.cx).toBeCloseTo(0.5);
		expect(result!.cy).toBeCloseTo(0.5);
	});

	it("interpolates at 25% between two samples", () => {
		const telemetry = [
			{ timeMs: 0, cx: 0.0, cy: 0.0 },
			{ timeMs: 100, cx: 1.0, cy: 0.8 },
		];
		const result = interpolateCursorAt(telemetry, 25);
		expect(result!.cx).toBeCloseTo(0.25);
		expect(result!.cy).toBeCloseTo(0.2);
	});

	it("handles a single telemetry point", () => {
		const telemetry = [{ timeMs: 100, cx: 0.5, cy: 0.5 }];
		expect(interpolateCursorAt(telemetry, 50)).toEqual({ cx: 0.5, cy: 0.5 });
		expect(interpolateCursorAt(telemetry, 100)).toEqual({ cx: 0.5, cy: 0.5 });
		expect(interpolateCursorAt(telemetry, 200)).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("binary searches correctly across many samples", () => {
		const telemetry = Array.from({ length: 100 }, (_, i) => ({
			timeMs: i * 10,
			cx: i / 100,
			cy: 1 - i / 100,
		}));
		const result = interpolateCursorAt(telemetry, 505);
		expect(result!.cx).toBeCloseTo(0.505, 2);
		expect(result!.cy).toBeCloseTo(1 - 0.505, 2);
	});

	it("handles coincident sample times without dividing by zero", () => {
		const telemetry = [
			{ timeMs: 100, cx: 0.2, cy: 0.3 },
			{ timeMs: 100, cx: 0.8, cy: 0.9 },
		];
		const result = interpolateCursorAt(telemetry, 100);
		expect(result).not.toBeNull();
		expect(Number.isFinite(result!.cx)).toBe(true);
		expect(Number.isFinite(result!.cy)).toBe(true);
	});
});

describe("smoothCursorFocus", () => {
	it("returns prev when factor is 0 (no movement)", () => {
		const result = smoothCursorFocus({ cx: 1, cy: 1 }, { cx: 0, cy: 0 }, 0);
		expect(result).toEqual({ cx: 0, cy: 0 });
	});

	it("returns raw when factor is 1 (instant)", () => {
		const result = smoothCursorFocus({ cx: 1, cy: 1 }, { cx: 0, cy: 0 }, 1);
		expect(result).toEqual({ cx: 1, cy: 1 });
	});

	it("interpolates with factor 0.5", () => {
		const result = smoothCursorFocus({ cx: 1, cy: 0 }, { cx: 0, cy: 1 }, 0.5);
		expect(result.cx).toBeCloseTo(0.5);
		expect(result.cy).toBeCloseTo(0.5);
	});

	it("returns prev when raw equals prev", () => {
		const focus = { cx: 0.3, cy: 0.7 };
		const result = smoothCursorFocus(focus, focus, 0.5);
		expect(result.cx).toBeCloseTo(0.3);
		expect(result.cy).toBeCloseTo(0.7);
	});
});

describe("adaptiveSmoothFactor", () => {
	it("returns minFactor when raw equals prev (zero distance)", () => {
		const focus = { cx: 0.5, cy: 0.5 };
		expect(adaptiveSmoothFactor(focus, focus, 0.1, 0.9, 0.5)).toBeCloseTo(0.1);
	});

	it("returns maxFactor when distance >= rampDistance", () => {
		const raw = { cx: 1, cy: 1 };
		const prev = { cx: 0, cy: 0 };
		const result = adaptiveSmoothFactor(raw, prev, 0.1, 0.9, 0.1);
		expect(result).toBeCloseTo(0.9);
	});

	it("returns value between min and max for partial distance", () => {
		const raw = { cx: 0.5, cy: 0.5 };
		const prev = { cx: 0.5, cy: 0.0 };
		const result = adaptiveSmoothFactor(raw, prev, 0.1, 0.9, 1.0);
		expect(result).toBeGreaterThan(0.1);
		expect(result).toBeLessThan(0.9);
	});

	it("scales linearly with distance", () => {
		const prev = { cx: 0, cy: 0 };
		const halfRamp = adaptiveSmoothFactor({ cx: 0.25, cy: 0 }, prev, 0, 1, 0.5);
		expect(halfRamp).toBeCloseTo(0.5);
	});
});
