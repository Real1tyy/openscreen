/**
 * "01:02" — zero-padded minutes and floored seconds.
 * Used for display contexts that need fixed-width columns (e.g. launch window).
 */
export function formatTimePadded(seconds: number) {
	const m = Math.floor(seconds / 60)
		.toString()
		.padStart(2, "0");
	const s = (seconds % 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}

/**
 * "1:02" — compact minutes:seconds for playback controls.
 * Returns "0:00" for invalid input.
 */
export function formatTimePlayback(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * "1:02.34" or "2.34s" — millisecond input, two-decimal precision.
 * Shows "Xs" for sub-minute values, "M:SS.ss" for longer values.
 * Used for timeline items, trim badges, and playhead tooltips.
 */
export function formatMsCompact(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
	}
	return `${seconds.toFixed(2)}s`;
}
