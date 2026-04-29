import { useEffect } from "react";
import { computeSeekTime } from "@/lib/frameStep";
import type { ShortcutsConfig } from "@/lib/shortcuts";
import { matchesShortcut } from "@/lib/shortcuts";
import { useEditorPreferencesStore } from "@/stores/useEditorPreferencesStore";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseEditorKeyboardParams {
	undo: () => void;
	redo: () => void;
	shortcuts: ShortcutsConfig;
	isMac: boolean;
	videoPlaybackRef: React.RefObject<VideoPlaybackRef | null>;
	durationRef: React.MutableRefObject<number>;
	handleQuickTrimStart: () => void;
	handleQuickTrimEnd: () => void;
	handleAddChapter: () => void;
	handleChapterNavigatePrev: () => void;
	handleChapterNavigateNext: () => void;
	toggleFullscreen: () => void;
}

export function useEditorKeyboard(params: UseEditorKeyboardParams) {
	const {
		undo,
		redo,
		shortcuts,
		isMac,
		videoPlaybackRef,
		durationRef,
		handleQuickTrimStart,
		handleQuickTrimEnd,
		handleAddChapter,
		handleChapterNavigatePrev,
		handleChapterNavigateNext,
		toggleFullscreen,
	} = params;

	const seekSmallSeconds = useEditorPreferencesStore((s) => s.seekSmallSeconds);
	const seekLargeSeconds = useEditorPreferencesStore((s) => s.seekLargeSeconds);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (mod && key === "z" && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				undo();
				return;
			}
			if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
				e.preventDefault();
				e.stopPropagation();
				redo();
				return;
			}

			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey
			) {
				const target = e.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
				) {
					return;
				}
				e.preventDefault();
				const video = videoPlaybackRef.current?.video;
				if (!video) return;
				const direction = e.key === "ArrowLeft" ? "backward" : "forward";
				const seconds = e.shiftKey ? seekLargeSeconds : seekSmallSeconds;
				const dur = Number.isFinite(video.duration) ? video.duration : durationRef.current;
				video.currentTime = computeSeekTime(video.currentTime, dur, direction, seconds);
				return;
			}

			const isInput =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

			if (e.key === "Tab" && !isInput) {
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				if (isInput) return;
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					playback.video.paused ? playback.play().catch(console.error) : playback.pause();
				}
			}

			if (isInput) return;
			if (key === "i" && !mod && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				handleQuickTrimStart();
			}
			if (key === "o" && !mod && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				handleQuickTrimEnd();
			}

			if (key === "f" && !mod && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				toggleFullscreen();
			}
			if (key === "c" && !mod && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				handleAddChapter();
			}
			if (key === "[" && !mod && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				handleChapterNavigatePrev();
			}
			if (key === "]" && !mod && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				handleChapterNavigateNext();
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [
		undo,
		redo,
		shortcuts,
		isMac,
		videoPlaybackRef,
		durationRef,
		handleQuickTrimStart,
		handleQuickTrimEnd,
		handleAddChapter,
		handleChapterNavigatePrev,
		handleChapterNavigateNext,
		toggleFullscreen,
		seekSmallSeconds,
		seekLargeSeconds,
	]);
}
