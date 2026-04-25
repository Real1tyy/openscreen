import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_EDITOR_STATE, type EditorState } from "@/hooks/useEditorHistory";
import type { ChapterMarker } from "../types";
import { useChapterHandlers } from "./useChapterHandlers";

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
	chapters?: ChapterMarker[];
	selectedChapterId?: string | null;
	currentTime?: number;
	duration?: number;
} = {}) {
	const pushState = vi.fn();
	const selectChapter = vi.fn();
	const setEditingChapterId = vi.fn();
	const currentTimeRef = makeRef(overrides.currentTime ?? 5);
	const durationRef = makeRef(overrides.duration ?? 60);
	const videoPlaybackRef = makeRef(null) as React.RefObject<any>;

	const chapters = overrides.chapters ?? [];
	const selectedChapterId = overrides.selectedChapterId ?? null;

	const { result } = renderHook(() =>
		useChapterHandlers({
			pushState,
			chapters,
			selectChapter,
			selectedChapterId,
			setEditingChapterId,
			currentTimeRef,
			durationRef,
			videoPlaybackRef,
		}),
	);

	return { result, pushState, selectChapter, setEditingChapterId, currentTimeRef, durationRef };
}

describe("useChapterHandlers", () => {
	describe("handleAddChapter", () => {
		it("creates a chapter at the current time", () => {
			const { result, pushState, selectChapter, setEditingChapterId } = setup({
				currentTime: 10,
				duration: 60,
			});

			act(() => result.current.handleAddChapter());

			const state = applyUpdate(pushState);
			expect(state.chapters).toHaveLength(1);
			expect(state.chapters[0].id).toBe("chapter-1");
			expect(state.chapters[0].startMs).toBe(10000);
			expect(state.chapters[0].name).toBe("");
			expect(selectChapter).toHaveBeenCalledWith("chapter-1");
			expect(setEditingChapterId).toHaveBeenCalledWith("chapter-1");
		});

		it("does nothing when duration is zero", () => {
			const { result, pushState } = setup({ duration: 0 });
			act(() => result.current.handleAddChapter());
			expect(pushState).not.toHaveBeenCalled();
		});

		it("clamps startMs to totalMs - 100", () => {
			const { result, pushState } = setup({ currentTime: 60, duration: 60 });

			act(() => result.current.handleAddChapter());

			const state = applyUpdate(pushState);
			expect(state.chapters[0].startMs).toBe(59900);
		});

		it("sets endMs to next chapter start or totalMs", () => {
			const existingChapters: ChapterMarker[] = [
				{ id: "chapter-existing", startMs: 20000, endMs: 30000, name: "Existing" },
			];
			const { result, pushState } = setup({
				chapters: existingChapters,
				currentTime: 10,
				duration: 60,
			});

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				chapters: existingChapters,
			};

			act(() => result.current.handleAddChapter());

			const state = applyUpdate(pushState, existing);
			const newChapter = state.chapters.find((c) => c.id === "chapter-1");
			expect(newChapter).toBeDefined();
			expect(newChapter!.endMs).toBe(20000);
		});
	});

	describe("handleRenameChapter", () => {
		it("updates the chapter name", () => {
			const { result, pushState, setEditingChapterId } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				chapters: [{ id: "chapter-1", startMs: 0, endMs: 5000, name: "" }],
			};

			act(() => result.current.handleRenameChapter("chapter-1", "Introduction"));

			const state = applyUpdate(pushState, existing);
			expect(state.chapters[0].name).toBe("Introduction");
			expect(setEditingChapterId).toHaveBeenCalledWith(null);
		});
	});

	describe("handleDeleteChapter", () => {
		it("removes the chapter", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				chapters: [
					{ id: "chapter-1", startMs: 0, endMs: 5000, name: "A" },
					{ id: "chapter-2", startMs: 10000, endMs: 20000, name: "B" },
				],
			};

			act(() => result.current.handleDeleteChapter("chapter-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.chapters).toHaveLength(1);
			expect(state.chapters[0].id).toBe("chapter-2");
		});

		it("clears selection when deleting the selected chapter", () => {
			const pushState = vi.fn();
			const selectChapter = vi.fn();
			const { result } = renderHook(() =>
				useChapterHandlers({
					pushState,
					chapters: [],
					selectChapter,
					selectedChapterId: "chapter-1",
					setEditingChapterId: vi.fn(),
					currentTimeRef: makeRef(0),
					durationRef: makeRef(60),
					videoPlaybackRef: makeRef(null) as any,
				}),
			);

			act(() => result.current.handleDeleteChapter("chapter-1"));
			expect(selectChapter).toHaveBeenCalledWith(null);
		});
	});

	describe("resetIdCounter", () => {
		it("resets the counter based on existing IDs", () => {
			const { result, pushState } = setup({ currentTime: 5, duration: 60 });

			act(() => result.current.resetIdCounter(["chapter-3", "chapter-8"]));
			act(() => result.current.handleAddChapter());

			const state = applyUpdate(pushState);
			expect(state.chapters[0].id).toBe("chapter-9");
		});
	});
});
