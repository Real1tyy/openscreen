import { describe, expect, it } from "vitest";
import { ZOOM_DEPTH_SCALES, type ZoomRegion } from "../types";
import { updateOverlayIndicator } from "./overlayUtils";

function makeDiv(width: number, height: number): HTMLDivElement {
	const el = document.createElement("div");
	Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
	Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
	return el;
}

function makeRegion(overrides: Partial<ZoomRegion> = {}): ZoomRegion {
	return {
		id: "z1",
		startMs: 0,
		endMs: 5000,
		depth: 3,
		focus: { cx: 0.5, cy: 0.5 },
		focusMode: "manual",
		...overrides,
	};
}

describe("updateOverlayIndicator", () => {
	it("hides indicator when region is null", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: null,
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("none");
	});

	it("hides indicator when focusMode is auto", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: makeRegion({ focusMode: "auto" }),
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("none");
	});

	it("hides indicator when stage has zero dimensions", () => {
		const overlay = makeDiv(0, 0);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: makeRegion(),
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("none");
	});

	it("hides indicator when video has zero dimensions", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: makeRegion(),
			videoSize: { width: 0, height: 0 },
			baseScale: 1,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("none");
	});

	it("hides indicator when baseScale is 0", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: makeRegion(),
			videoSize: { width: 1920, height: 1080 },
			baseScale: 0,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("none");
	});

	it("shows indicator with correct dimensions for manual focus", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);
		const region = makeRegion({ depth: 3 });

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region,
			videoSize: { width: 1920, height: 1080 },
			baseScale: 0.5,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("block");

		const scale = ZOOM_DEPTH_SCALES[3];
		const expectedWidth = 800 / scale;
		const expectedHeight = 600 / scale;
		expect(parseFloat(indicator.style.width)).toBeCloseTo(expectedWidth, 4);
		expect(parseFloat(indicator.style.height)).toBeCloseTo(expectedHeight, 4);
	});

	it("disables pointer events on overlay when playing", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: makeRegion(),
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: true,
		});

		expect(overlay.style.pointerEvents).toBe("none");
	});

	it("enables pointer events on overlay when paused", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region: makeRegion(),
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: false,
		});

		expect(overlay.style.pointerEvents).toBe("auto");
	});

	it("applies focusOverride when provided", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);
		const region = makeRegion({ focus: { cx: 0.5, cy: 0.5 } });

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region,
			focusOverride: { cx: 0.2, cy: 0.8 },
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: false,
		});

		expect(indicator.style.display).toBe("block");
		const left = parseFloat(indicator.style.left);
		const top = parseFloat(indicator.style.top);
		expect(left).toBeGreaterThanOrEqual(0);
		expect(top).toBeGreaterThanOrEqual(0);
	});

	it("clamps indicator position within stage bounds", () => {
		const overlay = makeDiv(800, 600);
		const indicator = makeDiv(0, 0);
		const region = makeRegion({ depth: 1, focus: { cx: 0, cy: 0 } });

		updateOverlayIndicator({
			overlayEl: overlay,
			indicatorEl: indicator,
			region,
			videoSize: { width: 1920, height: 1080 },
			baseScale: 1,
			isPlaying: false,
		});

		const left = parseFloat(indicator.style.left);
		const top = parseFloat(indicator.style.top);
		expect(left).toBeGreaterThanOrEqual(0);
		expect(top).toBeGreaterThanOrEqual(0);
	});
});
