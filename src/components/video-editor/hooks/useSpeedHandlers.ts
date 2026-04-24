import type { Span } from "dnd-timeline";
import { useCallback, useMemo, useRef } from "react";
import type { EditorState } from "@/hooks/useEditorHistory";
import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed, type SpeedRegion } from "../types";
import { createSpanChangeHandler, resetIdRef } from "./regionReducers";

interface UseSpeedHandlersParams {
	pushState: (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;
	selectSpeed: (id: string | null) => void;
	selectedSpeedId: string | null;
}

export function useSpeedHandlers({
	pushState,
	selectSpeed,
	selectedSpeedId,
}: UseSpeedHandlersParams) {
	const nextIdRef = useRef(1);

	const handleSpeedAdded = useCallback(
		(span: Span) => {
			const id = `speed-${nextIdRef.current++}`;
			const newRegion: SpeedRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				speed: DEFAULT_PLAYBACK_SPEED,
			};
			pushState((prev) => ({ speedRegions: [...prev.speedRegions, newRegion] }));
			selectSpeed(id);
		},
		[pushState, selectSpeed],
	);

	const handleSpeedSpanChange = useMemo(
		() => createSpanChangeHandler(pushState, "speedRegions"),
		[pushState],
	);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.filter((r) => r.id !== id),
			}));
			if (selectedSpeedId === id) selectSpeed(null);
		},
		[selectedSpeedId, pushState, selectSpeed],
	);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === selectedSpeedId ? { ...region, speed } : region,
				),
			}));
		},
		[selectedSpeedId, pushState],
	);

	const resetIdCounter = useCallback((existingIds: string[]) => {
		resetIdRef(nextIdRef, "speed", existingIds);
	}, []);

	return {
		handleSpeedAdded,
		handleSpeedSpanChange,
		handleSpeedDelete,
		handleSpeedChange,
		resetIdCounter,
	};
}
