import type { ChapterMarker, TrimRegion } from "./types";

export function formatChaptersForExport(
	chapters: ChapterMarker[],
	trimRegions: TrimRegion[],
): string {
	const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
	const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

	return sorted
		.map((ch) => {
			let adjustedMs = ch.startMs;
			for (const trim of sortedTrims) {
				if (trim.endMs <= ch.startMs) {
					adjustedMs -= trim.endMs - trim.startMs;
				} else if (trim.startMs < ch.startMs) {
					adjustedMs -= ch.startMs - trim.startMs;
				}
			}
			adjustedMs = Math.max(0, adjustedMs);
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
