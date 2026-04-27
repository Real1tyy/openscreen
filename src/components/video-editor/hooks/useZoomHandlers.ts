import type { Span } from "dnd-timeline";
import { useCallback, useMemo, useRef } from "react";
import type { EditorState } from "@/hooks/useEditorHistory";
import {
	clampFocusToDepth,
	DEFAULT_ZOOM_DEPTH,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
} from "../types";
import { createSpanChangeHandler, resetIdRef } from "./regionReducers";

interface UseZoomHandlersParams {
	pushState: (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;
	updateState: (
		update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>),
	) => void;
	selectZoom: (id: string | null) => void;
	selectedZoomId: string | null;
}

export function useZoomHandlers({
	pushState,
	updateState,
	selectZoom,
	selectedZoomId,
}: UseZoomHandlersParams) {
	const nextIdRef = useRef(1);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				focus: { cx: 0.5, cy: 0.5 },
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			selectZoom(id);
		},
		[pushState, selectZoom],
	);

	const handleZoomSuggested = useCallback(
		(span: Span, focus: ZoomFocus) => {
			const id = `zoom-${nextIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH),
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			selectZoom(id);
		},
		[pushState, selectZoom],
	);

	const handleZoomSpanChange = useMemo(
		() => createSpanChangeHandler(pushState, "zoomRegions"),
		[pushState],
	);

	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id ? { ...region, focus: clampFocusToDepth(focus, region.depth) } : region,
				),
			}));
		},
		[updateState],
	);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								customScale: undefined,
								focus: clampFocusToDepth(region.focus, depth),
							}
						: region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomFocusModeChange = useCallback(
		(focusMode: ZoomFocusMode) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, focusMode } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomCustomScaleChange = useCallback(
		(customScale: number | undefined) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, customScale } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomDuplicate = useCallback(
		(id: string) => {
			pushState((prev) => {
				const source = prev.zoomRegions.find((r) => r.id === id);
				if (!source) return {};
				const newId = `zoom-${nextIdRef.current++}`;
				const duration = source.endMs - source.startMs;
				const clone: ZoomRegion = {
					...source,
					id: newId,
					startMs: source.endMs,
					endMs: source.endMs + duration,
				};
				return { zoomRegions: [...prev.zoomRegions, clone] };
			});
		},
		[pushState],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
			}));
			if (selectedZoomId === id) selectZoom(null);
		},
		[selectedZoomId, pushState, selectZoom],
	);

	const resetIdCounter = useCallback((existingIds: string[]) => {
		resetIdRef(nextIdRef, "zoom", existingIds);
	}, []);

	return {
		handleZoomAdded,
		handleZoomSuggested,
		handleZoomSpanChange,
		handleZoomFocusChange,
		handleZoomDepthChange,
		handleZoomFocusModeChange,
		handleZoomCustomScaleChange,
		handleZoomDuplicate,
		handleZoomDelete,
		resetIdCounter,
	};
}
