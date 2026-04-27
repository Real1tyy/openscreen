import { create } from "zustand";

interface SelectionState {
	selectedZoomId: string | null;
	selectedTrimId: string | null;
	selectedSpeedId: string | null;
	selectedAnnotationId: string | null;
	selectedChapterId: string | null;
	editingChapterId: string | null;

	selectZoom: (id: string | null) => void;
	selectTrim: (id: string | null) => void;
	selectSpeed: (id: string | null) => void;
	selectAnnotation: (id: string | null) => void;
	selectChapter: (id: string | null) => void;
	setEditingChapterId: (id: string | null) => void;
	clearAll: () => void;
	clearStale: (validIds: {
		zoomIds: string[];
		trimIds: string[];
		speedIds: string[];
		annotationIds: string[];
		chapterIds: string[];
	}) => void;
}

export const useEditorSelectionStore = create<SelectionState>()((set) => ({
	selectedZoomId: null,
	selectedTrimId: null,
	selectedSpeedId: null,
	selectedAnnotationId: null,
	selectedChapterId: null,
	editingChapterId: null,

	selectZoom: (id) =>
		set({
			selectedZoomId: id,
			...(id ? { selectedTrimId: null } : {}),
		}),

	selectTrim: (id) =>
		set({
			selectedTrimId: id,
			...(id ? { selectedZoomId: null, selectedAnnotationId: null } : {}),
		}),

	selectSpeed: (id) =>
		set({
			selectedSpeedId: id,
			...(id
				? { selectedZoomId: null, selectedTrimId: null, selectedAnnotationId: null }
				: {}),
		}),

	selectAnnotation: (id) =>
		set({
			selectedAnnotationId: id,
			...(id ? { selectedZoomId: null, selectedTrimId: null } : {}),
		}),

	selectChapter: (id) => set({ selectedChapterId: id }),
	setEditingChapterId: (id) => set({ editingChapterId: id }),

	clearAll: () =>
		set({
			selectedZoomId: null,
			selectedTrimId: null,
			selectedSpeedId: null,
			selectedAnnotationId: null,
			selectedChapterId: null,
			editingChapterId: null,
		}),

	clearStale: (validIds) =>
		set((s) => {
			const next = { ...s };
			let changed = false;
			if (s.selectedZoomId && !validIds.zoomIds.includes(s.selectedZoomId)) {
				next.selectedZoomId = null;
				changed = true;
			}
			if (s.selectedTrimId && !validIds.trimIds.includes(s.selectedTrimId)) {
				next.selectedTrimId = null;
				changed = true;
			}
			if (s.selectedSpeedId && !validIds.speedIds.includes(s.selectedSpeedId)) {
				next.selectedSpeedId = null;
				changed = true;
			}
			if (s.selectedAnnotationId && !validIds.annotationIds.includes(s.selectedAnnotationId)) {
				next.selectedAnnotationId = null;
				changed = true;
			}
			if (s.selectedChapterId && !validIds.chapterIds.includes(s.selectedChapterId)) {
				next.selectedChapterId = null;
				changed = true;
			}
			return changed ? next : {};
		}),
}));
