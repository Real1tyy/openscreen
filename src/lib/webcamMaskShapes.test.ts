import { describe, expect, it, vi } from "vitest";
import type { WebcamMaskShape } from "@/components/video-editor/types";
import { drawCanvasClipPath, getCssClipPath } from "./webcamMaskShapes";

describe("getCssClipPath", () => {
	it("returns circle clip-path for circle shape", () => {
		expect(getCssClipPath("circle")).toBe("circle(50% at 50% 50%)");
	});

	it("returns null for rectangle", () => {
		expect(getCssClipPath("rectangle")).toBeNull();
	});

	it("returns null for rounded", () => {
		expect(getCssClipPath("rounded")).toBeNull();
	});

	it("returns null for square", () => {
		expect(getCssClipPath("square")).toBeNull();
	});

	it("returns null for unknown shape", () => {
		expect(getCssClipPath("unknown" as WebcamMaskShape)).toBeNull();
	});
});

describe("drawCanvasClipPath", () => {
	function mockCtx() {
		return {
			beginPath: vi.fn(),
			closePath: vi.fn(),
			arc: vi.fn(),
			roundRect: vi.fn(),
		} as unknown as CanvasRenderingContext2D;
	}

	it("draws a circle arc for circle shape", () => {
		const ctx = mockCtx();
		drawCanvasClipPath(ctx, 10, 20, 100, 80, "circle", 0);

		expect(ctx.beginPath).toHaveBeenCalled();
		expect(ctx.arc).toHaveBeenCalledWith(60, 60, 40, 0, Math.PI * 2);
		expect(ctx.closePath).toHaveBeenCalled();
	});

	it("uses half of the smaller dimension as circle radius", () => {
		const ctx = mockCtx();
		drawCanvasClipPath(ctx, 0, 0, 200, 100, "circle", 0);
		expect(ctx.arc).toHaveBeenCalledWith(100, 50, 50, 0, Math.PI * 2);
	});

	it("draws roundRect for rectangle shape", () => {
		const ctx = mockCtx();
		drawCanvasClipPath(ctx, 10, 20, 100, 80, "rectangle", 5);
		expect(ctx.roundRect).toHaveBeenCalledWith(10, 20, 100, 80, 5);
	});

	it("draws roundRect for rounded shape", () => {
		const ctx = mockCtx();
		drawCanvasClipPath(ctx, 0, 0, 50, 50, "rounded", 12);
		expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 50, 50, 12);
	});

	it("draws roundRect for square shape", () => {
		const ctx = mockCtx();
		drawCanvasClipPath(ctx, 5, 5, 40, 40, "square", 8);
		expect(ctx.roundRect).toHaveBeenCalledWith(5, 5, 40, 40, 8);
	});

	it("falls back to roundRect for unknown shape", () => {
		const ctx = mockCtx();
		drawCanvasClipPath(ctx, 0, 0, 100, 100, "unknown" as WebcamMaskShape, 0);
		expect(ctx.roundRect).toHaveBeenCalled();
		expect(ctx.arc).not.toHaveBeenCalled();
	});
});
