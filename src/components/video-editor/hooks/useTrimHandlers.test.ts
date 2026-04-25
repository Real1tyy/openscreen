import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_EDITOR_STATE, type EditorState } from "@/hooks/useEditorHistory";
import type { TrimRegion } from "../types";
import { useTrimHandlers } from "./useTrimHandlers";

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

function makeRef<T>(value: T): React.MutableRefObject<T> {
	return { current: value };
}

function setup(overrides: {
	trimRegions?: TrimRegion[];
	selectedTrimId?: string | null;
	currentTime?: number;
	duration?: number;
} = {}) {
	const pushState = vi.fn();
	const selectTrim = vi.fn();
	const currentTimeRef = makeRef(overrides.currentTime ?? 5);
	const durationRef = makeRef(overrides.duration ?? 60);
	const videoPlaybackRef = makeRef(null) as React.RefObject<any>;

	const trimRegions = overrides.trimRegions ?? [];
	const selectedTrimId = overrides.selectedTrimId ?? null;

	const { result } = renderHook(() =>
		useTrimHandlers({
			pushState,
			trimRegions,
			selectTrim,
			selectedTrimId,
			currentTimeRef,
			durationRef,
			videoPlaybackRef,
		}),
	);

	return { result, pushState, selectTrim, currentTimeRef, durationRef };
}

describe("useTrimHandlers", () => {
	describe("handleTrimAdded", () => {
		it("creates a trim region from the span", () => {
			const { result, pushState, selectTrim } = setup();
			act(() => result.current.handleTrimAdded({ start: 2000, end: 8000 }));

			const state = applyUpdate(pushState);
			expect(state.trimRegions).toHaveLength(1);
			expect(state.trimRegions[0]).toMatchObject({
				id: "trim-1",
				startMs: 2000,
				endMs: 8000,
			});
			expect(selectTrim).toHaveBeenCalledWith("trim-1");
		});

		it("rounds span values", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleTrimAdded({ start: 100.6, end: 200.2 }));

			const state = applyUpdate(pushState);
			expect(state.trimRegions[0].startMs).toBe(101);
			expect(state.trimRegions[0].endMs).toBe(200);
		});

		it("auto-increments IDs", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleTrimAdded({ start: 0, end: 1000 }));
			act(() => result.current.handleTrimAdded({ start: 2000, end: 3000 }));

			const r1 = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const r2 = applyUpdate(pushState, INITIAL_EDITOR_STATE, 1);
			expect(r1.trimRegions[0].id).toBe("trim-1");
			expect(r2.trimRegions[0].id).toBe("trim-2");
		});
	});

	describe("handleTrimDelete", () => {
		it("removes the region", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				trimRegions: [
					{ id: "trim-1", startMs: 0, endMs: 1000 },
					{ id: "trim-2", startMs: 2000, endMs: 3000 },
				],
			};

			act(() => result.current.handleTrimDelete("trim-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions).toHaveLength(1);
			expect(state.trimRegions[0].id).toBe("trim-2");
		});

		it("clears selection when deleting selected trim", () => {
			const pushState = vi.fn();
			const selectTrim = vi.fn();
			const { result } = renderHook(() =>
				useTrimHandlers({
					pushState,
					trimRegions: [],
					selectTrim,
					selectedTrimId: "trim-1",
					currentTimeRef: makeRef(0),
					durationRef: makeRef(60),
					videoPlaybackRef: makeRef(null) as any,
				}),
			);

			act(() => result.current.handleTrimDelete("trim-1"));
			expect(selectTrim).toHaveBeenCalledWith(null);
		});

		it("does not clear selection when deleting non-selected trim", () => {
			const pushState = vi.fn();
			const selectTrim = vi.fn();
			const { result } = renderHook(() =>
				useTrimHandlers({
					pushState,
					trimRegions: [],
					selectTrim,
					selectedTrimId: "trim-2",
					currentTimeRef: makeRef(0),
					durationRef: makeRef(60),
					videoPlaybackRef: makeRef(null) as any,
				}),
			);

			act(() => result.current.handleTrimDelete("trim-1"));
			expect(selectTrim).not.toHaveBeenCalled();
		});
	});

	describe("handleTrimSetStartToNow", () => {
		it("sets start to current playback time", () => {
			const { result, pushState } = setup({ currentTime: 3 });
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				trimRegions: [{ id: "trim-1", startMs: 1000, endMs: 8000 }],
			};

			act(() => result.current.handleTrimSetStartToNow("trim-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions[0].startMs).toBe(3000);
		});

		it("clamps start to endMs - 100", () => {
			const { result, pushState } = setup({ currentTime: 10 });
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				trimRegions: [{ id: "trim-1", startMs: 1000, endMs: 5000 }],
			};

			act(() => result.current.handleTrimSetStartToNow("trim-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions[0].startMs).toBe(4900);
		});
	});

	describe("handleTrimSetEndToNow", () => {
		it("sets end to current playback time", () => {
			const { result, pushState } = setup({ currentTime: 7 });
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				trimRegions: [{ id: "trim-1", startMs: 1000, endMs: 5000 }],
			};

			act(() => result.current.handleTrimSetEndToNow("trim-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions[0].endMs).toBe(7000);
		});

		it("clamps end to startMs + 100", () => {
			const { result, pushState } = setup({ currentTime: 0.5 });
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				trimRegions: [{ id: "trim-1", startMs: 1000, endMs: 5000 }],
			};

			act(() => result.current.handleTrimSetEndToNow("trim-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions[0].endMs).toBe(1100);
		});
	});

	describe("handleTrimSetStartFromAdjacent", () => {
		it("snaps start to end of preceding trim", () => {
			const trims: TrimRegion[] = [
				{ id: "trim-1", startMs: 1000, endMs: 3000 },
				{ id: "trim-2", startMs: 5000, endMs: 8000 },
			];
			const { result, pushState } = setup({ trimRegions: trims });
			const existing: EditorState = { ...INITIAL_EDITOR_STATE, trimRegions: trims };

			act(() => result.current.handleTrimSetStartFromAdjacent("trim-2"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions[1].startMs).toBe(3000);
		});

		it("does nothing when there is no preceding trim", () => {
			const trims: TrimRegion[] = [{ id: "trim-1", startMs: 5000, endMs: 8000 }];
			const { result, pushState } = setup({ trimRegions: trims });

			act(() => result.current.handleTrimSetStartFromAdjacent("trim-1"));
			expect(pushState).not.toHaveBeenCalled();
		});
	});

	describe("handleTrimSetEndFromAdjacent", () => {
		it("snaps end to start of following trim", () => {
			const trims: TrimRegion[] = [
				{ id: "trim-1", startMs: 1000, endMs: 3000 },
				{ id: "trim-2", startMs: 5000, endMs: 8000 },
			];
			const { result, pushState } = setup({ trimRegions: trims });
			const existing: EditorState = { ...INITIAL_EDITOR_STATE, trimRegions: trims };

			act(() => result.current.handleTrimSetEndFromAdjacent("trim-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.trimRegions[0].endMs).toBe(5000);
		});

		it("does nothing when there is no following trim", () => {
			const trims: TrimRegion[] = [{ id: "trim-1", startMs: 1000, endMs: 3000 }];
			const { result, pushState } = setup({ trimRegions: trims });

			act(() => result.current.handleTrimSetEndFromAdjacent("trim-1"));
			expect(pushState).not.toHaveBeenCalled();
		});
	});

	describe("quick trim", () => {
		it("handleQuickTrimStart sets trim mark", () => {
			const { result } = setup({ currentTime: 5 });
			act(() => result.current.handleQuickTrimStart());
			expect(result.current.trimMarkStartMs).toBe(5000);
		});

		it("handleQuickTrimEnd creates a trim from mark to now", () => {
			const { result, pushState, selectTrim, currentTimeRef } = setup({ currentTime: 5 });

			act(() => result.current.handleQuickTrimStart());

			currentTimeRef.current = 10;
			act(() => result.current.handleQuickTrimEnd());

			const state = applyUpdate(pushState);
			expect(state.trimRegions).toHaveLength(1);
			expect(state.trimRegions[0].startMs).toBe(5000);
			expect(state.trimRegions[0].endMs).toBe(10000);
			expect(selectTrim).toHaveBeenCalled();
		});

		it("handleQuickTrimEnd does nothing when end <= start", () => {
			const { result, pushState, currentTimeRef } = setup({ currentTime: 10 });

			act(() => result.current.handleQuickTrimStart());

			currentTimeRef.current = 5;
			act(() => result.current.handleQuickTrimEnd());

			expect(pushState).not.toHaveBeenCalled();
		});

		it("handleQuickTrimEnd does nothing when no mark is set", () => {
			const { result, pushState } = setup({ currentTime: 10 });
			act(() => result.current.handleQuickTrimEnd());
			expect(pushState).not.toHaveBeenCalled();
		});

		it("clears the mark after creating a trim", () => {
			const { result, currentTimeRef } = setup({ currentTime: 5 });

			act(() => result.current.handleQuickTrimStart());
			currentTimeRef.current = 10;
			act(() => result.current.handleQuickTrimEnd());

			expect(result.current.trimMarkStartMs).toBeNull();
		});
	});

	describe("resetIdCounter", () => {
		it("resets the counter based on existing IDs", () => {
			const { result, pushState } = setup();
			act(() => result.current.resetIdCounter(["trim-4", "trim-9"]));
			act(() => result.current.handleTrimAdded({ start: 0, end: 1000 }));

			const state = applyUpdate(pushState);
			expect(state.trimRegions[0].id).toBe("trim-10");
		});
	});
});
