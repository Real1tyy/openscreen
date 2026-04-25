// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	clampFocusToScale,
	clampFocusToStage,
	softenFocusToScale,
	stageFocusToVideoSpace,
} from "./focusUtils";

describe("clampFocusToStage", () => {
	it("keeps center focus unchanged at any depth", () => {
		const result = clampFocusToStage({ cx: 0.5, cy: 0.5 }, 1);
		expect(result.cx).toBeCloseTo(0.5);
		expect(result.cy).toBeCloseTo(0.5);
	});

	it("clamps extreme focus values back into bounds", () => {
		const result = clampFocusToStage({ cx: -1, cy: 2 }, 3);
		expect(result.cx).toBeGreaterThanOrEqual(0);
		expect(result.cx).toBeLessThanOrEqual(1);
		expect(result.cy).toBeGreaterThanOrEqual(0);
		expect(result.cy).toBeLessThanOrEqual(1);
	});

	it("restricts focus more at higher depths (tighter bounds → closer to center)", () => {
		const low = clampFocusToStage({ cx: 0, cy: 0 }, 1);
		const high = clampFocusToStage({ cx: 0, cy: 0 }, 6);
		expect(high.cx).toBeCloseTo(0.1, 1);
		expect(high.cy).toBeCloseTo(0.1, 1);
		expect(low.cx).toBeCloseTo(0.4, 1);
		expect(low.cy).toBeCloseTo(0.4, 1);
	});

	it("returns value within [0, 1] for valid input", () => {
		const result = clampFocusToStage({ cx: 0.8, cy: 0.2 }, 4);
		expect(result.cx).toBeGreaterThanOrEqual(0);
		expect(result.cx).toBeLessThanOrEqual(1);
		expect(result.cy).toBeGreaterThanOrEqual(0);
		expect(result.cy).toBeLessThanOrEqual(1);
	});
});

describe("clampFocusToScale", () => {
	it("keeps center focus unchanged", () => {
		const result = clampFocusToScale({ cx: 0.5, cy: 0.5 }, 2);
		expect(result.cx).toBeCloseTo(0.5);
		expect(result.cy).toBeCloseTo(0.5);
	});

	it("clamps out-of-range focus", () => {
		const result = clampFocusToScale({ cx: -0.5, cy: 1.5 }, 2);
		expect(result.cx).toBeGreaterThanOrEqual(0);
		expect(result.cy).toBeLessThanOrEqual(1);
	});

	it("at scale=1 the entire range is valid", () => {
		const corner = clampFocusToScale({ cx: 0, cy: 0 }, 1);
		expect(corner.cx).toBeCloseTo(0.5);
		expect(corner.cy).toBeCloseTo(0.5);
	});

	it("applies viewport ratio to tighten horizontal bounds", () => {
		const wide = clampFocusToScale({ cx: 0, cy: 0.5 }, 2, { widthRatio: 2, heightRatio: 1 });
		const square = clampFocusToScale({ cx: 0, cy: 0.5 }, 2, { widthRatio: 1, heightRatio: 1 });
		expect(wide.cx).toBeGreaterThanOrEqual(square.cx);
	});
});

describe("softenFocusToScale", () => {
	it("keeps center focus unchanged", () => {
		const result = softenFocusToScale({ cx: 0.5, cy: 0.5 }, 2);
		expect(result.cx).toBeCloseTo(0.5);
		expect(result.cy).toBeCloseTo(0.5);
	});

	it("returns values within [0, 1]", () => {
		const result = softenFocusToScale({ cx: 0, cy: 1 }, 3);
		expect(result.cx).toBeGreaterThanOrEqual(0);
		expect(result.cx).toBeLessThanOrEqual(1);
		expect(result.cy).toBeGreaterThanOrEqual(0);
		expect(result.cy).toBeLessThanOrEqual(1);
	});

	it("softens edges compared to hard clamp", () => {
		const hard = clampFocusToScale({ cx: 0.9, cy: 0.9 }, 2);
		const soft = softenFocusToScale({ cx: 0.9, cy: 0.9 }, 2);
		expect(soft.cx).toBeLessThanOrEqual(hard.cx + 0.01);
		expect(soft.cy).toBeLessThanOrEqual(hard.cy + 0.01);
	});
});

describe("stageFocusToVideoSpace", () => {
	it("converts center-of-video focus correctly", () => {
		const result = stageFocusToVideoSpace(
			{ cx: 0.5, cy: 0.5 },
			{ width: 800, height: 600 },
			{ width: 1920, height: 1080 },
			0.4,
			{ x: 16, y: 24 },
		);
		const expectedX = (0.5 * 800 - 16) / (1920 * 0.4);
		const expectedY = (0.5 * 600 - 24) / (1080 * 0.4);
		expect(result.cx).toBeCloseTo(expectedX);
		expect(result.cy).toBeCloseTo(expectedY);
	});

	it("returns original focus when stage has zero width", () => {
		const focus = { cx: 0.3, cy: 0.7 };
		const result = stageFocusToVideoSpace(
			focus,
			{ width: 0, height: 600 },
			{ width: 1920, height: 1080 },
			1,
			{ x: 0, y: 0 },
		);
		expect(result).toEqual(focus);
	});

	it("returns original focus when video has zero dimensions", () => {
		const focus = { cx: 0.3, cy: 0.7 };
		const result = stageFocusToVideoSpace(
			focus,
			{ width: 800, height: 600 },
			{ width: 0, height: 0 },
			1,
			{ x: 0, y: 0 },
		);
		expect(result).toEqual(focus);
	});

	it("returns original focus when baseScale is 0", () => {
		const focus = { cx: 0.3, cy: 0.7 };
		const result = stageFocusToVideoSpace(
			focus,
			{ width: 800, height: 600 },
			{ width: 1920, height: 1080 },
			0,
			{ x: 0, y: 0 },
		);
		expect(result).toEqual(focus);
	});

	it("at scale=1 and zero offset, maps stage-normalized to video-normalized", () => {
		const result = stageFocusToVideoSpace(
			{ cx: 0.5, cy: 0.5 },
			{ width: 1920, height: 1080 },
			{ width: 1920, height: 1080 },
			1,
			{ x: 0, y: 0 },
		);
		expect(result.cx).toBeCloseTo(0.5);
		expect(result.cy).toBeCloseTo(0.5);
	});
});
