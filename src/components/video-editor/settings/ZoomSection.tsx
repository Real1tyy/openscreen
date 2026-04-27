import { Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { ZOOM_DEPTH_SCALES, MAX_ZOOM_SCALE } from "../types";
import type { ZoomDepth, ZoomFocusMode, ZoomRegion } from "../types";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { TimestampInput } from "./TimestampInput";

interface ZoomSectionProps {
	selectedZoomDepth: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	onZoomCustomScaleChange?: (scale: number) => void;
	selectedZoomCustomScale?: number | null;
	selectedZoomFocusMode: ZoomFocusMode | null;
	onZoomFocusModeChange?: (mode: ZoomFocusMode) => void;
	hasCursorTelemetry?: boolean;
	selectedZoomId: string | null;
	onZoomDelete?: (id: string) => void;
	selectedZoomRegion?: ZoomRegion | null;
	onZoomSpanChange?: (id: string, span: { start: number; end: number }) => void;
	videoDuration?: number;
}

function CustomZoomInput({
	value,
	onChange,
	onError,
}: {
	value: number;
	onChange: (val: number) => void;
	onError: () => void;
}) {
	const isPreset = Object.values(ZOOM_DEPTH_SCALES).some((s) => Math.abs(s - value) < 0.01);
	const [draft, setDraft] = useState(isPreset ? "" : String(value));
	const [isFocused, setIsFocused] = useState(false);

	const prevValue = useRef(value);
	if (!isFocused && prevValue.current !== value) {
		prevValue.current = value;
		setDraft(isPreset ? "" : String(value));
	}

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const raw = e.target.value.replace(/[^0-9.]/g, "");
			if (raw === "" || raw === ".") {
				setDraft(raw);
				return;
			}
			const num = Number.parseFloat(raw);
			if (Number.isNaN(num)) return;
			if (num > MAX_ZOOM_SCALE) {
				onError();
				return;
			}
			setDraft(raw);
			if (num >= 1) onChange(num);
		},
		[onChange, onError],
	);

	const handleBlur = useCallback(() => {
		setIsFocused(false);
		if (!draft || Number.parseFloat(draft) < 1) {
			setDraft(isPreset ? "" : String(value));
		}
	}, [draft, isPreset, value]);

	return (
		<div className="flex items-center gap-1">
			<input
				type="text"
				inputMode="decimal"
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

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
	{ depth: 1, label: "1.25×" },
	{ depth: 2, label: "1.5×" },
	{ depth: 3, label: "1.8×" },
	{ depth: 4, label: "2.2×" },
	{ depth: 5, label: "3.5×" },
	{ depth: 6, label: "5×" },
];

export function ZoomSection({
	selectedZoomDepth,
	onZoomDepthChange,
	onZoomCustomScaleChange,
	selectedZoomCustomScale,
	selectedZoomFocusMode,
	onZoomFocusModeChange,
	hasCursorTelemetry = false,
	selectedZoomId,
	onZoomDelete,
	selectedZoomRegion,
	onZoomSpanChange,
	videoDuration = 0,
}: ZoomSectionProps) {
	const t = useScopedT("settings");
	const zoomEnabled = Boolean(selectedZoomDepth) || Boolean(selectedZoomCustomScale);
	const durationMs = videoDuration * 1000;
	const currentScale = selectedZoomCustomScale ?? (selectedZoomDepth ? ZOOM_DEPTH_SCALES[selectedZoomDepth] : null);

	const handleStartChange = useCallback(
		(ms: number) => {
			if (!selectedZoomRegion || !onZoomSpanChange) return;
			if (ms >= selectedZoomRegion.endMs) return;
			onZoomSpanChange(selectedZoomRegion.id, { start: ms, end: selectedZoomRegion.endMs });
		},
		[selectedZoomRegion, onZoomSpanChange],
	);

	const handleEndChange = useCallback(
		(ms: number) => {
			if (!selectedZoomRegion || !onZoomSpanChange) return;
			if (ms <= selectedZoomRegion.startMs) return;
			onZoomSpanChange(selectedZoomRegion.id, { start: selectedZoomRegion.startMs, end: ms });
		},
		[selectedZoomRegion, onZoomSpanChange],
	);

	const handleDurationChange = useCallback(
		(ms: number) => {
			if (!selectedZoomRegion || !onZoomSpanChange) return;
			const newEnd = selectedZoomRegion.startMs + ms;
			if (newEnd <= selectedZoomRegion.startMs || newEnd > durationMs) return;
			onZoomSpanChange(selectedZoomRegion.id, { start: selectedZoomRegion.startMs, end: newEnd });
		},
		[selectedZoomRegion, onZoomSpanChange, durationMs],
	);

	return (
		<div className="mb-4">
			<div className="flex items-center justify-between mb-3">
				<span className="text-sm font-medium text-slate-200">{t("zoom.level")}</span>
				<div className="flex items-center gap-2">
					{zoomEnabled && currentScale && (
						<span className="text-[10px] uppercase tracking-wider font-medium text-[#34B27B] bg-[#34B27B]/10 px-2 py-0.5 rounded-full">
							{ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)?.label ?? `${currentScale}×`}
						</span>
					)}
					<KeyboardShortcutsHelp />
				</div>
			</div>
			<div className="grid grid-cols-6 gap-1.5">
				{ZOOM_DEPTH_OPTIONS.map((option) => {
					const isActive = selectedZoomDepth === option.depth;
					return (
						<Button
							key={option.depth}
							type="button"
							disabled={!zoomEnabled}
							onClick={() => onZoomDepthChange?.(option.depth)}
							className={cn(
								"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all",
								"duration-200 ease-out",
								zoomEnabled ? "opacity-100 cursor-pointer" : "opacity-40 cursor-not-allowed",
								isActive
									? "border-[#34B27B] bg-[#34B27B] text-white shadow-[#34B27B]/20"
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
					<span className={cn("text-[11px]", zoomEnabled ? "text-slate-500" : "text-slate-600")}>
						{t("zoom.customZoom")}
					</span>
					{zoomEnabled ? (
						<CustomZoomInput
							value={currentScale ?? 1.8}
							onChange={(val) => onZoomCustomScaleChange?.(val)}
							onError={() => toast.error(t("zoom.maxZoomError"))}
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
			{!zoomEnabled && (
				<p className="text-[10px] text-slate-500 mt-2 text-center">{t("zoom.selectRegion")}</p>
			)}
			{zoomEnabled && hasCursorTelemetry && (
				<div className="mt-3">
					<span className="text-sm font-medium text-slate-200 mb-2 block">
						{t("zoom.focusMode.title")}
					</span>
					<div className="grid grid-cols-2 gap-1.5">
						{(["manual", "auto"] as const).map((mode) => {
							const isActive = selectedZoomFocusMode === mode;
							return (
								<Button
									key={mode}
									type="button"
									onClick={() => onZoomFocusModeChange?.(mode)}
									className={cn(
										"h-auto w-full rounded-lg border px-2 py-2 text-center shadow-sm transition-all",
										"duration-200 ease-out cursor-pointer",
										isActive
											? "border-[#34B27B] bg-[#34B27B] text-white shadow-[#34B27B]/20"
											: "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200",
									)}
								>
									<span className="text-xs font-semibold capitalize">
										{t(`zoom.focusMode.${mode}`)}
									</span>
								</Button>
							);
						})}
					</div>
					{selectedZoomFocusMode === "auto" && (
						<p className="text-[10px] text-slate-500 mt-1.5">
							{t("zoom.focusMode.autoDescription")}
						</p>
					)}
				</div>
			)}
			{zoomEnabled && selectedZoomRegion && (
				<div className="mt-3 space-y-1.5 bg-white/[0.02] rounded-lg p-2 border border-white/5">
					<TimestampInput
						label={t("region.start")}
						valueMs={selectedZoomRegion.startMs}
						minMs={0}
						maxMs={selectedZoomRegion.endMs - 100}
						onChange={handleStartChange}
					/>
					<TimestampInput
						label={t("region.end")}
						valueMs={selectedZoomRegion.endMs}
						minMs={selectedZoomRegion.startMs + 100}
						maxMs={durationMs}
						onChange={handleEndChange}
					/>
					<TimestampInput
						label={t("region.duration")}
						valueMs={selectedZoomRegion.endMs - selectedZoomRegion.startMs}
						minMs={100}
						maxMs={durationMs - selectedZoomRegion.startMs}
						onChange={handleDurationChange}
					/>
				</div>
			)}
			{zoomEnabled && selectedZoomId && (
				<Button
					onClick={() => onZoomDelete?.(selectedZoomId)}
					variant="destructive"
					size="sm"
					className="mt-2 w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
				>
					<Trash2 className="w-3 h-3" />
					{t("zoom.deleteZoom")}
				</Button>
			)}
		</div>
	);
}
