import { Maximize, Minimize, Pause, Play, Repeat, SkipBack } from "lucide-react";
import { useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { formatTimePlayback } from "@/utils/timeUtils";
import { Button } from "../ui/button";

interface PlaybackControlsProps {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	isFullscreen?: boolean;
	onToggleFullscreen?: () => void;
	onTogglePlayPause: () => void;
	onSeek: (time: number) => void;
	previewSpeed?: number;
	onPreviewSpeedChange?: (speed: number) => void;
	isLooping?: boolean;
	onStopLoop?: () => void;
	trimMarkStartMs?: number | null;
}

const PREVIEW_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];

export default function PlaybackControls({
	isPlaying,
	currentTime,
	duration,
	isFullscreen = false,
	onToggleFullscreen,
	onTogglePlayPause,
	onSeek,
	previewSpeed = 1,
	onPreviewSpeedChange,
	isLooping = false,
	onStopLoop,
	trimMarkStartMs,
}: PlaybackControlsProps) {
	const t = useScopedT("common");
	const [showSpeedMenu, setShowSpeedMenu] = useState(false);
	const speedBtnRef = useRef<HTMLButtonElement>(null);

	function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
		onSeek(parseFloat(e.target.value));
	}

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	return (
		<div className="flex items-center gap-2 px-1 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-xl transition-all duration-300 hover:bg-black/70 hover:border-white/20">
			<Button
				onClick={() => onSeek(0)}
				size="icon"
				className="w-7 h-7 rounded-full bg-white/5 text-slate-400 hover:bg-white/15 hover:text-white border border-white/10 transition-all duration-200"
				aria-label={t("playback.rewindToStart")}
				title={t("playback.rewindToStart")}
			>
				<SkipBack className="w-3 h-3 fill-current" />
			</Button>

			{trimMarkStartMs != null && (
				<Button
					onClick={() => onSeek(trimMarkStartMs / 1000)}
					size="icon"
					className="w-7 h-7 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300 border border-red-500/20 transition-all duration-200"
					aria-label={t("playback.goToTrimMark")}
					title={`${t("playback.goToTrimMark")} (${formatTimePlayback(trimMarkStartMs / 1000)})`}
				>
					<span className="text-[9px] font-bold">I</span>
				</Button>
			)}

			<Button
				onClick={onTogglePlayPause}
				size="icon"
				className={cn(
					"w-8 h-8 rounded-full transition-all duration-200 border border-white/10",
					isPlaying
						? "bg-white/10 text-white hover:bg-white/20"
						: "bg-white text-black hover:bg-white/90 hover:scale-105 shadow-[0_0_15px_rgba(255,255,255,0.3)]",
				)}
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? (
					<Pause className="w-3.5 h-3.5 fill-current" />
				) : (
					<Play className="w-3.5 h-3.5 fill-current ml-0.5" />
				)}
			</Button>

			{isLooping && onStopLoop && (
				<Button
					onClick={onStopLoop}
					size="icon"
					className="w-7 h-7 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all duration-200 animate-pulse"
					aria-label="Stop loop"
					title="Stop loop"
				>
					<Repeat className="w-3 h-3" />
				</Button>
			)}

			<span className="text-[9px] font-medium text-slate-300 tabular-nums w-[30px] text-right">
				{formatTimePlayback(currentTime)}
			</span>

			<div className="flex-1 relative h-6 flex items-center group">
				{/* Custom Track Background */}
				<div className="absolute left-0 right-0 h-0.5 bg-white/10 rounded-full overflow-hidden">
					<div className="h-full bg-[#34B27B] rounded-full" style={{ width: `${progress}%` }} />
				</div>

				{/* Interactive Input */}
				<input
					type="range"
					min="0"
					max={duration || 100}
					value={currentTime}
					onChange={handleSeekChange}
					step="0.01"
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
				/>

				{/* Custom Thumb (visual only, follows progress) */}
				<div
					className="absolute w-2.5 h-2.5 bg-white rounded-full shadow-lg pointer-events-none group-hover:scale-125 transition-transform duration-100"
					style={{
						left: `${progress}%`,
						transform: "translateX(-50%)",
					}}
				/>
			</div>

			<span className="text-[9px] font-medium text-slate-500 tabular-nums w-[30px]">
				{formatTimePlayback(duration)}
			</span>

			{/* Preview speed control */}
			{onPreviewSpeedChange && (
				<div className="relative">
					<button
						ref={speedBtnRef}
						type="button"
						onClick={() => setShowSpeedMenu((v) => !v)}
						className={cn(
							"px-1.5 py-0.5 rounded-full text-[9px] font-semibold tabular-nums transition-all duration-200 border",
							previewSpeed !== 1
								? "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
								: "bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-slate-300",
						)}
						title="Preview playback speed (not applied on export)"
					>
						{previewSpeed}×
					</button>
					{showSpeedMenu && (
						<>
							<div className="fixed inset-0 z-[100]" onClick={() => setShowSpeedMenu(false)} />
							<div className="absolute bottom-full mb-2 right-0 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-[101] py-1 min-w-[80px]">
								{PREVIEW_SPEED_PRESETS.map((s) => (
									<button
										key={s}
										type="button"
										onClick={() => {
											onPreviewSpeedChange(s);
											setShowSpeedMenu(false);
										}}
										className={cn(
											"w-full px-3 py-1 text-[11px] text-left hover:bg-white/10 transition-colors tabular-nums",
											s === previewSpeed ? "text-amber-300 font-semibold" : "text-slate-300",
										)}
									>
										{s}×
									</button>
								))}
							</div>
						</>
					)}
				</div>
			)}

			{onToggleFullscreen && (
				<Button
					onClick={onToggleFullscreen}
					size="icon"
					className="w-7 h-7 rounded-full transition-all duration-200 border border-transparent hover:bg-white/10 text-white hover:border-white/10 shrink-0 shadow-none ml-0.5"
					aria-label={isFullscreen ? t("playback.exitFullscreen") : t("playback.fullscreen")}
				>
					{isFullscreen ? (
						<Minimize className="w-3.5 h-3.5" />
					) : (
						<Maximize className="w-3.5 h-3.5" />
					)}
				</Button>
			)}
		</div>
	);
}
