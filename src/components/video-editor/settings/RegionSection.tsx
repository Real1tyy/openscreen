import { useCallback } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { TimestampInput } from "./TimestampInput";

interface RegionSpan {
	id: string;
	startMs: number;
	endMs: number;
}

interface RegionSectionProps {
	region: RegionSpan;
	videoDurationMs: number;
	onSpanChange: (id: string, span: { start: number; end: number }) => void;
}

export function RegionSection({ region, videoDurationMs, onSpanChange }: RegionSectionProps) {
	const t = useScopedT("settings");

	const handleStartChange = useCallback(
		(ms: number) => {
			if (ms >= region.endMs) return;
			onSpanChange(region.id, { start: ms, end: region.endMs });
		},
		[region, onSpanChange],
	);

	const handleEndChange = useCallback(
		(ms: number) => {
			if (ms <= region.startMs) return;
			onSpanChange(region.id, { start: region.startMs, end: ms });
		},
		[region, onSpanChange],
	);

	const handleDurationChange = useCallback(
		(ms: number) => {
			const newEnd = region.startMs + ms;
			if (newEnd <= region.startMs || newEnd > videoDurationMs) return;
			onSpanChange(region.id, { start: region.startMs, end: newEnd });
		},
		[region, videoDurationMs, onSpanChange],
	);

	return (
		<div className="space-y-1.5 bg-white/[0.02] rounded-lg p-2 border border-white/5">
			<TimestampInput
				label={t("region.start")}
				valueMs={region.startMs}
				minMs={0}
				maxMs={region.endMs - 100}
				onChange={handleStartChange}
			/>
			<TimestampInput
				label={t("region.end")}
				valueMs={region.endMs}
				minMs={region.startMs + 100}
				maxMs={videoDurationMs}
				onChange={handleEndChange}
			/>
			<TimestampInput
				label={t("region.duration")}
				valueMs={region.endMs - region.startMs}
				minMs={100}
				maxMs={videoDurationMs - region.startMs}
				onChange={handleDurationChange}
			/>
		</div>
	);
}
