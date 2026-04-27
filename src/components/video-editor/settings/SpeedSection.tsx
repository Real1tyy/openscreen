import { Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { PlaybackSpeed, SpeedRegion } from "../types";
import { MAX_PLAYBACK_SPEED, SPEED_OPTIONS } from "../types";
import { TimestampInput } from "./TimestampInput";

interface SpeedSectionProps {
	selectedSpeedId: string | null;
	selectedSpeedValue: PlaybackSpeed | null;
	onSpeedChange?: (speed: PlaybackSpeed) => void;
	onSpeedDelete?: (id: string) => void;
	selectedSpeedRegion?: SpeedRegion | null;
	onSpeedSpanChange?: (id: string, span: { start: number; end: number }) => void;
	videoDuration?: number;
}

function CustomSpeedInput({
	value,
	onChange,
	onError,
}: {
	value: number;
	onChange: (val: number) => void;
	onError: () => void;
}) {
	const isPreset = SPEED_OPTIONS.some((o) => o.speed === value);
	const [draft, setDraft] = useState(isPreset ? "" : String(Math.round(value)));
	const [isFocused, setIsFocused] = useState(false);

	const prevValue = useRef(value);
	if (!isFocused && prevValue.current !== value) {
		prevValue.current = value;
		setDraft(isPreset ? "" : String(Math.round(value)));
	}

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const digits = e.target.value.replace(/\D/g, "");
			if (digits === "") {
				setDraft("");
				return;
			}
			const num = Number(digits);
			if (num > MAX_PLAYBACK_SPEED) {
				onError();
				return;
			}
			setDraft(digits);
			if (num >= 1) onChange(num);
		},
		[onChange, onError],
	);

	const handleBlur = useCallback(() => {
		setIsFocused(false);
		if (!draft || Number(draft) < 1) {
			setDraft(isPreset ? "" : String(Math.round(value)));
		}
	}, [draft, isPreset, value]);

	return (
		<div className="flex items-center gap-1">
			<input
				type="text"
				inputMode="numeric"
				value={isFocused ? draft : (isPreset ? "" : draft)}
				placeholder="--"
				onFocus={() => setIsFocused(true)}
				onChange={handleChange}
				onBlur={handleBlur}
				className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-0.5 text-[11px] font-semibold text-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-[#34B27B]/50 focus:border-[#34B27B]/30"
			/>
			<span className="text-[11px] font-semibold text-slate-400">×</span>
		</div>
	);
}

export function SpeedSection({
	selectedSpeedId,
	selectedSpeedValue,
	onSpeedChange,
	onSpeedDelete,
	selectedSpeedRegion,
	onSpeedSpanChange,
	videoDuration = 0,
}: SpeedSectionProps) {
	const t = useScopedT("settings");
	const durationMs = videoDuration * 1000;

	const handleStartChange = useCallback(
		(ms: number) => {
			if (!selectedSpeedRegion || !onSpeedSpanChange) return;
			if (ms >= selectedSpeedRegion.endMs) return;
			onSpeedSpanChange(selectedSpeedRegion.id, { start: ms, end: selectedSpeedRegion.endMs });
		},
		[selectedSpeedRegion, onSpeedSpanChange],
	);

	const handleEndChange = useCallback(
		(ms: number) => {
			if (!selectedSpeedRegion || !onSpeedSpanChange) return;
			if (ms <= selectedSpeedRegion.startMs) return;
			onSpeedSpanChange(selectedSpeedRegion.id, { start: selectedSpeedRegion.startMs, end: ms });
		},
		[selectedSpeedRegion, onSpeedSpanChange],
	);

	const handleDurationChange = useCallback(
		(ms: number) => {
			if (!selectedSpeedRegion || !onSpeedSpanChange) return;
			const newEnd = selectedSpeedRegion.startMs + ms;
			if (newEnd <= selectedSpeedRegion.startMs || newEnd > durationMs) return;
			onSpeedSpanChange(selectedSpeedRegion.id, { start: selectedSpeedRegion.startMs, end: newEnd });
		},
		[selectedSpeedRegion, onSpeedSpanChange, durationMs],
	);

	return (
		<div className="mb-4">
			<div className="flex items-center justify-between mb-3">
				<span className="text-sm font-medium text-slate-200">{t("speed.playbackSpeed")}</span>
				{selectedSpeedId && selectedSpeedValue && (
					<span className="text-[10px] uppercase tracking-wider font-medium text-[#d97706] bg-[#d97706]/10 px-2 py-0.5 rounded-full">
						{SPEED_OPTIONS.find((o) => o.speed === selectedSpeedValue)?.label ??
							`${selectedSpeedValue}×`}
					</span>
				)}
			</div>
			<div className="grid grid-cols-5 gap-1.5">
				{SPEED_OPTIONS.map((option) => {
					const isActive = selectedSpeedValue === option.speed;
					return (
						<Button
							key={option.speed}
							type="button"
							disabled={!selectedSpeedId}
							onClick={() => onSpeedChange?.(option.speed)}
							className={cn(
								"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all",
								"duration-200 ease-out",
								selectedSpeedId
									? "opacity-100 cursor-pointer"
									: "opacity-40 cursor-not-allowed",
								isActive
									? "border-[#d97706] bg-[#d97706] text-white shadow-[#d97706]/20"
									: "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200",
							)}
						>
							<span className="text-xs font-semibold">{option.label}</span>
						</Button>
					);
				})}
			</div>
			<div className="mt-3">
				<div className="flex items-center justify-between">
					<span
						className={cn("text-[11px]", selectedSpeedId ? "text-slate-500" : "text-slate-600")}
					>
						{t("speed.customPlaybackSpeed")}
					</span>
					{selectedSpeedId ? (
						<CustomSpeedInput
							value={selectedSpeedValue ?? 1}
							onChange={(val) => onSpeedChange?.(val)}
							onError={() => toast.error(t("speed.maxSpeedError"))}
						/>
					) : (
						<div className="flex items-center gap-1 opacity-40">
							<div className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-0.5 text-[11px] font-semibold text-slate-600 text-center">
								--
							</div>
							<span className="text-[11px] font-semibold text-slate-600">×</span>
						</div>
					)}
				</div>
			</div>
			{!selectedSpeedId && (
				<p className="text-[10px] text-slate-500 mt-2 text-center">{t("speed.selectRegion")}</p>
			)}
			{selectedSpeedRegion && (
				<div className="mt-3 space-y-1.5 bg-white/[0.02] rounded-lg p-2 border border-white/5">
					<TimestampInput
						label={t("region.start")}
						valueMs={selectedSpeedRegion.startMs}
						minMs={0}
						maxMs={selectedSpeedRegion.endMs - 100}
						onChange={handleStartChange}
					/>
					<TimestampInput
						label={t("region.end")}
						valueMs={selectedSpeedRegion.endMs}
						minMs={selectedSpeedRegion.startMs + 100}
						maxMs={durationMs}
						onChange={handleEndChange}
					/>
					<TimestampInput
						label={t("region.duration")}
						valueMs={selectedSpeedRegion.endMs - selectedSpeedRegion.startMs}
						minMs={100}
						maxMs={durationMs - selectedSpeedRegion.startMs}
						onChange={handleDurationChange}
					/>
				</div>
			)}
			{selectedSpeedId && (
				<Button
					onClick={() => onSpeedDelete?.(selectedSpeedId)}
					variant="destructive"
					size="sm"
					className="mt-2 w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
				>
					<Trash2 className="w-3 h-3" />
					{t("speed.deleteRegion")}
				</Button>
			)}
		</div>
	);
}
