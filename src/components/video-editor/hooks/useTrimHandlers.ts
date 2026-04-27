import type { Span } from "dnd-timeline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "@/hooks/useEditorHistory";
import {
	computeEndFromNow,
	computeLoopRegion,
	computeStartFromNow,
	findAdjacentAfter,
	findAdjacentBefore,
} from "../trimActions";
import type { TrimRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { createSpanChangeHandler, resetIdRef } from "./regionReducers";

interface UseTrimHandlersParams {
	pushState: (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;
	trimRegions: TrimRegion[];
	selectTrim: (id: string | null) => void;
	selectedTrimId: string | null;
	currentTimeRef: React.MutableRefObject<number>;
	durationRef: React.MutableRefObject<number>;
	videoPlaybackRef: React.RefObject<VideoPlaybackRef>;
}

export function useTrimHandlers({
	pushState,
	trimRegions,
	selectTrim,
	selectedTrimId,
	currentTimeRef,
	durationRef,
	videoPlaybackRef,
}: UseTrimHandlersParams) {
	const nextIdRef = useRef(1);

	// Quick-trim state
	const [trimMarkStartMs, setTrimMarkStartMs] = useState<number | null>(null);
	const trimMarkStartMsRef = useRef(trimMarkStartMs);
	trimMarkStartMsRef.current = trimMarkStartMs;

	// Loop state
	const [loopRegion, setLoopRegion] = useState<{ startMs: number; endMs: number } | null>(null);
	const [loopingTrimId, setLoopingTrimId] = useState<string | null>(null);

	const clearLoop = useCallback(() => {
		setLoopRegion(null);
		setLoopingTrimId(null);
	}, []);

	useEffect(() => {
		if (loopingTrimId && !trimRegions.some((r) => r.id === loopingTrimId)) {
			clearLoop();
		}
	}, [loopingTrimId, trimRegions, clearLoop]);

	// ── Core handlers ──

	const handleTrimAdded = useCallback(
		(span: Span) => {
			const id = `trim-${nextIdRef.current++}`;
			const newRegion: TrimRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
			};
			pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
			selectTrim(id);
		},
		[pushState, selectTrim],
	);

	const handleTrimSpanChange = useMemo(
		() => createSpanChangeHandler(pushState, "trimRegions"),
		[pushState],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.filter((r) => r.id !== id),
			}));
			if (selectedTrimId === id) selectTrim(null);
		},
		[selectedTrimId, pushState, selectTrim],
	);

	// ── Context menu handlers (DRY via shared helpers) ──

	const updateTrimField = useCallback(
		(id: string, updater: (r: TrimRegion) => Partial<TrimRegion>) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.map((r) =>
					r.id === id ? { ...r, ...updater(r) } : r,
				),
			}));
		},
		[pushState],
	);

	const handleTrimSetStartToNow = useCallback(
		(id: string) => {
			const nowMs = Math.round(currentTimeRef.current * 1000);
			updateTrimField(id, (r) => ({ startMs: computeStartFromNow(r, nowMs) }));
		},
		[updateTrimField, currentTimeRef],
	);

	const handleTrimSetEndToNow = useCallback(
		(id: string) => {
			const nowMs = Math.round(currentTimeRef.current * 1000);
			updateTrimField(id, (r) => ({ endMs: computeEndFromNow(r, nowMs) }));
		},
		[updateTrimField, currentTimeRef],
	);

	const handleTrimSetStartFromAdjacent = useCallback(
		(id: string) => {
			const adjacent = findAdjacentBefore(id, trimRegions);
			if (adjacent) updateTrimField(id, () => ({ startMs: adjacent.endMs }));
		},
		[trimRegions, updateTrimField],
	);

	const handleTrimSetEndFromAdjacent = useCallback(
		(id: string) => {
			const adjacent = findAdjacentAfter(id, trimRegions);
			if (adjacent) updateTrimField(id, () => ({ endMs: adjacent.startMs }));
		},
		[trimRegions, updateTrimField],
	);

	// ── Playback helpers ──

	const seekAndPlay = useCallback((seekToSec: number) => {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = seekToSec;
		setTimeout(() => {
			videoPlaybackRef.current?.play().catch(console.error);
		}, 50);
	}, [videoPlaybackRef]);

	const withTrim = useCallback(
		(id: string, fn: (trim: TrimRegion) => void) => {
			const trim = trimRegions.find((r) => r.id === id);
			if (trim) fn(trim);
		},
		[trimRegions],
	);

	const handleTrimPlayFromStart = useCallback(
		(id: string) => withTrim(id, (trim) => {
			clearLoop();
			seekAndPlay(Math.max(0, trim.startMs - 5000) / 1000);
		}),
		[withTrim, clearLoop, seekAndPlay],
	);

	const handleTrimPlayFromEnd = useCallback(
		(id: string) => withTrim(id, (trim) => {
			clearLoop();
			seekAndPlay(trim.endMs / 1000);
		}),
		[withTrim, clearLoop, seekAndPlay],
	);

	const handleTrimToggleLoop = useCallback(
		(id: string) => {
			if (loopingTrimId === id) { clearLoop(); return; }
			withTrim(id, (trim) => {
				const region = computeLoopRegion(trim, Math.round(durationRef.current * 1000));
				setLoopRegion(region);
				setLoopingTrimId(id);
				seekAndPlay(region.startMs / 1000);
			});
		},
		[loopingTrimId, withTrim, clearLoop, seekAndPlay, durationRef],
	);

	// ── Quick-trim keyboard actions ──

	const handleQuickTrimStart = useCallback(() => {
		setTrimMarkStartMs(Math.round(currentTimeRef.current * 1000));
	}, [currentTimeRef]);

	const handleQuickTrimEnd = useCallback(() => {
		const startMs = trimMarkStartMsRef.current;
		if (startMs == null) return;
		const endMs = Math.round(currentTimeRef.current * 1000);
		if (endMs <= startMs) return;
		const id = `trim-${nextIdRef.current++}`;
		pushState((prev) => ({
			trimRegions: [...prev.trimRegions, { id, startMs, endMs }],
		}));
		selectTrim(id);
		setTrimMarkStartMs(null);
	}, [pushState, selectTrim, currentTimeRef]);

	const handleTrimDuplicate = useCallback(
		(id: string) => {
			pushState((prev) => {
				const original = prev.trimRegions.find((r) => r.id === id);
				if (!original) return {};
				const duration = original.endMs - original.startMs;
				const newId = `trim-${nextIdRef.current++}`;
				return {
					trimRegions: [
						...prev.trimRegions,
						{ id: newId, startMs: original.endMs, endMs: original.endMs + duration },
					],
				};
			});
		},
		[pushState],
	);

	const resetIdCounter = useCallback((existingIds: string[]) => {
		resetIdRef(nextIdRef, "trim", existingIds);
	}, []);

	return {
		// Core
		handleTrimAdded,
		handleTrimSpanChange,
		handleTrimDelete,
		handleTrimDuplicate,
		// Context menu
		handleTrimSetStartToNow,
		handleTrimSetEndToNow,
		handleTrimSetStartFromAdjacent,
		handleTrimSetEndFromAdjacent,
		handleTrimPlayFromStart,
		handleTrimPlayFromEnd,
		handleTrimToggleLoop,
		// Loop state
		loopRegion,
		loopingTrimId,
		clearLoop,
		// Quick-trim
		trimMarkStartMs,
		handleQuickTrimStart,
		handleQuickTrimEnd,
		// Reset
		resetIdCounter,
	};
}
