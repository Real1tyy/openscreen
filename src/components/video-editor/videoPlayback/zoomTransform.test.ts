// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	computeFocusFromTransform,
	computeZoomTransform,
	createMotionBlurState,
} from "./zoomTransform";

const stage = { width: 800, height: 600 };
const baseMask = { x: 50, y: 50, width: 700, height: 500 };

describe("createMotionBlurState", () => {
	it("returns a fresh uninitialized state", () => {
		const s = createMotionBlurState();
		expect(s.initialized).toBe(false);
		expect(s.lastFrameTimeMs).toBe(0);
		expect(s.prevCamX).toBe(0);
		expect(s.prevCamY).toBe(0);
		expect(s.prevCamScale).toBe(1);
	});
});

describe("computeZoomTransform", () => {
	it("returns identity when zoomScale is 1", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 1,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(t.scale).toBe(1);
		expect(t.x).toBe(0);
		expect(t.y).toBe(0);
	});

	it("returns identity for zero-dimension stage", () => {
		const t = computeZoomTransform({
			stageSize: { width: 0, height: 600 },
			baseMask,
			zoomScale: 2,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(t).toEqual({ scale: 1, x: 0, y: 0 });
	});

	it("returns identity for zero-dimension baseMask", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask: { x: 0, y: 0, width: 0, height: 500 },
			zoomScale: 2,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(t).toEqual({ scale: 1, x: 0, y: 0 });
	});

	it("computes correct transform at full zoom progress", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 2,
			zoomProgress: 1,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(t.scale).toBe(2);
		const expectedFocusPxX = baseMask.x + 0.5 * baseMask.width;
		const expectedFocusPxY = baseMask.y + 0.5 * baseMask.height;
		expect(t.x).toBeCloseTo(stage.width / 2 - expectedFocusPxX * 2);
		expect(t.y).toBeCloseTo(stage.height / 2 - expectedFocusPxY * 2);
	});

	it("interpolates scale with progress", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 3,
			zoomProgress: 0.5,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(t.scale).toBeCloseTo(2);
	});

	it("at progress=0 scale is 1 and position is 0", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 3,
			zoomProgress: 0,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(t.scale).toBe(1);
		expect(t.x).toBeCloseTo(0);
		expect(t.y).toBeCloseTo(0);
	});

	it("clamps progress to [0, 1]", () => {
		const atOne = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 2,
			zoomProgress: 1,
			focusX: 0.5,
			focusY: 0.5,
		});
		const overOne = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 2,
			zoomProgress: 5,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(overOne.scale).toBe(atOne.scale);
		expect(overOne.x).toBeCloseTo(atOne.x);
		expect(overOne.y).toBeCloseTo(atOne.y);
	});

	it("focuses on top-left corner when focus is (0,0)", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 2,
			focusX: 0,
			focusY: 0,
		});
		const focusPxX = baseMask.x;
		const focusPxY = baseMask.y;
		expect(t.x).toBeCloseTo(stage.width / 2 - focusPxX * 2);
		expect(t.y).toBeCloseTo(stage.height / 2 - focusPxY * 2);
	});

	it("focuses on bottom-right corner when focus is (1,1)", () => {
		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 2,
			focusX: 1,
			focusY: 1,
		});
		const focusPxX = baseMask.x + baseMask.width;
		const focusPxY = baseMask.y + baseMask.height;
		expect(t.x).toBeCloseTo(stage.width / 2 - focusPxX * 2);
		expect(t.y).toBeCloseTo(stage.height / 2 - focusPxY * 2);
	});
});

describe("computeFocusFromTransform", () => {
	it("returns center when given zero-dimension stage", () => {
		const f = computeFocusFromTransform({
			stageSize: { width: 0, height: 600 },
			baseMask,
			zoomScale: 2,
			x: 0,
			y: 0,
		});
		expect(f).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("returns center when given zero-dimension baseMask", () => {
		const f = computeFocusFromTransform({
			stageSize: stage,
			baseMask: { x: 0, y: 0, width: 0, height: 500 },
			zoomScale: 2,
			x: 0,
			y: 0,
		});
		expect(f).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("returns center when zoomScale is zero", () => {
		const f = computeFocusFromTransform({
			stageSize: stage,
			baseMask,
			zoomScale: 0,
			x: 0,
			y: 0,
		});
		expect(f).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("round-trips with computeZoomTransform at full progress", () => {
		const focusX = 0.3;
		const focusY = 0.7;
		const zoomScale = 2;

		const t = computeZoomTransform({
			stageSize: stage,
			baseMask,
			zoomScale,
			zoomProgress: 1,
			focusX,
			focusY,
		});

		const f = computeFocusFromTransform({
			stageSize: stage,
			baseMask,
			zoomScale,
			x: t.x,
			y: t.y,
		});

		expect(f.cx).toBeCloseTo(focusX, 5);
		expect(f.cy).toBeCloseTo(focusY, 5);
	});

	it("round-trips at different focus points", () => {
		for (const [fx, fy] of [[0, 0], [1, 1], [0.5, 0.5], [0.25, 0.75]]) {
			const t = computeZoomTransform({
				stageSize: stage,
				baseMask,
				zoomScale: 1.5,
				zoomProgress: 1,
				focusX: fx,
				focusY: fy,
			});
			const f = computeFocusFromTransform({
				stageSize: stage,
				baseMask,
				zoomScale: 1.5,
				x: t.x,
				y: t.y,
			});
			expect(f.cx).toBeCloseTo(fx, 5);
			expect(f.cy).toBeCloseTo(fy, 5);
		}
	});
});
