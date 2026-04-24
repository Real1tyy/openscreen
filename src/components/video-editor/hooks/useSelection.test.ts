// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type SelectionState, selectionReducer } from "./useSelection";

const initial: SelectionState = {
	selectedZoomId: null,
	selectedTrimId: null,
	selectedSpeedId: null,
	selectedAnnotationId: null,
	selectedChapterId: null,
	editingChapterId: null,
};

const emptyValidIds = {
	selectedZoomId: [] as string[],
	selectedTrimId: [] as string[],
	selectedSpeedId: [] as string[],
	selectedAnnotationId: [] as string[],
	selectedChapterId: [] as string[],
};

describe("selectionReducer", () => {
	describe("mutual exclusion", () => {
		it("SELECT_ZOOM clears trim when id is non-null", () => {
			const state = { ...initial, selectedTrimId: "t1" };
			const next = selectionReducer(state, { type: "SELECT_ZOOM", id: "z1" });
			expect(next.selectedZoomId).toBe("z1");
			expect(next.selectedTrimId).toBeNull();
		});

		it("SELECT_ZOOM with null does not clear trim", () => {
			const state = { ...initial, selectedTrimId: "t1", selectedZoomId: "z1" };
			const next = selectionReducer(state, { type: "SELECT_ZOOM", id: null });
			expect(next.selectedZoomId).toBeNull();
			expect(next.selectedTrimId).toBe("t1");
		});

		it("SELECT_TRIM clears zoom and annotation", () => {
			const state = { ...initial, selectedZoomId: "z1", selectedAnnotationId: "a1" };
			const next = selectionReducer(state, { type: "SELECT_TRIM", id: "t1" });
			expect(next.selectedTrimId).toBe("t1");
			expect(next.selectedZoomId).toBeNull();
			expect(next.selectedAnnotationId).toBeNull();
		});

		it("SELECT_TRIM with null does not clear others", () => {
			const state = { ...initial, selectedZoomId: "z1" };
			const next = selectionReducer(state, { type: "SELECT_TRIM", id: null });
			expect(next.selectedZoomId).toBe("z1");
		});

		it("SELECT_SPEED clears zoom, trim, and annotation", () => {
			const state = {
				...initial,
				selectedZoomId: "z1",
				selectedTrimId: "t1",
				selectedAnnotationId: "a1",
			};
			const next = selectionReducer(state, { type: "SELECT_SPEED", id: "s1" });
			expect(next.selectedSpeedId).toBe("s1");
			expect(next.selectedZoomId).toBeNull();
			expect(next.selectedTrimId).toBeNull();
			expect(next.selectedAnnotationId).toBeNull();
		});

		it("SELECT_SPEED preserves chapter selection", () => {
			const state = { ...initial, selectedChapterId: "c1" };
			const next = selectionReducer(state, { type: "SELECT_SPEED", id: "s1" });
			expect(next.selectedChapterId).toBe("c1");
		});

		it("SELECT_ANNOTATION clears zoom and trim", () => {
			const state = { ...initial, selectedZoomId: "z1", selectedTrimId: "t1" };
			const next = selectionReducer(state, { type: "SELECT_ANNOTATION", id: "a1" });
			expect(next.selectedAnnotationId).toBe("a1");
			expect(next.selectedZoomId).toBeNull();
			expect(next.selectedTrimId).toBeNull();
		});

		it("SELECT_CHAPTER is independent of other selections", () => {
			const state = { ...initial, selectedZoomId: "z1", selectedTrimId: "t1" };
			const next = selectionReducer(state, { type: "SELECT_CHAPTER", id: "c1" });
			expect(next.selectedChapterId).toBe("c1");
			expect(next.selectedZoomId).toBe("z1");
			expect(next.selectedTrimId).toBe("t1");
		});
	});

	describe("CLEAR_ALL", () => {
		it("resets everything to null", () => {
			const state: SelectionState = {
				selectedZoomId: "z1",
				selectedTrimId: "t1",
				selectedSpeedId: "s1",
				selectedAnnotationId: "a1",
				selectedChapterId: "c1",
				editingChapterId: "c1",
			};
			const next = selectionReducer(state, { type: "CLEAR_ALL" });
			expect(next).toEqual(initial);
		});
	});

	describe("SET_EDITING_CHAPTER", () => {
		it("sets editing chapter without affecting selection", () => {
			const state = { ...initial, selectedChapterId: "c1" };
			const next = selectionReducer(state, { type: "SET_EDITING_CHAPTER", id: "c2" });
			expect(next.editingChapterId).toBe("c2");
			expect(next.selectedChapterId).toBe("c1");
		});
	});

	describe("CLEAR_STALE", () => {
		it("clears zoom selection when id not in valid set", () => {
			const state = { ...initial, selectedZoomId: "z1" };
			const next = selectionReducer(state, {
				type: "CLEAR_STALE",
				validIds: { ...emptyValidIds, selectedZoomId: ["z2", "z3"] },
			});
			expect(next.selectedZoomId).toBeNull();
		});

		it("keeps zoom selection when id is in valid set", () => {
			const state = { ...initial, selectedZoomId: "z1" };
			const next = selectionReducer(state, {
				type: "CLEAR_STALE",
				validIds: { ...emptyValidIds, selectedZoomId: ["z1", "z2"] },
			});
			expect(next.selectedZoomId).toBe("z1");
		});

		it("clears multiple stale selections at once", () => {
			const state: SelectionState = {
				...initial,
				selectedZoomId: "z1",
				selectedTrimId: "t1",
				selectedSpeedId: "s1",
				selectedAnnotationId: null,
				selectedChapterId: "c1",
			};
			const next = selectionReducer(state, {
				type: "CLEAR_STALE",
				validIds: {
					selectedZoomId: [],
					selectedTrimId: ["t1"],
					selectedSpeedId: ["s2"],
					selectedAnnotationId: [],
					selectedChapterId: ["c1"],
				},
			});
			expect(next.selectedZoomId).toBeNull();
			expect(next.selectedTrimId).toBe("t1");
			expect(next.selectedSpeedId).toBeNull();
			expect(next.selectedChapterId).toBe("c1");
		});

		it("returns same reference when nothing is stale", () => {
			const state = { ...initial, selectedZoomId: "z1" };
			const next = selectionReducer(state, {
				type: "CLEAR_STALE",
				validIds: { ...emptyValidIds, selectedZoomId: ["z1"] },
			});
			expect(next).toBe(state);
		});

		it("handles all null selections without changes", () => {
			const next = selectionReducer(initial, {
				type: "CLEAR_STALE",
				validIds: emptyValidIds,
			});
			expect(next).toBe(initial);
		});
	});
});
