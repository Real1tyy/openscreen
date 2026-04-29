import type { ChapterMarker, TrimRegion } from "./types";

export function adjustMsForTrims(ms: number, sortedTrims: TrimRegion[]): number {
	let adjusted = ms;
	for (const trim of sortedTrims) {
		if (trim.endMs <= ms) {
			adjusted -= trim.endMs - trim.startMs;
		} else if (trim.startMs < ms) {
			adjusted -= ms - trim.startMs;
		}
	}
	return Math.max(0, adjusted);
}

export function formatChaptersForExport(
	chapters: ChapterMarker[],
	trimRegions: TrimRegion[],
): string {
	const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
	const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

	return sorted
		.map((ch) => {
			const adjustedMs = adjustMsForTrims(ch.startMs, sortedTrims);
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
