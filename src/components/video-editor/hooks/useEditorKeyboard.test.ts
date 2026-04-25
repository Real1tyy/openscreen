import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { useEditorKeyboard } from "./useEditorKeyboard";

function fire(key: string, opts: Partial<KeyboardEvent> = {}) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...opts,
	});
	window.dispatchEvent(event);
	return event;
}

function setup(overrides: Partial<Parameters<typeof useEditorKeyboard>[0]> = {}) {
	const params = {
		undo: vi.fn(),
		redo: vi.fn(),
		shortcuts: DEFAULT_SHORTCUTS,
		isMac: false,
		videoPlaybackRef: { current: null } as any,
		durationRef: { current: 60 },
		handleQuickTrimStart: vi.fn(),
		handleQuickTrimEnd: vi.fn(),
		handleAddChapter: vi.fn(),
		handleChapterNavigatePrev: vi.fn(),
		handleChapterNavigateNext: vi.fn(),
		...overrides,
	};
	renderHook(() => useEditorKeyboard(params));
	return params;
}

describe("useEditorKeyboard", () => {
	describe("undo/redo", () => {
		it("calls undo on Ctrl+Z", () => {
			const p = setup();
			fire("z", { ctrlKey: true });
			expect(p.undo).toHaveBeenCalled();
		});

		it("calls redo on Ctrl+Y", () => {
			const p = setup();
			fire("y", { ctrlKey: true });
			expect(p.redo).toHaveBeenCalled();
		});

		it("calls redo on Ctrl+Shift+Z", () => {
			const p = setup();
			fire("z", { ctrlKey: true, shiftKey: true });
			expect(p.redo).toHaveBeenCalled();
		});

		it("calls undo on Meta+Z (Mac)", () => {
			const p = setup();
			fire("z", { metaKey: true });
			expect(p.undo).toHaveBeenCalled();
		});
	});

	describe("quick trim", () => {
		it("calls handleQuickTrimStart on I", () => {
			const p = setup();
			fire("i");
			expect(p.handleQuickTrimStart).toHaveBeenCalled();
		});

		it("calls handleQuickTrimEnd on O", () => {
			const p = setup();
			fire("o");
			expect(p.handleQuickTrimEnd).toHaveBeenCalled();
		});

		it("ignores I with Ctrl modifier", () => {
			const p = setup();
			fire("i", { ctrlKey: true });
			expect(p.handleQuickTrimStart).not.toHaveBeenCalled();
		});
	});

	describe("chapter shortcuts", () => {
		it("calls handleAddChapter on C", () => {
			const p = setup();
			fire("c");
			expect(p.handleAddChapter).toHaveBeenCalled();
		});

		it("calls handleChapterNavigatePrev on [", () => {
			const p = setup();
			fire("[");
			expect(p.handleChapterNavigatePrev).toHaveBeenCalled();
		});

		it("calls handleChapterNavigateNext on ]", () => {
			const p = setup();
			fire("]");
			expect(p.handleChapterNavigateNext).toHaveBeenCalled();
		});

		it("ignores C with Ctrl modifier", () => {
			const p = setup();
			fire("c", { ctrlKey: true });
			expect(p.handleAddChapter).not.toHaveBeenCalled();
		});
	});

	describe("frame stepping", () => {
		it("steps video forward on ArrowRight", () => {
			const mockVideo = { currentTime: 1, duration: 60 };
			const p = setup({
				videoPlaybackRef: { current: { video: mockVideo } } as any,
			});
			fire("ArrowRight");
			expect(mockVideo.currentTime).not.toBe(1);
		});

		it("steps video backward on ArrowLeft", () => {
			const mockVideo = { currentTime: 1, duration: 60 };
			const p = setup({
				videoPlaybackRef: { current: { video: mockVideo } } as any,
			});
			fire("ArrowLeft");
			expect(mockVideo.currentTime).toBeLessThan(1);
		});

		it("does nothing when no video ref", () => {
			const p = setup();
			fire("ArrowRight");
			// Should not throw
		});
	});
});
