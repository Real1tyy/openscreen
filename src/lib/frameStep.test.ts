// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeFrameStepTime, FRAME_DURATION_SEC } from "./frameStep";

describe("FRAME_DURATION_SEC", () => {
	it("should be approximately 1/60", () => {
		expect(FRAME_DURATION_SEC).toBeCloseTo(1 / 60, 10);
	});
});

describe("computeFrameStepTime", () => {
	const duration = 10;

	describe("forward stepping", () => {
		it("advances by one frame from 0", () => {
			const result = computeFrameStepTime(0, duration, "forward");
			expect(result).toBeCloseTo(FRAME_DURATION_SEC, 10);
		});

		it("advances by one frame from a mid-point", () => {
			const result = computeFrameStepTime(5, duration, "forward");
			expect(result).toBeCloseTo(5 + FRAME_DURATION_SEC, 10);
		});

		it("clamps at the duration when stepping past the end", () => {
			const result = computeFrameStepTime(duration, duration, "forward");
			expect(result).toBe(duration);
		});

		it("clamps at duration when one frame away from end", () => {
			const almostEnd = duration - FRAME_DURATION_SEC / 2;
			const result = computeFrameStepTime(almostEnd, duration, "forward");
			expect(result).toBe(duration);
		});
	});

	describe("backward stepping", () => {
		it("steps back by one frame from a mid-point", () => {
			const result = computeFrameStepTime(5, duration, "backward");
			expect(result).toBeCloseTo(5 - FRAME_DURATION_SEC, 10);
		});

		it("clamps at 0 when stepping back from 0", () => {
			const result = computeFrameStepTime(0, duration, "backward");
			expect(result).toBe(0);
		});

		it("clamps at 0 when stepping back from less than one frame", () => {
			const result = computeFrameStepTime(FRAME_DURATION_SEC / 2, duration, "backward");
			expect(result).toBe(0);
		});

		it("steps backward from the end of the video", () => {
			const result = computeFrameStepTime(duration, duration, "backward");
			expect(result).toBeCloseTo(duration - FRAME_DURATION_SEC, 10);
		});
	});

	describe("edge cases", () => {
		it("handles zero duration", () => {
			expect(computeFrameStepTime(0, 0, "forward")).toBe(0);
			expect(computeFrameStepTime(0, 0, "backward")).toBe(0);
		});

		it("handles very small duration", () => {
			const tinyDuration = FRAME_DURATION_SEC / 10;
			const result = computeFrameStepTime(0, tinyDuration, "forward");
			expect(result).toBe(tinyDuration);
		});

		it("handles very large current time values", () => {
			const result = computeFrameStepTime(100000, 100000, "backward");
			expect(result).toBeCloseTo(100000 - FRAME_DURATION_SEC, 10);
		});

		it("clamps negative current time to 0 on backward step", () => {
			// currentTime + (-delta) = negative, should clamp to 0
			const result = computeFrameStepTime(-1, duration, "backward");
			expect(result).toBe(0);
		});

		it("handles current time already beyond duration on forward step", () => {
			// If currentTime > duration somehow, forward clamps to duration
			const result = computeFrameStepTime(duration + 1, duration, "forward");
			expect(result).toBe(duration);
		});
	});
});
