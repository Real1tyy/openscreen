// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeExportDimensions } from "./exportDimensions";

function isEven(n: number) {
	return n % 2 === 0;
}

describe("computeExportDimensions", () => {
	describe("source quality", () => {
		it("produces even dimensions for 1920x1080 at 16:9", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "source");
			expect(isEven(r.width)).toBe(true);
			expect(isEven(r.height)).toBe(true);
			expect(r.bitrate).toBe(30_000_000);
		});

		it("produces square dimensions for aspect ratio 1:1", () => {
			const r = computeExportDimensions(1920, 1080, 1, "source");
			expect(r.width).toBe(r.height);
			expect(isEven(r.width)).toBe(true);
			expect(r.width).toBeLessThanOrEqual(1080);
		});

		it("handles landscape aspect ratio > 1", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "source");
			expect(r.width).toBeGreaterThan(r.height);
			expect(isEven(r.width)).toBe(true);
			expect(isEven(r.height)).toBe(true);
		});

		it("handles portrait aspect ratio < 1", () => {
			const r = computeExportDimensions(1080, 1920, 9 / 16, "source");
			expect(r.height).toBeGreaterThan(r.width);
			expect(isEven(r.width)).toBe(true);
			expect(isEven(r.height)).toBe(true);
		});

		it("selects higher bitrate for 4K source", () => {
			const r = computeExportDimensions(3840, 2160, 16 / 9, "source");
			expect(r.bitrate).toBe(80_000_000);
		});

		it("selects mid bitrate for 1440p source", () => {
			const r = computeExportDimensions(2560, 1440, 16 / 9, "source");
			expect(r.bitrate).toBe(50_000_000);
		});

		it("selects base bitrate for 1080p source", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "source");
			expect(r.bitrate).toBe(30_000_000);
		});

		it("finds exact even dimensions for common aspect ratios", () => {
			for (const ar of [16 / 9, 4 / 3, 16 / 10]) {
				const r = computeExportDimensions(1920, 1080, ar, "source");
				expect(isEven(r.width)).toBe(true);
				expect(isEven(r.height)).toBe(true);
			}
		});

		it("falls back gracefully for unusual aspect ratios", () => {
			const r = computeExportDimensions(1920, 1080, 2.39, "source");
			expect(isEven(r.width)).toBe(true);
			expect(isEven(r.height)).toBe(true);
			expect(r.width).toBeGreaterThan(0);
			expect(r.height).toBeGreaterThan(0);
		});
	});

	describe("good quality", () => {
		it("targets 1080p height", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "good");
			expect(r.height).toBe(1080);
			expect(isEven(r.width)).toBe(true);
		});

		it("maintains aspect ratio at 1080p", () => {
			const ar = 16 / 9;
			const r = computeExportDimensions(3840, 2160, ar, "good");
			expect(r.height).toBe(1080);
			const actualRatio = r.width / r.height;
			expect(Math.abs(actualRatio - ar)).toBeLessThan(0.02);
		});

		it("selects appropriate bitrate for 1080p", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "good");
			expect(r.bitrate).toBe(20_000_000);
		});

		it("produces even dimensions for portrait", () => {
			const r = computeExportDimensions(1080, 1920, 9 / 16, "good");
			expect(isEven(r.width)).toBe(true);
			expect(isEven(r.height)).toBe(true);
		});
	});

	describe("medium quality", () => {
		it("targets 720p height", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "medium");
			expect(r.height).toBe(720);
			expect(isEven(r.width)).toBe(true);
		});

		it("selects lower bitrate for 720p", () => {
			const r = computeExportDimensions(1920, 1080, 16 / 9, "medium");
			expect(r.bitrate).toBe(10_000_000);
		});

		it("produces even dimensions for 1:1", () => {
			const r = computeExportDimensions(1920, 1080, 1, "medium");
			expect(r.width).toBe(r.height);
			expect(isEven(r.width)).toBe(true);
		});
	});
});
