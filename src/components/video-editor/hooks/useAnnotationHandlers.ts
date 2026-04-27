import type { Span } from "dnd-timeline";
import { useCallback, useMemo, useRef } from "react";
import type { EditorState } from "@/hooks/useEditorHistory";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	type FigureData,
} from "../types";
import { createSpanChangeHandler, deriveNextIdFromList } from "./regionReducers";

interface UseAnnotationHandlersParams {
	pushState: (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;
	selectAnnotation: (id: string | null) => void;
	selectedAnnotationId: string | null;
}

export function useAnnotationHandlers({
	pushState,
	selectAnnotation,
	selectedAnnotationId,
}: UseAnnotationHandlersParams) {
	const nextIdRef = useRef(1);
	const nextZIndexRef = useRef(1);

	const handleAnnotationAdded = useCallback(
		(span: Span) => {
			const id = `annotation-${nextIdRef.current++}`;
			const zIndex = nextZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				type: "text",
				content: "Enter text...",
				position: { ...DEFAULT_ANNOTATION_POSITION },
				size: { ...DEFAULT_ANNOTATION_SIZE },
				style: { ...DEFAULT_ANNOTATION_STYLE },
				zIndex,
			};
			pushState((prev) => ({
				annotationRegions: [...prev.annotationRegions, newRegion],
			}));
			selectAnnotation(id);
		},
		[pushState, selectAnnotation],
	);

	const handleAnnotationSpanChange = useMemo(
		() => createSpanChangeHandler(pushState, "annotationRegions"),
		[pushState],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.filter((r) => r.id !== id),
			}));
			if (selectedAnnotationId === id) selectAnnotation(null);
		},
		[selectedAnnotationId, pushState, selectAnnotation],
	);

	const updateAnnotation = useCallback(
		(id: string, updater: (region: AnnotationRegion) => Partial<AnnotationRegion>) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id ? { ...region, ...updater(region) } : region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			updateAnnotation(id, (region) => {
				if (region.type === "text") return { content, textContent: content };
				if (region.type === "image") return { content, imageContent: content };
				return { content };
			});
		},
		[updateAnnotation],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			updateAnnotation(id, (region) => {
				const update: Partial<AnnotationRegion> = { type };
				if (type === "text") {
					update.content = region.textContent || "Enter text...";
				} else if (type === "image") {
					update.content = region.imageContent || "";
				} else if (type === "figure") {
					update.content = "";
					if (!region.figureData) update.figureData = { ...DEFAULT_FIGURE_DATA };
				}
				return update;
			});
		},
		[updateAnnotation],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			updateAnnotation(id, (region) => ({ style: { ...region.style, ...style } }));
		},
		[updateAnnotation],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => {
			updateAnnotation(id, () => ({ figureData }));
		},
		[updateAnnotation],
	);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			updateAnnotation(id, () => ({ position }));
		},
		[updateAnnotation],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			updateAnnotation(id, () => ({ size }));
		},
		[updateAnnotation],
	);

	const handleAnnotationDuplicate = useCallback(
		(id: string) => {
			pushState((prev) => {
				const original = prev.annotationRegions.find((r) => r.id === id);
				if (!original) return {};
				const duration = original.endMs - original.startMs;
				const newId = `annotation-${nextIdRef.current++}`;
				const clone: AnnotationRegion = {
					...original,
					id: newId,
					startMs: original.endMs,
					endMs: original.endMs + duration,
					zIndex: nextZIndexRef.current++,
				};
				return { annotationRegions: [...prev.annotationRegions, clone] };
			});
		},
		[pushState],
	);

	const resetIdCounters = useCallback((existingRegions: AnnotationRegion[]) => {
		nextIdRef.current = deriveNextIdFromList("annotation", existingRegions.map((r) => r.id));
		nextZIndexRef.current = existingRegions.reduce((max, r) => Math.max(max, r.zIndex), 0) + 1;
	}, []);

	return {
		handleAnnotationAdded,
		handleAnnotationSpanChange,
		handleAnnotationDelete,
		handleAnnotationDuplicate,
		handleAnnotationContentChange,
		handleAnnotationTypeChange,
		handleAnnotationStyleChange,
		handleAnnotationFigureDataChange,
		handleAnnotationPositionChange,
		handleAnnotationSizeChange,
		resetIdCounters,
	};
}
