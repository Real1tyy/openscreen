import { Clock } from "lucide-react";
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
	currentTimeMs?: number;
}

export function RegionSection({
	region,
	videoDurationMs,
	onSpanChange,
	currentTimeMs,
}: RegionSectionProps) {
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

	const handleSetStartToNow = useCallback(() => {
		if (currentTimeMs == null || currentTimeMs >= region.endMs) return;
		onSpanChange(region.id, { start: currentTimeMs, end: region.endMs });
	}, [currentTimeMs, region, onSpanChange]);

	const handleSetEndToNow = useCallback(() => {
		if (currentTimeMs == null || currentTimeMs <= region.startMs) return;
		onSpanChange(region.id, { start: region.startMs, end: currentTimeMs });
	}, [currentTimeMs, region, onSpanChange]);

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
			{currentTimeMs != null && (
				<div className="flex gap-1.5 pt-1">
					<button
						type="button"
						onClick={handleSetStartToNow}
						disabled={currentTimeMs >= region.endMs}
						className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium bg-white/5 border border-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
					>
						<Clock className="w-3 h-3" />
						Set start to now
					</button>
					<button
						type="button"
						onClick={handleSetEndToNow}
						disabled={currentTimeMs <= region.startMs}
						className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium bg-white/5 border border-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
					>
						<Clock className="w-3 h-3" />
						Set end to now
					</button>
				</div>
			)}
		</div>
	);
}
