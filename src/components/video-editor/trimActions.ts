import type { TrimRegion } from "./types";

export function computeStartFromNow(trim: TrimRegion, nowMs: number): number {
	return Math.max(0, Math.min(nowMs, trim.endMs - 100));
}

export function computeEndFromNow(trim: TrimRegion, nowMs: number): number {
	return Math.max(trim.startMs + 100, nowMs);
}

export function findAdjacentBefore(
	trimId: string,
	trimRegions: TrimRegion[],
): TrimRegion | null {
	const trim = trimRegions.find((r) => r.id === trimId);
	if (!trim) return null;
	const preceding = trimRegions
		.filter((r) => r.id !== trimId && r.endMs <= trim.startMs)
		.sort((a, b) => b.endMs - a.endMs);
	return preceding[0] ?? null;
}

export function findAdjacentAfter(
	trimId: string,
	trimRegions: TrimRegion[],
): TrimRegion | null {
	const trim = trimRegions.find((r) => r.id === trimId);
	if (!trim) return null;
	const following = trimRegions
		.filter((r) => r.id !== trimId && r.startMs >= trim.endMs)
		.sort((a, b) => a.startMs - b.startMs);
	return following[0] ?? null;
}

export function computeLoopRegion(
	trim: TrimRegion,
	totalMs: number,
	paddingMs = 5000,
): { startMs: number; endMs: number } {
	return {
		startMs: Math.max(0, trim.startMs - paddingMs),
		endMs: Math.min(totalMs, trim.endMs + paddingMs),
	};
}
