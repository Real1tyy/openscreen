import type { SpeedRegion, TrimRegion } from "./types";

export function computeStartFromNow(trim: TrimRegion, nowMs: number): number {
	return Math.max(0, Math.min(nowMs, trim.endMs - 100));
}

export function computeEndFromNow(trim: TrimRegion, nowMs: number): number {
	return Math.max(trim.startMs + 100, nowMs);
}

export function findAdjacentBefore(trimId: string, trimRegions: TrimRegion[]): TrimRegion | null {
	const trim = trimRegions.find((r) => r.id === trimId);
	if (!trim) return null;
	const preceding = trimRegions
		.filter((r) => r.id !== trimId && r.endMs <= trim.startMs)
		.sort((a, b) => b.endMs - a.endMs);
	return preceding[0] ?? null;
}

export function findAdjacentAfter(trimId: string, trimRegions: TrimRegion[]): TrimRegion | null {
	const trim = trimRegions.find((r) => r.id === trimId);
	if (!trim) return null;
	const following = trimRegions
		.filter((r) => r.id !== trimId && r.startMs >= trim.endMs)
		.sort((a, b) => a.startMs - b.startMs);
	return following[0] ?? null;
}

export function mergeOverlapping(
	targetId: string,
	trimRegions: TrimRegion[],
): { merged: TrimRegion[]; absorbedIds: string[] } {
	const target = trimRegions.find((r) => r.id === targetId);
	if (!target) return { merged: trimRegions, absorbedIds: [] };

	const absorbed: string[] = [];
	let startMs = target.startMs;
	let endMs = target.endMs;

	for (const r of trimRegions) {
		if (r.id === targetId) continue;
		if (r.startMs < endMs && r.endMs > startMs) {
			startMs = Math.min(startMs, r.startMs);
			endMs = Math.max(endMs, r.endMs);
			absorbed.push(r.id);
		}
	}

	if (absorbed.length === 0) return { merged: trimRegions, absorbedIds: [] };

	const merged = trimRegions
		.filter((r) => !absorbed.includes(r.id))
		.map((r) => (r.id === targetId ? { ...r, startMs, endMs } : r));

	return { merged, absorbedIds: absorbed };
}

export function mergeOverlappingSpeeds(
	targetId: string,
	speedRegions: SpeedRegion[],
): { merged: SpeedRegion[]; absorbedIds: string[] } {
	const target = speedRegions.find((r) => r.id === targetId);
	if (!target) return { merged: speedRegions, absorbedIds: [] };

	const absorbed: string[] = [];
	let startMs = target.startMs;
	let endMs = target.endMs;

	for (const r of speedRegions) {
		if (r.id === targetId) continue;
		if (r.speed !== target.speed) continue;
		if (r.startMs < endMs && r.endMs > startMs) {
			startMs = Math.min(startMs, r.startMs);
			endMs = Math.max(endMs, r.endMs);
			absorbed.push(r.id);
		}
	}

	if (absorbed.length === 0) return { merged: speedRegions, absorbedIds: [] };

	const merged = speedRegions
		.filter((r) => !absorbed.includes(r.id))
		.map((r) => (r.id === targetId ? { ...r, startMs, endMs } : r));

	return { merged, absorbedIds: absorbed };
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
