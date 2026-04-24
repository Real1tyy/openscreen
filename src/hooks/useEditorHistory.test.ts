import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { INITIAL_EDITOR_STATE, useEditorHistory } from "./useEditorHistory";

function setup(initial = INITIAL_EDITOR_STATE) {
	return renderHook(() => useEditorHistory(initial));
}

describe("useEditorHistory", () => {
	it("initializes with the provided state", () => {
		const { result } = setup();
		expect(result.current.state).toEqual(INITIAL_EDITOR_STATE);
		expect(result.current.canUndo).toBe(false);
		expect(result.current.canRedo).toBe(false);
	});

	describe("pushState", () => {
		it("applies a partial update", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 80 }));
			expect(result.current.state.padding).toBe(80);
		});

		it("applies a function update", () => {
			const { result } = setup();
			act(() => result.current.pushState((prev) => ({ padding: prev.padding + 10 })));
			expect(result.current.state.padding).toBe(INITIAL_EDITOR_STATE.padding + 10);
		});

		it("enables undo after push", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 80 }));
			expect(result.current.canUndo).toBe(true);
		});

		it("clears redo history on push", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 80 }));
			act(() => result.current.undo());
			expect(result.current.canRedo).toBe(true);
			act(() => result.current.pushState({ padding: 60 }));
			expect(result.current.canRedo).toBe(false);
		});
	});

	describe("undo / redo", () => {
		it("undoes a pushed state", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 80 }));
			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(INITIAL_EDITOR_STATE.padding);
			expect(result.current.canUndo).toBe(false);
			expect(result.current.canRedo).toBe(true);
		});

		it("redoes an undone state", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 80 }));
			act(() => result.current.undo());
			act(() => result.current.redo());
			expect(result.current.state.padding).toBe(80);
			expect(result.current.canUndo).toBe(true);
			expect(result.current.canRedo).toBe(false);
		});

		it("undo is a no-op when history is empty", () => {
			const { result } = setup();
			const before = result.current.state;
			act(() => result.current.undo());
			expect(result.current.state).toBe(before);
		});

		it("redo is a no-op when future is empty", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 80 }));
			const before = result.current.state;
			act(() => result.current.redo());
			expect(result.current.state).toBe(before);
		});

		it("supports multiple undo/redo steps", () => {
			const { result } = setup();
			act(() => result.current.pushState({ padding: 10 }));
			act(() => result.current.pushState({ padding: 20 }));
			act(() => result.current.pushState({ padding: 30 }));

			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(20);
			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(10);
			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(INITIAL_EDITOR_STATE.padding);

			act(() => result.current.redo());
			expect(result.current.state.padding).toBe(10);
			act(() => result.current.redo());
			expect(result.current.state.padding).toBe(20);
			act(() => result.current.redo());
			expect(result.current.state.padding).toBe(30);
		});
	});

	describe("updateState (live updates)", () => {
		it("first updateState creates a checkpoint", () => {
			const { result } = setup();
			act(() => result.current.updateState({ padding: 80 }));
			expect(result.current.state.padding).toBe(80);
			expect(result.current.canUndo).toBe(true);
		});

		it("subsequent updateState calls do not add more checkpoints", () => {
			const { result } = setup();
			act(() => result.current.updateState({ padding: 60 }));
			act(() => result.current.updateState({ padding: 70 }));
			act(() => result.current.updateState({ padding: 80 }));
			expect(result.current.state.padding).toBe(80);

			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(INITIAL_EDITOR_STATE.padding);
		});

		it("commitState ends the live-update series", () => {
			const { result } = setup();
			act(() => result.current.updateState({ padding: 60 }));
			act(() => result.current.updateState({ padding: 70 }));
			act(() => result.current.commitState());

			act(() => result.current.updateState({ padding: 90 }));
			act(() => result.current.updateState({ padding: 100 }));
			expect(result.current.state.padding).toBe(100);

			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(70);

			act(() => result.current.undo());
			expect(result.current.state.padding).toBe(INITIAL_EDITOR_STATE.padding);
		});
	});

	describe("history limit", () => {
		it("caps undo history at 80 entries", () => {
			const { result } = setup();
			for (let i = 1; i <= 100; i++) {
				act(() => result.current.pushState({ padding: i }));
			}
			expect(result.current.state.padding).toBe(100);

			let undoCount = 0;
			while (result.current.canUndo) {
				act(() => result.current.undo());
				undoCount++;
			}
			expect(undoCount).toBeLessThanOrEqual(80);
		});
	});
});
