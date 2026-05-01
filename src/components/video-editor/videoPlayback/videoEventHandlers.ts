import type React from "react";
import type { SpeedRegion, TrimRegion } from "../types";

interface VideoEventHandlersParams {
	video: HTMLVideoElement;
	isSeekingRef: React.MutableRefObject<boolean>;
	isPlayingRef: React.MutableRefObject<boolean>;
	allowPlaybackRef: React.MutableRefObject<boolean>;
	currentTimeRef: React.MutableRefObject<number>;
	timeUpdateAnimationRef: React.MutableRefObject<number | null>;
	onPlayStateChange: (playing: boolean) => void;
	onTimeUpdate: (time: number) => void;
	trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
	speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
	loopRegionRef: React.MutableRefObject<{ startMs: number; endMs: number } | null>;
	previewSpeedRef: React.MutableRefObject<number>;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
	const {
		video,
		isSeekingRef,
		isPlayingRef,
		allowPlaybackRef,
		currentTimeRef,
		timeUpdateAnimationRef,
		onPlayStateChange,
		onTimeUpdate,
		trimRegionsRef,
		speedRegionsRef,
		loopRegionRef,
		previewSpeedRef,
	} = params;

	const emitTime = (timeValue: number) => {
		currentTimeRef.current = timeValue * 1000;
		onTimeUpdate(timeValue);
	};

	// Helper function to check if current time is within a trim region
	const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
		const trimRegions = trimRegionsRef.current;
		return (
			trimRegions.find(
				(region) =>
					!region.disabled && currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	// Helper function to find the active speed region at the current time
	const findActiveSpeedRegion = (currentTimeMs: number): SpeedRegion | null => {
		return (
			speedRegionsRef.current.find(
				(region) =>
					!region.disabled && currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	function updateTime() {
		if (!video) return;

		const currentTimeMs = video.currentTime * 1000;
		const loopRegion = loopRegionRef.current;

		// Loop boundary: if past end, seek back to start
		if (loopRegion && !video.paused && !video.ended && currentTimeMs >= loopRegion.endMs) {
			video.currentTime = loopRegion.startMs / 1000;
			emitTime(video.currentTime);
			timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
			return;
		}

		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// If we're in a trim region during playback, skip to the end of it
		if (activeTrimRegion && !video.paused && !video.ended) {
			const skipToMs = activeTrimRegion.endMs;

			// If loop is active and skip would go past loop end, loop back
			if (loopRegion && skipToMs >= loopRegion.endMs) {
				video.currentTime = loopRegion.startMs / 1000;
				emitTime(video.currentTime);
			} else if (skipToMs / 1000 >= video.duration) {
				video.pause();
			} else {
				video.currentTime = skipToMs / 1000;
				emitTime(video.currentTime);
			}
		} else {
			// Apply playback speed: region speed * preview speed multiplier
			const activeSpeedRegion = findActiveSpeedRegion(currentTimeMs);
			const regionSpeed = activeSpeedRegion ? activeSpeedRegion.speed : 1;
			const previewSpeed = previewSpeedRef.current;
			video.playbackRate = regionSpeed * previewSpeed;
			emitTime(video.currentTime);
		}

		if (!video.paused && !video.ended) {
			timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
		}
	}

	const handlePlay = () => {
		if (isSeekingRef.current) {
			video.pause();
			return;
		}

		if (!allowPlaybackRef.current) {
			video.pause();
			return;
		}

		isPlayingRef.current = true;
		onPlayStateChange(true);
		if (timeUpdateAnimationRef.current) {
			cancelAnimationFrame(timeUpdateAnimationRef.current);
		}
		timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
	};

	const handlePause = () => {
		isPlayingRef.current = false;
		onPlayStateChange(false);
		if (timeUpdateAnimationRef.current) {
			cancelAnimationFrame(timeUpdateAnimationRef.current);
			timeUpdateAnimationRef.current = null;
		}
		emitTime(video.currentTime);
	};

	const handleSeeked = () => {
		isSeekingRef.current = false;

		const currentTimeMs = video.currentTime * 1000;
		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// If we seeked into a trim region while playing, skip to the end
		if (activeTrimRegion && isPlayingRef.current && !video.paused) {
			const skipToTime = activeTrimRegion.endMs / 1000;

			if (skipToTime >= video.duration) {
				video.pause();
			} else {
				video.currentTime = skipToTime;
				emitTime(skipToTime);
			}
		} else {
			if (!isPlayingRef.current && !video.paused) {
				video.pause();
			}
			emitTime(video.currentTime);
		}
	};

	const handleSeeking = () => {
		isSeekingRef.current = true;

		if (!isPlayingRef.current && !video.paused) {
			video.pause();
		}
		emitTime(video.currentTime);
	};

	return {
		handlePlay,
		handlePause,
		handleSeeked,
		handleSeeking,
	};
}
