import { useCallback, useEffect, useReducer } from "react";

export interface SelectionState {
	selectedZoomId: string | null;
	selectedTrimId: string | null;
	selectedSpeedId: string | null;
	selectedAnnotationId: string | null;
	selectedChapterId: string | null;
	editingChapterId: string | null;
}

type SelectionAction =
	| { type: "SELECT_ZOOM"; id: string | null }
	| { type: "SELECT_TRIM"; id: string | null }
	| { type: "SELECT_SPEED"; id: string | null }
	| { type: "SELECT_ANNOTATION"; id: string | null }
	| { type: "SELECT_CHAPTER"; id: string | null }
	| { type: "SET_EDITING_CHAPTER"; id: string | null }
	| { type: "CLEAR_ALL" }
	| { type: "CLEAR_STALE"; validIds: Record<keyof Omit<SelectionState, "editingChapterId">, string[]> };

const INITIAL_STATE: SelectionState = {
	selectedZoomId: null,
	selectedTrimId: null,
	selectedSpeedId: null,
	selectedAnnotationId: null,
	selectedChapterId: null,
	editingChapterId: null,
};

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
	switch (action.type) {
		case "SELECT_ZOOM":
			return {
				...state,
				selectedZoomId: action.id,
				...(action.id ? { selectedTrimId: null } : {}),
			};
		case "SELECT_TRIM":
			return {
				...state,
				selectedTrimId: action.id,
				...(action.id ? { selectedZoomId: null, selectedAnnotationId: null } : {}),
			};
		case "SELECT_SPEED":
			return {
				...state,
				selectedSpeedId: action.id,
				...(action.id
					? { selectedZoomId: null, selectedTrimId: null, selectedAnnotationId: null }
					: {}),
			};
		case "SELECT_ANNOTATION":
			return {
				...state,
				selectedAnnotationId: action.id,
				...(action.id ? { selectedZoomId: null, selectedTrimId: null } : {}),
			};
		case "SELECT_CHAPTER":
			return { ...state, selectedChapterId: action.id };
		case "SET_EDITING_CHAPTER":
			return { ...state, editingChapterId: action.id };
		case "CLEAR_ALL":
			return { ...INITIAL_STATE };
		case "CLEAR_STALE": {
			const { validIds } = action;
			const next = { ...state };
			let changed = false;
			if (state.selectedZoomId && !validIds.selectedZoomId.includes(state.selectedZoomId)) {
				next.selectedZoomId = null;
				changed = true;
			}
			if (state.selectedTrimId && !validIds.selectedTrimId.includes(state.selectedTrimId)) {
				next.selectedTrimId = null;
				changed = true;
			}
			if (state.selectedSpeedId && !validIds.selectedSpeedId.includes(state.selectedSpeedId)) {
				next.selectedSpeedId = null;
				changed = true;
			}
			if (state.selectedAnnotationId && !validIds.selectedAnnotationId.includes(state.selectedAnnotationId)) {
				next.selectedAnnotationId = null;
				changed = true;
			}
			if (state.selectedChapterId && !validIds.selectedChapterId.includes(state.selectedChapterId)) {
				next.selectedChapterId = null;
				changed = true;
			}
			return changed ? next : state;
		}
		default:
			return state;
	}
}

interface RegionIdSets {
	zoomIds: string[];
	trimIds: string[];
	speedIds: string[];
	annotationIds: string[];
	chapterIds: string[];
}

export interface UseSelectionReturn extends SelectionState {
	selectZoom: (id: string | null) => void;
	selectTrim: (id: string | null) => void;
	selectSpeed: (id: string | null) => void;
	selectAnnotation: (id: string | null) => void;
	selectChapter: (id: string | null) => void;
	setEditingChapterId: (id: string | null) => void;
	clearAll: () => void;
}

export function useSelection(regions: RegionIdSets): UseSelectionReturn {
	const [state, dispatch] = useReducer(selectionReducer, INITIAL_STATE);

	const selectZoom = useCallback((id: string | null) => dispatch({ type: "SELECT_ZOOM", id }), []);
	const selectTrim = useCallback((id: string | null) => dispatch({ type: "SELECT_TRIM", id }), []);
	const selectSpeed = useCallback((id: string | null) => dispatch({ type: "SELECT_SPEED", id }), []);
	const selectAnnotation = useCallback((id: string | null) => dispatch({ type: "SELECT_ANNOTATION", id }), []);
	const selectChapter = useCallback((id: string | null) => dispatch({ type: "SELECT_CHAPTER", id }), []);
	const setEditingChapterId = useCallback((id: string | null) => dispatch({ type: "SET_EDITING_CHAPTER", id }), []);
	const clearAll = useCallback(() => dispatch({ type: "CLEAR_ALL" }), []);

	useEffect(() => {
		dispatch({
			type: "CLEAR_STALE",
			validIds: {
				selectedZoomId: regions.zoomIds,
				selectedTrimId: regions.trimIds,
				selectedSpeedId: regions.speedIds,
				selectedAnnotationId: regions.annotationIds,
				selectedChapterId: regions.chapterIds,
			},
		});
	}, [regions.zoomIds, regions.trimIds, regions.speedIds, regions.annotationIds, regions.chapterIds]);

	return {
		...state,
		selectZoom,
		selectTrim,
		selectSpeed,
		selectAnnotation,
		selectChapter,
		setEditingChapterId,
		clearAll,
	};
}
