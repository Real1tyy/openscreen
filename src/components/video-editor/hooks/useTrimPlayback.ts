import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/useEditorStore";
import type { VideoPlaybackRef } from "../VideoPlayback";

export function useTrimPlayback(
	videoPlaybackRef: React.RefObject<VideoPlaybackRef>,
	currentTimeRef: React.MutableRefObject<number>,
	durationRef: React.MutableRefObject<number>,
) {
	const trimRegions = useEditorStore((s) => s.trimRegions);
	const addAndSelectTrim = useEditorStore((s) => s.addAndSelectTrim);

	const [loopRegion, setLoopRegion] = useState<{ startMs: number; endMs: number } | null>(null);
	const [loopingTrimId, setLoopingTrimId] = useState<string | null>(null);
	const clearLoop = useCallback(() => { setLoopRegion(null); setLoopingTrimId(null); }, []);

	useEffect(() => {
		if (loopingTrimId && !trimRegions.some((r) => r.id === loopingTrimId)) clearLoop();
	}, [loopingTrimId, trimRegions, clearLoop]);

	const seekAndPlay = useCallback((seekToSec: number) => {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = seekToSec;
		setTimeout(() => { videoPlaybackRef.current?.play().catch(console.error); }, 50);
	}, [videoPlaybackRef]);

	const handleTrimPlayFromStart = useCallback(
		(id: string) => {
			const trim = trimRegions.find((r) => r.id === id);
			if (trim) { clearLoop(); seekAndPlay(Math.max(0, trim.startMs - 5000) / 1000); }
		},
		[trimRegions, clearLoop, seekAndPlay],
	);

	const handleTrimPlayFromEnd = useCallback(
		(id: string) => {
			const trim = trimRegions.find((r) => r.id === id);
			if (trim) { clearLoop(); seekAndPlay(trim.endMs / 1000); }
		},
		[trimRegions, clearLoop, seekAndPlay],
	);

	const handleTrimToggleLoop = useCallback(
		(id: string) => {
			if (loopingTrimId === id) { clearLoop(); return; }
			const trim = trimRegions.find((r) => r.id === id);
			if (!trim) return;
			const totalMs = Math.round(durationRef.current * 1000);
			const region = { startMs: Math.max(0, trim.startMs - 3000), endMs: Math.min(totalMs, trim.endMs + 3000) };
			setLoopRegion(region);
			setLoopingTrimId(id);
			seekAndPlay(region.startMs / 1000);
		},
		[loopingTrimId, trimRegions, clearLoop, seekAndPlay, durationRef],
	);

	// Quick-trim
	const [trimMarkStartMs, setTrimMarkStartMs] = useState<number | null>(null);
	const trimMarkStartMsRef = useRef(trimMarkStartMs);
	trimMarkStartMsRef.current = trimMarkStartMs;

	const handleQuickTrimStart = useCallback(() => {
		setTrimMarkStartMs(Math.round(currentTimeRef.current * 1000));
	}, [currentTimeRef]);

	const handleQuickTrimEnd = useCallback(() => {
		const startMs = trimMarkStartMsRef.current;
		if (startMs == null) return;
		const endMs = Math.round(currentTimeRef.current * 1000);
		if (endMs <= startMs) return;
		addAndSelectTrim({ start: startMs, end: endMs });
		setTrimMarkStartMs(null);
	}, [addAndSelectTrim, currentTimeRef]);

	return {
		loopRegion,
		loopingTrimId,
		clearLoop,
		trimMarkStartMs,
		handleTrimPlayFromStart,
		handleTrimPlayFromEnd,
		handleTrimToggleLoop,
		handleQuickTrimStart,
		handleQuickTrimEnd,
	};
}
