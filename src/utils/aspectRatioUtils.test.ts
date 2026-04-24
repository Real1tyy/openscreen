// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	ASPECT_RATIOS,
	formatAspectRatioForCSS,
	getAspectRatioDimensions,
	getAspectRatioLabel,
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "./aspectRatioUtils";

describe("ASPECT_RATIOS", () => {
	it("contains expected entries", () => {
		expect(ASPECT_RATIOS).toContain("16:9");
		expect(ASPECT_RATIOS).toContain("9:16");
		expect(ASPECT_RATIOS).toContain("1:1");
		expect(ASPECT_RATIOS).toContain("4:3");
		expect(ASPECT_RATIOS).toContain("4:5");
		expect(ASPECT_RATIOS).toContain("16:10");
		expect(ASPECT_RATIOS).toContain("10:16");
		expect(ASPECT_RATIOS).toContain("native");
	});
});

describe("getAspectRatioValue", () => {
	it("returns 16/9 for 16:9", () => {
		expect(getAspectRatioValue("16:9")).toBeCloseTo(16 / 9, 10);
	});

	it("returns 9/16 for 9:16", () => {
		expect(getAspectRatioValue("9:16")).toBeCloseTo(9 / 16, 10);
	});

	it("returns 1 for 1:1", () => {
		expect(getAspectRatioValue("1:1")).toBe(1);
	});

	it("returns 4/3 for 4:3", () => {
		expect(getAspectRatioValue("4:3")).toBeCloseTo(4 / 3, 10);
	});

	it("returns 4/5 for 4:5", () => {
		expect(getAspectRatioValue("4:5")).toBeCloseTo(4 / 5, 10);
	});

	it("returns 16/10 for 16:10", () => {
		expect(getAspectRatioValue("16:10")).toBeCloseTo(16 / 10, 10);
	});

	it("returns 10/16 for 10:16", () => {
		expect(getAspectRatioValue("10:16")).toBeCloseTo(10 / 16, 10);
	});

	it("returns 16/9 fallback for native", () => {
		expect(getAspectRatioValue("native")).toBeCloseTo(16 / 9, 10);
	});
});

describe("getNativeAspectRatioValue", () => {
	it("returns width/height when no crop region", () => {
		expect(getNativeAspectRatioValue(1920, 1080)).toBeCloseTo(1920 / 1080, 10);
	});

	it("accounts for crop region dimensions", () => {
		const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
		// (1920 * 0.5) / (1080 * 0.5) = 960 / 540 = 16/9
		expect(getNativeAspectRatioValue(1920, 1080, crop)).toBeCloseTo(16 / 9, 10);
	});

	it("returns different ratio when crop changes aspect", () => {
		const crop = { x: 0, y: 0, width: 0.5, height: 1.0 };
		// (1920 * 0.5) / (1080 * 1.0) = 960/1080 = 8/9
		expect(getNativeAspectRatioValue(1920, 1080, crop)).toBeCloseTo(8 / 9, 10);
	});

	it("defaults crop to 1x1 when crop region is undefined", () => {
		expect(getNativeAspectRatioValue(800, 600)).toBeCloseTo(800 / 600, 10);
	});

	it("handles square video", () => {
		expect(getNativeAspectRatioValue(1000, 1000)).toBe(1);
	});

	it("handles portrait video", () => {
		expect(getNativeAspectRatioValue(1080, 1920)).toBeCloseTo(1080 / 1920, 10);
	});
});

describe("getAspectRatioDimensions", () => {
	it("returns correct dimensions for 16:9 at 1600 base width", () => {
		const dims = getAspectRatioDimensions("16:9", 1600);
		expect(dims.width).toBe(1600);
		expect(dims.height).toBeCloseTo(900, 0);
	});

	it("returns square dimensions for 1:1", () => {
		const dims = getAspectRatioDimensions("1:1", 500);
		expect(dims.width).toBe(500);
		expect(dims.height).toBe(500);
	});

	it("returns tall dimensions for portrait ratios", () => {
		const dims = getAspectRatioDimensions("9:16", 900);
		expect(dims.width).toBe(900);
		expect(dims.height).toBeCloseTo(1600, 0);
	});
});

describe("getAspectRatioLabel", () => {
	it("returns 'Native' for native", () => {
		expect(getAspectRatioLabel("native")).toBe("Native");
	});

	it("returns the ratio string itself for non-native values", () => {
		expect(getAspectRatioLabel("16:9")).toBe("16:9");
		expect(getAspectRatioLabel("9:16")).toBe("9:16");
		expect(getAspectRatioLabel("1:1")).toBe("1:1");
		expect(getAspectRatioLabel("4:3")).toBe("4:3");
		expect(getAspectRatioLabel("4:5")).toBe("4:5");
	});
});

describe("isPortraitAspectRatio", () => {
	it("returns false for landscape ratios", () => {
		expect(isPortraitAspectRatio("16:9")).toBe(false);
		expect(isPortraitAspectRatio("4:3")).toBe(false);
		expect(isPortraitAspectRatio("16:10")).toBe(false);
	});

	it("returns true for portrait ratios", () => {
		expect(isPortraitAspectRatio("9:16")).toBe(true);
		expect(isPortraitAspectRatio("4:5")).toBe(true);
		expect(isPortraitAspectRatio("10:16")).toBe(true);
	});

	it("returns false for square ratio", () => {
		expect(isPortraitAspectRatio("1:1")).toBe(false);
	});

	it("returns false for native (falls back to 16:9)", () => {
		expect(isPortraitAspectRatio("native")).toBe(false);
	});
});

describe("formatAspectRatioForCSS", () => {
	it("replaces colon with slash for standard ratios", () => {
		expect(formatAspectRatioForCSS("16:9")).toBe("16/9");
		expect(formatAspectRatioForCSS("9:16")).toBe("9/16");
		expect(formatAspectRatioForCSS("1:1")).toBe("1/1");
		expect(formatAspectRatioForCSS("4:3")).toBe("4/3");
	});

	it("returns native ratio as string when provided", () => {
		expect(formatAspectRatioForCSS("native", 1.5)).toBe("1.5");
	});

	it("falls back to 16/9 string for native without provided ratio", () => {
		expect(formatAspectRatioForCSS("native")).toBe(String(16 / 9));
	});
});
