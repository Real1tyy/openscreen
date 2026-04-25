import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_EDITOR_STATE, type EditorState } from "@/hooks/useEditorHistory";
import { DEFAULT_PLAYBACK_SPEED } from "../types";
import { useSpeedHandlers } from "./useSpeedHandlers";

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

function setup(selectedSpeedId: string | null = null) {
	const pushState = vi.fn();
	const selectSpeed = vi.fn();
	const { result } = renderHook(() =>
		useSpeedHandlers({ pushState, selectSpeed, selectedSpeedId }),
	);
	return { result, pushState, selectSpeed };
}

describe("useSpeedHandlers", () => {
	describe("handleSpeedAdded", () => {
		it("creates a speed region with default speed", () => {
			const { result, pushState, selectSpeed } = setup();
			act(() => result.current.handleSpeedAdded({ start: 1000, end: 5000 }));

			const state = applyUpdate(pushState);
			expect(state.speedRegions).toHaveLength(1);
			expect(state.speedRegions[0]).toMatchObject({
				id: "speed-1",
				startMs: 1000,
				endMs: 5000,
				speed: DEFAULT_PLAYBACK_SPEED,
			});
			expect(selectSpeed).toHaveBeenCalledWith("speed-1");
		});

		it("rounds span values", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleSpeedAdded({ start: 100.4, end: 200.9 }));

			const state = applyUpdate(pushState);
			expect(state.speedRegions[0].startMs).toBe(100);
			expect(state.speedRegions[0].endMs).toBe(201);
		});

		it("auto-increments IDs", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleSpeedAdded({ start: 0, end: 1000 }));
			act(() => result.current.handleSpeedAdded({ start: 2000, end: 3000 }));

			const r1 = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const r2 = applyUpdate(pushState, INITIAL_EDITOR_STATE, 1);
			expect(r1.speedRegions[0].id).toBe("speed-1");
			expect(r2.speedRegions[0].id).toBe("speed-2");
		});
	});

	describe("handleSpeedDelete", () => {
		it("removes the region", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				speedRegions: [
					{ id: "speed-1", startMs: 0, endMs: 1000, speed: 2 },
					{ id: "speed-2", startMs: 2000, endMs: 3000, speed: 1.5 },
				],
			};

			act(() => result.current.handleSpeedDelete("speed-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.speedRegions).toHaveLength(1);
			expect(state.speedRegions[0].id).toBe("speed-2");
		});

		it("clears selection when deleting the selected region", () => {
			const pushState = vi.fn();
			const selectSpeed = vi.fn();
			const { result } = renderHook(() =>
				useSpeedHandlers({ pushState, selectSpeed, selectedSpeedId: "speed-1" }),
			);

			act(() => result.current.handleSpeedDelete("speed-1"));
			expect(selectSpeed).toHaveBeenCalledWith(null);
		});

		it("does not clear selection when deleting a non-selected region", () => {
			const pushState = vi.fn();
			const selectSpeed = vi.fn();
			const { result } = renderHook(() =>
				useSpeedHandlers({ pushState, selectSpeed, selectedSpeedId: "speed-2" }),
			);

			act(() => result.current.handleSpeedDelete("speed-1"));
			expect(selectSpeed).not.toHaveBeenCalled();
		});
	});

	describe("handleSpeedChange", () => {
		it("is a no-op when no speed region is selected", () => {
			const { result, pushState } = setup(null);
			act(() => result.current.handleSpeedChange(3));
			expect(pushState).not.toHaveBeenCalled();
		});

		it("updates speed on the selected region", () => {
			const pushState = vi.fn();
			const selectSpeed = vi.fn();
			const { result } = renderHook(() =>
				useSpeedHandlers({ pushState, selectSpeed, selectedSpeedId: "speed-1" }),
			);

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				speedRegions: [{ id: "speed-1", startMs: 0, endMs: 1000, speed: 1.5 }],
			};

			act(() => result.current.handleSpeedChange(3));

			const state = applyUpdate(pushState, existing);
			expect(state.speedRegions[0].speed).toBe(3);
		});

		it("does not modify other regions", () => {
			const pushState = vi.fn();
			const selectSpeed = vi.fn();
			const { result } = renderHook(() =>
				useSpeedHandlers({ pushState, selectSpeed, selectedSpeedId: "speed-1" }),
			);

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				speedRegions: [
					{ id: "speed-1", startMs: 0, endMs: 1000, speed: 1.5 },
					{ id: "speed-2", startMs: 2000, endMs: 3000, speed: 2 },
				],
			};

			act(() => result.current.handleSpeedChange(4));

			const state = applyUpdate(pushState, existing);
			expect(state.speedRegions[1].speed).toBe(2);
		});
	});

	describe("resetIdCounter", () => {
		it("resets the counter based on existing IDs", () => {
			const { result, pushState } = setup();
			act(() => result.current.resetIdCounter(["speed-7", "speed-2"]));
			act(() => result.current.handleSpeedAdded({ start: 0, end: 1000 }));

			const state = applyUpdate(pushState);
			expect(state.speedRegions[0].id).toBe("speed-8");
		});
	});
});
