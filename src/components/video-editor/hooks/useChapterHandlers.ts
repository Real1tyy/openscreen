import { useCallback, useMemo, useRef } from "react";
import type { EditorState } from "@/hooks/useEditorHistory";
import type { ChapterMarker } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { createSpanChangeHandler, resetIdRef } from "./regionReducers";

interface UseChapterHandlersParams {
	pushState: (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;
	chapters: ChapterMarker[];
	selectChapter: (id: string | null) => void;
	selectedChapterId: string | null;
	setEditingChapterId: (id: string | null) => void;
	currentTimeRef: React.MutableRefObject<number>;
	durationRef: React.MutableRefObject<number>;
	videoPlaybackRef: React.RefObject<VideoPlaybackRef>;
}

export function useChapterHandlers({
	pushState,
	chapters,
	selectChapter,
	selectedChapterId,
	setEditingChapterId,
	currentTimeRef,
	durationRef,
	videoPlaybackRef,
}: UseChapterHandlersParams) {
	const nextIdRef = useRef(1);
	const chaptersRef = useRef(chapters);
	chaptersRef.current = chapters;

	const handleAddChapter = useCallback(() => {
		const totalMs = Math.round(durationRef.current * 1000);
		if (totalMs <= 0) return;
		const startMs = Math.max(0, Math.min(Math.round(currentTimeRef.current * 1000), totalMs - 100));
		const id = `chapter-${nextIdRef.current++}`;
		pushState((prev) => {
			const sorted = [...prev.chapters].sort((a, b) => a.startMs - b.startMs);
			const nextChapter = sorted.find((ch) => ch.startMs > startMs);
			const maxEnd = nextChapter ? nextChapter.startMs : totalMs;
			const endMs = Math.max(startMs + 100, maxEnd);
			return { chapters: [...prev.chapters, { id, startMs, endMs, name: "" }] };
		});
		setEditingChapterId(id);
		selectChapter(id);
	}, [pushState, setEditingChapterId, selectChapter, currentTimeRef, durationRef]);

	const handleRenameChapter = useCallback(
		(id: string, name: string) => {
			pushState((prev) => ({
				chapters: prev.chapters.map((ch) => (ch.id === id ? { ...ch, name } : ch)),
			}));
			setEditingChapterId(null);
		},
		[pushState, setEditingChapterId],
	);

	const handleChapterSpanChange = useMemo(
		() => createSpanChangeHandler(pushState, "chapters"),
		[pushState],
	);

	const handleSelectChapter = useCallback(
		(id: string | null) => {
			selectChapter(id);
			if (id) {
				const ch = chaptersRef.current.find((c) => c.id === id);
				if (ch) {
					const playback = videoPlaybackRef.current;
					if (playback?.video) playback.video.currentTime = ch.startMs / 1000;
				}
			}
		},
		[selectChapter, videoPlaybackRef],
	);

	const handleDeleteChapter = useCallback(
		(id: string) => {
			pushState((prev) => ({
				chapters: prev.chapters.filter((ch) => ch.id !== id),
			}));
			if (selectedChapterId === id) selectChapter(null);
		},
		[pushState, selectedChapterId, selectChapter],
	);

	const handleChapterNavigatePrev = useCallback(() => {
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const sorted = [...chaptersRef.current].sort((a, b) => a.startMs - b.startMs);
		const prev = [...sorted].reverse().find((ch) => ch.startMs < nowMs - 100);
		if (prev) {
			const playback = videoPlaybackRef.current;
			if (playback?.video) playback.video.currentTime = prev.startMs / 1000;
		}
	}, [currentTimeRef, videoPlaybackRef]);

	const handleChapterNavigateNext = useCallback(() => {
		const nowMs = Math.round(currentTimeRef.current * 1000);
		const sorted = [...chaptersRef.current].sort((a, b) => a.startMs - b.startMs);
		const next = sorted.find((ch) => ch.startMs > nowMs + 100);
		if (next) {
			const playback = videoPlaybackRef.current;
			if (playback?.video) playback.video.currentTime = next.startMs / 1000;
		}
	}, [currentTimeRef, videoPlaybackRef]);

	const resetIdCounter = useCallback((existingIds: string[]) => {
		resetIdRef(nextIdRef, "chapter", existingIds);
	}, []);

	return {
		handleAddChapter,
		handleRenameChapter,
		handleChapterSpanChange,
		handleSelectChapter,
		handleDeleteChapter,
		handleChapterNavigatePrev,
		handleChapterNavigateNext,
		resetIdCounter,
	};
}
