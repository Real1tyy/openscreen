import type { ChapterMarker, SpeedRegion, TrimRegion } from "./types";

export function computeEffectiveMs(
	ms: number,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
): number {
	const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

	const segments: Array<{ startMs: number; endMs: number }> = [];
	let cursor = 0;
	for (const trim of sortedTrims) {
		if (trim.startMs >= ms) break;
		if (cursor < trim.startMs) {
			segments.push({ startMs: cursor, endMs: Math.min(trim.startMs, ms) });
		}
		cursor = trim.endMs;
	}
	if (cursor < ms) {
		segments.push({ startMs: cursor, endMs: ms });
	}

	let effective = 0;
	for (const seg of segments) {
		const overlapping = speedRegions
			.filter((sr) => sr.startMs < seg.endMs && sr.endMs > seg.startMs)
			.sort((a, b) => a.startMs - b.startMs);

		if (overlapping.length === 0) {
			effective += seg.endMs - seg.startMs;
			continue;
		}

		let c = seg.startMs;
		for (const sr of overlapping) {
			const srStart = Math.max(sr.startMs, seg.startMs);
			const srEnd = Math.min(sr.endMs, seg.endMs);
			if (c < srStart) effective += srStart - c;
			effective += (srEnd - srStart) / sr.speed;
			c = srEnd;
		}
		if (c < seg.endMs) effective += seg.endMs - c;
	}

	return Math.max(0, Math.round(effective));
}

export function adjustMsForTrims(ms: number, sortedTrims: TrimRegion[]): number {
	return computeEffectiveMs(ms, sortedTrims, []);
}

export function formatChaptersForExport(
	chapters: ChapterMarker[],
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
): string {
	const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);

	return sorted
		.map((ch) => {
			const adjustedMs = computeEffectiveMs(ch.startMs, trimRegions, speedRegions);
			const totalSec = Math.floor(adjustedMs / 1000);
			const hours = Math.floor(totalSec / 3600);
			const min = Math.floor((totalSec % 3600) / 60);
			const sec = totalSec % 60;
			const ts =
				hours > 0
					? `${hours}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
					: `${min}:${String(sec).padStart(2, "0")}`;
			return `${ts} ${ch.name || "Untitled"}`;
		})
		.join("\n");
}
