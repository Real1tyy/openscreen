export function normalizeRegionSpan(
	region: { startMs: number; endMs: number },
	totalMs: number,
	minDurationMs: number,
): { startMs: number; endMs: number } | null {
	const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
	const minEnd = clampedStart + minDurationMs;
	const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
	const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - minDurationMs));
	const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));
	if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
		return { startMs: normalizedStart, endMs: normalizedEnd };
	}
	return null;
}

export function computeNewRegionSpan(
	regions: Array<{ startMs: number; endMs: number }>,
	startPos: number,
	defaultDuration: number,
	totalMs: number,
): { startMs: number; endMs: number; isOverlapping: boolean } {
	const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);
	const isOverlapping = sorted.some(
		(r) => startPos >= r.startMs && startPos < r.endMs,
	);
	const nextRegion = sorted.find((r) => r.startMs > startPos);
	const maxEnd = nextRegion ? nextRegion.startMs : totalMs;
	const endMs = Math.min(startPos + defaultDuration, maxEnd);
	return { startMs: startPos, endMs, isOverlapping };
}
