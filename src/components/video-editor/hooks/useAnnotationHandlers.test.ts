import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_EDITOR_STATE, type EditorState } from "@/hooks/useEditorHistory";
import {
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	type AnnotationRegion,
} from "../types";
import { useAnnotationHandlers } from "./useAnnotationHandlers";

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

function makeAnnotation(overrides: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "annotation-1",
		startMs: 0,
		endMs: 1000,
		type: "text",
		content: "Hello",
		position: { ...DEFAULT_ANNOTATION_POSITION },
		size: { ...DEFAULT_ANNOTATION_SIZE },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: 1,
		...overrides,
	};
}

function setup(selectedAnnotationId: string | null = null) {
	const pushState = vi.fn();
	const selectAnnotation = vi.fn();
	const { result } = renderHook(() =>
		useAnnotationHandlers({ pushState, selectAnnotation, selectedAnnotationId }),
	);
	return { result, pushState, selectAnnotation };
}

describe("useAnnotationHandlers", () => {
	describe("handleAnnotationAdded", () => {
		it("creates a text annotation with defaults", () => {
			const { result, pushState, selectAnnotation } = setup();
			act(() => result.current.handleAnnotationAdded({ start: 500, end: 2500 }));

			const state = applyUpdate(pushState);
			expect(state.annotationRegions).toHaveLength(1);
			const r = state.annotationRegions[0];
			expect(r.id).toBe("annotation-1");
			expect(r.startMs).toBe(500);
			expect(r.endMs).toBe(2500);
			expect(r.type).toBe("text");
			expect(r.content).toBe("Enter text...");
			expect(r.zIndex).toBe(1);
			expect(selectAnnotation).toHaveBeenCalledWith("annotation-1");
		});

		it("increments zIndex for each new annotation", () => {
			const { result, pushState } = setup();
			act(() => result.current.handleAnnotationAdded({ start: 0, end: 1000 }));
			act(() => result.current.handleAnnotationAdded({ start: 2000, end: 3000 }));

			const r1 = applyUpdate(pushState, INITIAL_EDITOR_STATE, 0);
			const r2 = applyUpdate(pushState, INITIAL_EDITOR_STATE, 1);
			expect(r1.annotationRegions[0].zIndex).toBe(1);
			expect(r2.annotationRegions[0].zIndex).toBe(2);
		});
	});

	describe("handleAnnotationDelete", () => {
		it("removes the annotation and clears selection", () => {
			const pushState = vi.fn();
			const selectAnnotation = vi.fn();
			const { result } = renderHook(() =>
				useAnnotationHandlers({ pushState, selectAnnotation, selectedAnnotationId: "annotation-1" }),
			);

			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation(), makeAnnotation({ id: "annotation-2", zIndex: 2 })],
			};

			act(() => result.current.handleAnnotationDelete("annotation-1"));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions).toHaveLength(1);
			expect(state.annotationRegions[0].id).toBe("annotation-2");
			expect(selectAnnotation).toHaveBeenCalledWith(null);
		});
	});

	describe("handleAnnotationContentChange", () => {
		it("updates content and textContent for text type", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation({ type: "text" })],
			};

			act(() => result.current.handleAnnotationContentChange("annotation-1", "New text"));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].content).toBe("New text");
			expect(state.annotationRegions[0].textContent).toBe("New text");
		});

		it("updates content and imageContent for image type", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation({ type: "image" })],
			};

			act(() => result.current.handleAnnotationContentChange("annotation-1", "data:image/png;base64,..."));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].content).toBe("data:image/png;base64,...");
			expect(state.annotationRegions[0].imageContent).toBe("data:image/png;base64,...");
		});
	});

	describe("handleAnnotationTypeChange", () => {
		it("switches to text and restores textContent", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation({ type: "image", textContent: "Saved text" })],
			};

			act(() => result.current.handleAnnotationTypeChange("annotation-1", "text"));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].type).toBe("text");
			expect(state.annotationRegions[0].content).toBe("Saved text");
		});

		it("switches to figure and adds default figureData when none exists", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation({ type: "text" })],
			};

			act(() => result.current.handleAnnotationTypeChange("annotation-1", "figure"));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].type).toBe("figure");
			expect(state.annotationRegions[0].content).toBe("");
			expect(state.annotationRegions[0].figureData).toEqual(DEFAULT_FIGURE_DATA);
		});

		it("does not overwrite existing figureData when switching to figure", () => {
			const { result, pushState } = setup();
			const customFigure = { arrowDirection: "up" as const, color: "#ff0000", strokeWidth: 8 };
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation({ type: "text", figureData: customFigure })],
			};

			act(() => result.current.handleAnnotationTypeChange("annotation-1", "figure"));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].figureData).toEqual(customFigure);
		});
	});

	describe("handleAnnotationStyleChange", () => {
		it("merges partial style update", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation()],
			};

			act(() => result.current.handleAnnotationStyleChange("annotation-1", { color: "#ff0000", fontSize: 48 }));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].style.color).toBe("#ff0000");
			expect(state.annotationRegions[0].style.fontSize).toBe(48);
			expect(state.annotationRegions[0].style.fontFamily).toBe(DEFAULT_ANNOTATION_STYLE.fontFamily);
		});
	});

	describe("handleAnnotationPositionChange", () => {
		it("updates position", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation()],
			};

			act(() => result.current.handleAnnotationPositionChange("annotation-1", { x: 10, y: 20 }));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].position).toEqual({ x: 10, y: 20 });
		});
	});

	describe("handleAnnotationSizeChange", () => {
		it("updates size", () => {
			const { result, pushState } = setup();
			const existing: EditorState = {
				...INITIAL_EDITOR_STATE,
				annotationRegions: [makeAnnotation()],
			};

			act(() => result.current.handleAnnotationSizeChange("annotation-1", { width: 50, height: 40 }));

			const state = applyUpdate(pushState, existing);
			expect(state.annotationRegions[0].size).toEqual({ width: 50, height: 40 });
		});
	});

	describe("resetIdCounters", () => {
		it("resets both ID and zIndex counters", () => {
			const { result, pushState } = setup();

			act(() =>
				result.current.resetIdCounters([
					makeAnnotation({ id: "annotation-5", zIndex: 3 }),
					makeAnnotation({ id: "annotation-2", zIndex: 7 }),
				]),
			);
			act(() => result.current.handleAnnotationAdded({ start: 0, end: 1000 }));

			const state = applyUpdate(pushState);
			expect(state.annotationRegions[0].id).toBe("annotation-6");
			expect(state.annotationRegions[0].zIndex).toBe(8);
		});
	});
});
