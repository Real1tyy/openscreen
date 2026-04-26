import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { INITIAL_EDITOR_STATE, type EditorState } from "@/hooks/useEditorHistory";
import { useZoomHandlers } from "../hooks/useZoomHandlers";
import { useTrimHandlers } from "../hooks/useTrimHandlers";
import { useSpeedHandlers } from "../hooks/useSpeedHandlers";
import { createSpanChangeHandler } from "../hooks/regionReducers";
import type { Span } from "dnd-timeline";
import { useRef } from "react";

function applyUpdate(
	pushState: ReturnType<typeof vi.fn>,
	state: EditorState = INITIAL_EDITOR_STATE,
	callIndex = -1,
): EditorState {
	const idx = callIndex >= 0 ? callIndex : pushState.mock.calls.length - 1;
	const update = pushState.mock.calls[idx][0];
	if (typeof update === "function") return { ...state, ...update(state) };
	return { ...state, ...update };
}

describe("createSpanChangeHandler", () => {
	it("updates startMs and endMs for a matching region", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "trimRegions");

		const state: EditorState = {
			...INITIAL_EDITOR_STATE,
			trimRegions: [
				{ id: "trim-1", startMs: 0, endMs: 5000 },
				{ id: "trim-2", startMs: 6000, endMs: 10000 },
			],
		};

		handler("trim-1", { start: 500, end: 3000 });
		const result = applyUpdate(pushState, state);

		expect(result.trimRegions[0]).toEqual({ id: "trim-1", startMs: 500, endMs: 3000 });
		expect(result.trimRegions[1]).toEqual({ id: "trim-2", startMs: 6000, endMs: 10000 });
	});

	it("rounds span values to nearest integer", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "speedRegions");

		const state: EditorState = {
			...INITIAL_EDITOR_STATE,
			speedRegions: [
				{ id: "speed-1", startMs: 0, endMs: 5000, speed: 2 },
			],
		};

		handler("speed-1", { start: 100.7, end: 4500.3 });
		const result = applyUpdate(pushState, state);

		expect(result.speedRegions[0].startMs).toBe(101);
		expect(result.speedRegions[0].endMs).toBe(4500);
	});

	it("does not modify non-matching regions", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "zoomRegions");

		const state: EditorState = {
			...INITIAL_EDITOR_STATE,
			zoomRegions: [
				{ id: "zoom-1", startMs: 0, endMs: 5000, depth: 2 as any, focus: { x: 0.5, y: 0.5 } },
				{ id: "zoom-2", startMs: 6000, endMs: 10000, depth: 3 as any, focus: { x: 0.5, y: 0.5 } },
			],
		};

		handler("zoom-1", { start: 1000, end: 4000 });
		const result = applyUpdate(pushState, state);

		expect(result.zoomRegions[0].startMs).toBe(1000);
		expect(result.zoomRegions[0].endMs).toBe(4000);
		expect(result.zoomRegions[1].startMs).toBe(6000);
		expect(result.zoomRegions[1].endMs).toBe(10000);
	});

	it("preserves other region properties (speed, depth, etc.)", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "speedRegions");

		const state: EditorState = {
			...INITIAL_EDITOR_STATE,
			speedRegions: [
				{ id: "speed-1", startMs: 0, endMs: 5000, speed: 4 },
			],
		};

		handler("speed-1", { start: 1000, end: 3000 });
		const result = applyUpdate(pushState, state);

		expect(result.speedRegions[0].speed).toBe(4);
		expect(result.speedRegions[0].startMs).toBe(1000);
		expect(result.speedRegions[0].endMs).toBe(3000);
	});

	it("handles non-existent region ID gracefully", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "trimRegions");

		const state: EditorState = {
			...INITIAL_EDITOR_STATE,
			trimRegions: [
				{ id: "trim-1", startMs: 0, endMs: 5000 },
			],
		};

		handler("nonexistent", { start: 1000, end: 3000 });
		const result = applyUpdate(pushState, state);

		expect(result.trimRegions[0]).toEqual({ id: "trim-1", startMs: 0, endMs: 5000 });
	});
});

describe("precise timestamp editing via span handlers", () => {
	describe("trim region editing", () => {
		function setupTrimHandlers(initialTrimRegions = INITIAL_EDITOR_STATE.trimRegions) {
			const pushState = vi.fn();
			const selectTrim = vi.fn();
			const currentTimeRef = { current: 0 };
			const durationRef = { current: 60 };
			const videoPlaybackRef = { current: null };

			const { result } = renderHook(() =>
				useTrimHandlers({
					pushState,
					trimRegions: initialTrimRegions,
					selectTrim,
					selectedTrimId: null,
					currentTimeRef: currentTimeRef as any,
					durationRef: durationRef as any,
					videoPlaybackRef: videoPlaybackRef as any,
				}),
			);
			return { result, pushState, selectTrim };
		}

		it("adds a trim region and can update its span", () => {
			const { result, pushState } = setupTrimHandlers();

			act(() => result.current.handleTrimAdded({ start: 1000, end: 5000 }));

			const stateAfterAdd = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			expect(stateAfterAdd.trimRegions).toHaveLength(1);
			expect(stateAfterAdd.trimRegions[0].startMs).toBe(1000);
			expect(stateAfterAdd.trimRegions[0].endMs).toBe(5000);

			act(() =>
				result.current.handleTrimSpanChange(
					stateAfterAdd.trimRegions[0].id,
					{ start: 2000, end: 4000 },
				),
			);

			const stateAfterSpanChange = applyUpdate(pushState, stateAfterAdd);
			expect(stateAfterSpanChange.trimRegions[0].startMs).toBe(2000);
			expect(stateAfterSpanChange.trimRegions[0].endMs).toBe(4000);
		});
	});

	describe("speed region editing", () => {
		function setupSpeedHandlers() {
			const pushState = vi.fn();
			const selectSpeed = vi.fn();

			const { result } = renderHook(() =>
				useSpeedHandlers({ pushState, selectSpeed, selectedSpeedId: null }),
			);
			return { result, pushState, selectSpeed };
		}

		it("can add a speed region and change its span", () => {
			const { result, pushState } = setupSpeedHandlers();

			act(() => result.current.handleSpeedAdded({ start: 0, end: 10000 }));

			const stateAfterAdd = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const id = stateAfterAdd.speedRegions[0].id;

			act(() =>
				result.current.handleSpeedSpanChange(id, { start: 2000, end: 8000 }),
			);

			const stateAfterChange = applyUpdate(pushState, stateAfterAdd);
			expect(stateAfterChange.speedRegions[0].startMs).toBe(2000);
			expect(stateAfterChange.speedRegions[0].endMs).toBe(8000);
		});

		it("preserves speed value when changing span", () => {
			const { result, pushState, selectSpeed } = setupSpeedHandlers();

			act(() => result.current.handleSpeedAdded({ start: 0, end: 10000 }));
			const stateAfterAdd = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const id = stateAfterAdd.speedRegions[0].id;

			const stateWithSpeed = {
				...stateAfterAdd,
				speedRegions: stateAfterAdd.speedRegions.map((r) =>
					r.id === id ? { ...r, speed: 4 } : r,
				),
			};

			act(() =>
				result.current.handleSpeedSpanChange(id, { start: 1000, end: 5000 }),
			);

			const finalState = applyUpdate(pushState, stateWithSpeed);
			expect(finalState.speedRegions[0].speed).toBe(4);
			expect(finalState.speedRegions[0].startMs).toBe(1000);
			expect(finalState.speedRegions[0].endMs).toBe(5000);
		});
	});

	describe("zoom region editing", () => {
		function setupZoomHandlers() {
			const pushState = vi.fn();
			const updateState = vi.fn();
			const selectZoom = vi.fn();

			const { result } = renderHook(() =>
				useZoomHandlers({ pushState, updateState, selectZoom, selectedZoomId: null }),
			);
			return { result, pushState, updateState, selectZoom };
		}

		it("can add a zoom region and change its span", () => {
			const { result, pushState } = setupZoomHandlers();

			act(() =>
				result.current.handleZoomAdded({ start: 0, end: 5000 }),
			);

			const stateAfterAdd = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const id = stateAfterAdd.zoomRegions[0].id;

			act(() =>
				result.current.handleZoomSpanChange(id, { start: 1000, end: 4000 }),
			);

			const stateAfterChange = applyUpdate(pushState, stateAfterAdd);
			expect(stateAfterChange.zoomRegions[0].startMs).toBe(1000);
			expect(stateAfterChange.zoomRegions[0].endMs).toBe(4000);
		});

		it("preserves depth and focus when changing span", () => {
			const { result, pushState } = setupZoomHandlers();

			act(() =>
				result.current.handleZoomAdded({ start: 0, end: 5000 }),
			);

			const stateAfterAdd = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const region = stateAfterAdd.zoomRegions[0];

			act(() =>
				result.current.handleZoomSpanChange(region.id, { start: 500, end: 3000 }),
			);

			const finalState = applyUpdate(pushState, stateAfterAdd);
			expect(finalState.zoomRegions[0].depth).toBe(region.depth);
			expect(finalState.zoomRegions[0].focus).toEqual({ cx: 0.5, cy: 0.5 });
			expect(finalState.zoomRegions[0].startMs).toBe(500);
			expect(finalState.zoomRegions[0].endMs).toBe(3000);
		});
	});
});

describe("background style computation", () => {
	function computeBackgroundStyle(resolvedWallpaper: string | null) {
		const isImageUrl = Boolean(
			resolvedWallpaper &&
				(resolvedWallpaper.startsWith("file://") ||
					resolvedWallpaper.startsWith("http") ||
					resolvedWallpaper.startsWith("/") ||
					resolvedWallpaper.startsWith("data:") ||
					resolvedWallpaper.startsWith("asset://")),
		);
		return isImageUrl
			? {
					backgroundImage: `url("${resolvedWallpaper}")`,
					backgroundSize: "cover" as const,
					backgroundPosition: "center" as const,
					backgroundRepeat: "no-repeat" as const,
				}
			: {
					backgroundImage: "none" as const,
					background: resolvedWallpaper || "",
				};
	}

	it("returns image styles for http URLs", () => {
		const style = computeBackgroundStyle("http://example.com/bg.jpg");
		expect(style).toHaveProperty("backgroundImage", 'url("http://example.com/bg.jpg")');
		expect(style).toHaveProperty("backgroundSize", "cover");
		expect(style).toHaveProperty("backgroundPosition", "center");
	});

	it("returns image styles for https URLs", () => {
		const style = computeBackgroundStyle("https://example.com/bg.jpg");
		expect(style).toHaveProperty("backgroundImage", 'url("https://example.com/bg.jpg")');
	});

	it("returns image styles for relative paths", () => {
		const style = computeBackgroundStyle("/wallpapers/wallpaper1.jpg");
		expect(style).toHaveProperty("backgroundImage", 'url("/wallpapers/wallpaper1.jpg")');
		expect(style).toHaveProperty("backgroundSize", "cover");
	});

	it("returns image styles for file:// URLs", () => {
		const style = computeBackgroundStyle("file:///path/to/image.jpg");
		expect(style).toHaveProperty("backgroundImage", 'url("file:///path/to/image.jpg")');
	});

	it("returns image styles for data: URLs", () => {
		const style = computeBackgroundStyle("data:image/jpeg;base64,ABC123");
		expect(style).toHaveProperty("backgroundImage", 'url("data:image/jpeg;base64,ABC123")');
	});

	it("returns image styles for asset:// URLs", () => {
		const style = computeBackgroundStyle("asset://localhost/path/to/image.jpg");
		expect(style).toHaveProperty("backgroundImage", 'url("asset://localhost/path/to/image.jpg")');
	});

	it("returns gradient styles for linear-gradient", () => {
		const gradient = "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)";
		const style = computeBackgroundStyle(gradient);
		expect(style).toHaveProperty("background", gradient);
		expect(style).toHaveProperty("backgroundImage", "none");
	});

	it("returns gradient styles for radial-gradient", () => {
		const gradient = "radial-gradient(circle, red, blue)";
		const style = computeBackgroundStyle(gradient);
		expect(style).toHaveProperty("background", gradient);
		expect(style).toHaveProperty("backgroundImage", "none");
	});

	it("returns color styles for hex colors", () => {
		const style = computeBackgroundStyle("#FF0000");
		expect(style).toHaveProperty("background", "#FF0000");
		expect(style).toHaveProperty("backgroundImage", "none");
	});

	it("returns empty background for null", () => {
		const style = computeBackgroundStyle(null);
		expect(style).toHaveProperty("background", "");
		expect(style).toHaveProperty("backgroundImage", "none");
	});

	it("returns empty background for empty string", () => {
		const style = computeBackgroundStyle("");
		expect(style).toHaveProperty("background", "");
		expect(style).toHaveProperty("backgroundImage", "none");
	});

	it("clears backgroundImage when switching from image to gradient", () => {
		const imageStyle = computeBackgroundStyle("/wallpapers/wallpaper1.jpg");
		expect(imageStyle).toHaveProperty("backgroundSize", "cover");
		expect(imageStyle).not.toHaveProperty("background");

		const gradientStyle = computeBackgroundStyle("linear-gradient(red, blue)");
		expect(gradientStyle).toHaveProperty("backgroundImage", "none");
		expect(gradientStyle).toHaveProperty("background", "linear-gradient(red, blue)");
	});

	it("sets proper image properties when switching from gradient to image", () => {
		const gradientStyle = computeBackgroundStyle("linear-gradient(red, blue)");
		expect(gradientStyle).toHaveProperty("backgroundImage", "none");

		const imageStyle = computeBackgroundStyle("/wallpapers/wallpaper2.jpg");
		expect(imageStyle).toHaveProperty("backgroundImage", 'url("/wallpapers/wallpaper2.jpg")');
		expect(imageStyle).toHaveProperty("backgroundSize", "cover");
		expect(imageStyle).toHaveProperty("backgroundPosition", "center");
		expect(imageStyle).toHaveProperty("backgroundRepeat", "no-repeat");
		expect(imageStyle).not.toHaveProperty("background");
	});
});
