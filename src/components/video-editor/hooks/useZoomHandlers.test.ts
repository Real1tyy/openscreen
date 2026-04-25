import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_EDITOR_STATE, type EditorState } from "@/hooks/useEditorHistory";
import { DEFAULT_ZOOM_DEPTH, ZOOM_DEPTH_SCALES } from "../types";
import { useZoomHandlers } from "./useZoomHandlers";

function applyUpdate(
	pushState: ReturnType<typeof vi.fn>,
	state: EditorState = INITIAL_EDITOR_STATE,
): EditorState {
	const update = pushState.mock.calls[pushState.mock.calls.length - 1][0];
	if (typeof update === "function") return { ...state, ...update(state) };
	return { ...state, ...update };
}

function setup(selectedZoomId: string | null = null) {
	const pushState = vi.fn();
	const updateState = vi.fn();
	const selectZoom = vi.fn();
	const { result } = renderHook(() =>
		useZoomHandlers({ pushState, updateState, selectZoom, selectedZoomId }),
	);
	return { result, pushState, updateState, selectZoom };
}

describe("useZoomHandlers", () => {
	describe("handleZoomAdded", () => {
		it("creates a zoom region with default depth and center focus", () => {
			const { result, pushState, selectZoom } = setup();
			act(() => result.current.handleZoomAdded({ start: 1000, end: 3000 }));

			const state = applyUpdate(pushState);
			expect(state.zoomRegions).toHaveLength(1);
			expect(state.zoomRegions[0]).toMatchObject({
				id: "zoom-1",
				startMs: 1000,
				endMs: 3000,
				depth: DEFAULT_ZOOM_DEPTH,
				focus: { cx: 0.5, cy: 0.5 },
			});
			expect(selectZoom).toHaveBeenCalledWith("zoom-1");
		});

		it("rounds span values", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleZoomAdded({ start: 1000.7, end: 2999.3 }));

			const state = applyUpdate(pushState);
			expect(state.zoomRegions[0].startMs).toBe(1001);
			expect(state.zoomRegions[0].endMs).toBe(2999);
		});

		it("auto-increments IDs", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleZoomAdded({ start: 0, end: 1000 }));
			act(() => result.current.handleZoomAdded({ start: 2000, end: 3000 }));

			const state1 = applyUpdate(pushState, INITIAL_EDITOR_STATE);
			expect(pushState).toHaveBeenCalledTimes(2);
			const call1 = pushState.mock.calls[0][0];
			const call2 = pushState.mock.calls[1][0];
			const r1 = (typeof call1 === "function" ? call1(INITIAL_EDITOR_STATE) : call1).zoomRegions;
			const r2 = (typeof call2 === "function" ? call2(INITIAL_EDITOR_STATE) : call2).zoomRegions;
			expect(r1[0].id).toBe("zoom-1");
			expect(r2[0].id).toBe("zoom-2");
		});
	});

	describe("handleZoomSuggested", () => {
		it("creates a zoom region with the provided focus", () => {
			const { result, pushState, selectZoom } = setup();
			act(() =>
				result.current.handleZoomSuggested({ start: 500, end: 1500 }, { cx: 0.3, cy: 0.7 }),
			);

			const state = applyUpdate(pushState);
			expect(state.zoomRegions).toHaveLength(1);
			expect(state.zoomRegions[0].focus.cx).toBeCloseTo(0.3);
			expect(state.zoomRegions[0].focus.cy).toBeCloseTo(0.7);
			expect(selectZoom).toHaveBeenCalled();
		});

		it("clamps out-of-range focus values", () => {
			const { result, pushState } = setup();
			act(() =>
				result.current.handleZoomSuggested({ start: 0, end: 1000 }, { cx: -1, cy: 2 }),
			);

			const state = applyUpdate(pushState);
			expect(state.zoomRegions[0].focus.cx).toBeGreaterThanOrEqual(0);
			expect(state.zoomRegions[0].focus.cy).toBeLessThanOrEqual(1);
		});
	});

	describe("handleZoomFocusChange", () => {
		it("updates focus on the matching region via updateState", () => {
			const { result, updateState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				zoomRegions: [{ id: "zoom-1", startMs: 0, endMs: 1000, depth: 3, focus: { cx: 0.5, cy: 0.5 } }],
			};

			act(() => result.current.handleZoomFocusChange("zoom-1", { cx: 0.2, cy: 0.8 }));

			const update = updateState.mock.calls[0][0];
			const newState = { ...existing, ...(typeof update === "function" ? update(existing) : update) };
			expect(newState.zoomRegions[0].focus.cx).toBeCloseTo(0.2);
			expect(newState.zoomRegions[0].focus.cy).toBeCloseTo(0.8);
		});
	});

	describe("handleZoomDepthChange", () => {
		it("is a no-op when no zoom is selected", () => {
			const { result, pushState } = setup(null);
			act(() => result.current.handleZoomDepthChange(5));
			expect(pushState).not.toHaveBeenCalled();
		});

		it("updates depth on the selected zoom", () => {
			const pushState = vi.fn();
			const updateState = vi.fn();
			const selectZoom = vi.fn();
			const { result } = renderHook(() =>
				useZoomHandlers({ pushState, updateState, selectZoom, selectedZoomId: "zoom-1" }),
			);

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				zoomRegions: [{ id: "zoom-1", startMs: 0, endMs: 1000, depth: 3, focus: { cx: 0.5, cy: 0.5 } }],
			};

			act(() => result.current.handleZoomDepthChange(5));

			const update = pushState.mock.calls[0][0];
			const newState = { ...existing, ...(typeof update === "function" ? update(existing) : update) };
			expect(newState.zoomRegions[0].depth).toBe(5);
		});
	});

	describe("handleZoomFocusModeChange", () => {
		it("is a no-op when no zoom is selected", () => {
			const { result, pushState } = setup(null);
			act(() => result.current.handleZoomFocusModeChange("auto"));
			expect(pushState).not.toHaveBeenCalled();
		});

		it("sets focusMode on the selected zoom", () => {
			const pushState = vi.fn();
			const updateState = vi.fn();
			const selectZoom = vi.fn();
			const { result } = renderHook(() =>
				useZoomHandlers({ pushState, updateState, selectZoom, selectedZoomId: "zoom-1" }),
			);

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				zoomRegions: [{ id: "zoom-1", startMs: 0, endMs: 1000, depth: 3, focus: { cx: 0.5, cy: 0.5 } }],
			};

			act(() => result.current.handleZoomFocusModeChange("auto"));

			const update = pushState.mock.calls[0][0];
			const newState = { ...existing, ...(typeof update === "function" ? update(existing) : update) };
			expect(newState.zoomRegions[0].focusMode).toBe("auto");
		});
	});

	describe("handleZoomDelete", () => {
		it("removes the region and clears selection if it was selected", () => {
			const pushState = vi.fn();
			const updateState = vi.fn();
			const selectZoom = vi.fn();
			const { result } = renderHook(() =>
				useZoomHandlers({ pushState, updateState, selectZoom, selectedZoomId: "zoom-1" }),
			);

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				zoomRegions: [
					{ id: "zoom-1", startMs: 0, endMs: 1000, depth: 3, focus: { cx: 0.5, cy: 0.5 } },
					{ id: "zoom-2", startMs: 2000, endMs: 3000, depth: 3, focus: { cx: 0.5, cy: 0.5 } },
				],
			};

			act(() => result.current.handleZoomDelete("zoom-1"));

			const update = pushState.mock.calls[0][0];
			const newState = { ...existing, ...(typeof update === "function" ? update(existing) : update) };
			expect(newState.zoomRegions).toHaveLength(1);
			expect(newState.zoomRegions[0].id).toBe("zoom-2");
			expect(selectZoom).toHaveBeenCalledWith(null);
		});

		it("does not clear selection when deleting a non-selected region", () => {
			const pushState = vi.fn();
			const updateState = vi.fn();
			const selectZoom = vi.fn();
			const { result } = renderHook(() =>
				useZoomHandlers({ pushState, updateState, selectZoom, selectedZoomId: "zoom-2" }),
			);

			act(() => result.current.handleZoomDelete("zoom-1"));
			expect(selectZoom).not.toHaveBeenCalled();
		});
	});

	describe("resetIdCounter", () => {
		it("resets the ID counter based on existing IDs", () => {
			const { result, pushState, selectZoom } = setup();

			act(() => result.current.resetIdCounter(["zoom-5", "zoom-3", "zoom-10"]));
			act(() => result.current.handleZoomAdded({ start: 0, end: 1000 }));

			const state = applyUpdate(pushState);
			expect(state.zoomRegions[0].id).toBe("zoom-11");
		});
	});
});
