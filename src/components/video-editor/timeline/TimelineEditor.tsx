import type { Range, Span } from "dnd-timeline";
import { useTimelineContext } from "dnd-timeline";
import {
	BookMarked,
	Check,
	ChevronDown,
	Clock,
	Copy,
	Gauge,
	MessageSquare,
	Play,
	Plus,
	Repeat,
	Scissors,
	Trash2,
	WandSparkles,
	ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { matchesShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioLabel } from "@/utils/aspectRatioUtils";
import { formatMsCompact } from "@/utils/timeUtils";
import { formatShortcut } from "@/utils/platformUtils";
import { TutorialHelp } from "../TutorialHelp";
import type {
	AnnotationRegion,
	ChapterMarker,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
} from "../types";
import Item from "./Item";
import KeyframeMarkers from "./KeyframeMarkers";
import Row from "./Row";
import { computeNewRegionSpan, normalizeRegionSpan } from "./regionUtils";
import {
	calculateAxisScale,
	calculateTimelineScale,
	clampVisibleRange,
	createInitialRange,
	formatTimeLabel,
	normalizeWheelDelta,
} from "./timelineScaleUtils";
import TimelineWrapper from "./TimelineWrapper";
import { detectZoomDwellCandidates, normalizeCursorTelemetry } from "./zoomSuggestionUtils";

const ZOOM_ROW_ID = "row-zoom";
const TRIM_ROW_ID = "row-trim";
const ANNOTATION_ROW_ID = "row-annotation";
const SPEED_ROW_ID = "row-speed";
const CHAPTER_ROW_ID = "row-chapter";
const SUGGESTION_SPACING_MS = 1800;

interface TimelineEditorProps {
	videoDuration: number;
	currentTime: number;
	onSeek?: (time: number) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions?: TrimRegion[];
	onTrimAdded?: (span: Span) => void;
	onTrimSpanChange?: (id: string, span: Span) => void;
	onTrimDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onSelectTrim?: (id: string | null) => void;
	annotationRegions?: AnnotationRegion[];
	onAnnotationAdded?: (span: Span) => void;
	onAnnotationSpanChange?: (id: string, span: Span) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions?: SpeedRegion[];
	onSpeedAdded?: (span: Span) => void;
	onSpeedSpanChange?: (id: string, span: Span) => void;
	onSpeedDelete?: (id: string) => void;
	selectedSpeedId?: string | null;
	onSelectSpeed?: (id: string | null) => void;
	chapters?: ChapterMarker[];
	onAddChapter?: () => void;
	onChapterSpanChange?: (id: string, span: Span) => void;
	onRenameChapter?: (id: string, name: string) => void;
	onDeleteChapter?: (id: string) => void;
	selectedChapterId?: string | null;
	onSelectChapter?: (id: string | null) => void;
	editingChapterId?: string | null;
	onEditChapter?: (id: string | null) => void;
	aspectRatio: AspectRatio;
	onAspectRatioChange: (aspectRatio: AspectRatio) => void;
	// Trim context menu actions
	onTrimSetStartToNow?: (id: string) => void;
	onTrimSetEndToNow?: (id: string) => void;
	onTrimSetStartFromAdjacent?: (id: string) => void;
	onTrimSetEndFromAdjacent?: (id: string) => void;
	onTrimPlayFromStart?: (id: string) => void;
	onTrimPlayFromEnd?: (id: string) => void;
	onTrimToggleLoop?: (id: string) => void;
	loopingTrimId?: string | null;
	trimMarkStartMs?: number | null;
	defaultZoomDurationMs?: number;
	defaultTrimDurationMs?: number;
	defaultSpeedDurationMs?: number;
	onDuplicateZoom?: (id: string) => void;
	onDuplicateTrim?: (id: string) => void;
	onDuplicateSpeed?: (id: string) => void;
	onDuplicateAnnotation?: (id: string) => void;
}

interface TimelineRenderItem {
	id: string;
	rowId: string;
	span: Span;
	label: string;
	zoomDepth?: number;
	speedValue?: number;
	chapterName?: string;
	variant: "zoom" | "trim" | "annotation" | "speed" | "chapter";
}

function PlaybackCursor({
	currentTimeMs,
	videoDurationMs,
	onSeek,
	onRangeChange,
	timelineRef,
	keyframes = [],
}: {
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	onRangeChange?: (updater: (previous: Range) => Range) => void;
	timelineRef: React.RefObject<HTMLDivElement>;
	keyframes?: { id: string; time: number }[];
}) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);
	const [dragPreviewTimeMs, setDragPreviewTimeMs] = useState<number | null>(null);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current || !onSeek) return;

			const rect = timelineRef.current.getBoundingClientRect();
			const clickX = e.clientX - rect.left - sidebarWidth;
			const contentWidth = Math.max(rect.width - sidebarWidth, 1);

			// Allow dragging outside to 0 or max, but clamp the value
			const relativeMs = pixelsToValue(clickX);
			let absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

			// Snap to nearby keyframe if within threshold (150ms)
			const snapThresholdMs = 150;
			const nearbyKeyframe = keyframes.find(
				(kf) =>
					Math.abs(kf.time - absoluteMs) <= snapThresholdMs &&
					kf.time >= range.start &&
					kf.time <= range.end,
			);

			if (nearbyKeyframe) {
				absoluteMs = nearbyKeyframe.time;
			}

			setDragPreviewTimeMs(absoluteMs);

			const visibleMs = range.end - range.start;
			if (onRangeChange && visibleMs > 0 && videoDurationMs > visibleMs) {
				const msPerPixel = visibleMs / contentWidth;
				const overflowLeftPx = Math.max(0, -clickX);
				const overflowRightPx = Math.max(0, clickX - contentWidth);

				if (overflowLeftPx > 0 && range.start > 0) {
					const shiftMs = overflowLeftPx * msPerPixel;
					onRangeChange((previous) => {
						const nextRange = clampVisibleRange(
							{
								start: previous.start - shiftMs,
								end: previous.end - shiftMs,
							},
							videoDurationMs,
						);
						return nextRange.start === previous.start && nextRange.end === previous.end
							? previous
							: nextRange;
					});
				} else if (overflowRightPx > 0 && range.end < videoDurationMs) {
					const shiftMs = overflowRightPx * msPerPixel;
					onRangeChange((previous) => {
						const nextRange = clampVisibleRange(
							{
								start: previous.start + shiftMs,
								end: previous.end + shiftMs,
							},
							videoDurationMs,
						);
						return nextRange.start === previous.start && nextRange.end === previous.end
							? previous
							: nextRange;
					});
				}
			}

			onSeek(absoluteMs / 1000);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			setDragPreviewTimeMs(null);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		isDragging,
		onSeek,
		onRangeChange,
		timelineRef,
		sidebarWidth,
		range.start,
		range.end,
		videoDurationMs,
		pixelsToValue,
		keyframes,
	]);

	const displayTimeMs =
		isDragging && dragPreviewTimeMs !== null ? dragPreviewTimeMs : currentTimeMs;

	if (videoDurationMs <= 0 || displayTimeMs < 0) {
		return null;
	}

	const clampedTime = Math.min(displayTimeMs, videoDurationMs);

	if (clampedTime < range.start || clampedTime > range.end) {
		return null;
	}

	const offset = valueToPixels(clampedTime - range.start);

	return (
		<div
			className="absolute top-0 bottom-0 z-50 group/cursor"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
				pointerEvents: "none", // Allow clicks to pass through to timeline, but we'll enable pointer events on the handle
			}}
		>
			<div
				className="absolute top-0 bottom-0 w-[2px] bg-[#34B27B] shadow-[0_0_10px_rgba(52,178,123,0.5)] cursor-ew-resize pointer-events-auto hover:shadow-[0_0_15px_rgba(52,178,123,0.7)] transition-shadow"
				style={{
					[sideProperty]: `${offset}px`,
				}}
				onMouseDown={(e) => {
					e.stopPropagation(); // Prevent timeline click
					setDragPreviewTimeMs(currentTimeMs);
					setIsDragging(true);
				}}
			>
				<div
					className="absolute -top-1 left-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
					style={{ width: "16px", height: "16px" }}
				>
					<div className="w-3 h-3 mx-auto mt-[2px] bg-[#34B27B] rotate-45 rounded-sm shadow-lg border border-white/20" />
				</div>
				{isDragging && (
					<div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white/90 font-medium tabular-nums whitespace-nowrap border border-white/10 shadow-lg pointer-events-none">
						{formatMsCompact(clampedTime)}
					</div>
				)}
			</div>
		</div>
	);
}

function TimelineAxis({
	videoDurationMs,
	currentTimeMs,
}: {
	videoDurationMs: number;
	currentTimeMs: number;
}) {
	const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";

	// Recompute axis scale dynamically on every zoom change.
	const { intervalMs } = useMemo(
		() => calculateAxisScale(range.end - range.start),
		[range.end, range.start],
	);

	const markers = useMemo(() => {
		if (intervalMs <= 0) {
			return { markers: [], minorTicks: [] };
		}

		const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
		const visibleStart = Math.max(0, Math.min(range.start, maxTime));
		const visibleEnd = Math.min(range.end, maxTime);
		const markerTimes = new Set<number>();

		const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

		for (let time = firstMarker; time <= maxTime; time += intervalMs) {
			if (time >= visibleStart && time <= visibleEnd) {
				markerTimes.add(Math.round(time));
			}
		}

		if (visibleStart <= maxTime) {
			markerTimes.add(Math.round(visibleStart));
		}

		if (videoDurationMs > 0) {
			markerTimes.add(Math.round(videoDurationMs));
		}

		const sorted = Array.from(markerTimes)
			.filter((time) => time <= maxTime)
			.sort((a, b) => a - b);

		// Generate minor ticks (4 ticks between major intervals)
		const minorTicks = [];
		const minorInterval = intervalMs / 5;

		for (let time = firstMarker; time <= maxTime; time += minorInterval) {
			if (time >= visibleStart && time <= visibleEnd) {
				// Skip if it's close to a major marker
				const isMajor = Math.abs(time % intervalMs) < 1;
				if (!isMajor) {
					minorTicks.push(time);
				}
			}
		}

		return {
			markers: sorted.map((time) => ({
				time,
				label: formatTimeLabel(time, intervalMs),
			})),
			minorTicks,
		};
	}, [intervalMs, range.end, range.start, videoDurationMs]);

	return (
		<div
			className="h-8 bg-[#09090b] border-b border-white/5 relative overflow-hidden select-none"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
			}}
		>
			{/* Minor Ticks */}
			{markers.minorTicks.map((time) => {
				const offset = valueToPixels(time - range.start);
				return (
					<div
						key={`minor-${time}`}
						className="absolute bottom-0 h-1 w-[1px] bg-white/5"
						style={{ [sideProperty]: `${offset}px` }}
					/>
				);
			})}

			{/* Major Markers */}
			{markers.markers.map((marker) => {
				const offset = valueToPixels(marker.time - range.start);
				const markerStyle: React.CSSProperties = {
					position: "absolute",
					bottom: 0,
					height: "100%",
					display: "flex",
					flexDirection: "row",
					alignItems: "flex-end",
					[sideProperty]: `${offset}px`,
				};

				return (
					<div key={marker.time} style={markerStyle}>
						<div className="flex flex-col items-center pb-1">
							<div className="h-2 w-[1px] bg-white/20 mb-1" />
							<span
								className={cn(
									"text-[10px] font-medium tabular-nums tracking-tight",
									marker.time === currentTimeMs ? "text-[#34B27B]" : "text-slate-500",
								)}
							>
								{marker.label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function ContextMenuPopover({
	x,
	y,
	children,
	onClick,
}: {
	x: number;
	y: number;
	children: React.ReactNode;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: x, top: y });

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		let top = y;
		let left = x;
		if (top + rect.height > vh - 8) {
			top = Math.max(8, y - rect.height);
		}
		if (left + rect.width > vw - 8) {
			left = Math.max(8, vw - rect.width - 8);
		}
		setPos({ left, top });
	}, [x, y]);

	return (
		<div
			ref={ref}
			className="fixed z-[200] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[200px] text-[12px] max-h-[calc(100vh-16px)] overflow-y-auto"
			style={{ left: pos.left, top: pos.top }}
			onClick={onClick}
		>
			{children}
		</div>
	);
}

type RegionContextMenuState = {
	type: "zoom" | "trim" | "speed" | "annotation";
	id: string;
	x: number;
	y: number;
};

function RegionContextMenuItems({
	regionType,
	onClose,
	onSetStartToNow,
	onSetEndToNow,
	onDuplicate,
	onDelete,
}: {
	regionType: string;
	onClose: () => void;
	onSetStartToNow: () => void;
	onSetEndToNow: () => void;
	onDuplicate?: () => void;
	onDelete?: () => void;
}) {
	const item = (
		label: string,
		icon: React.ReactNode,
		onClick: () => void,
		accent?: string,
	) => (
		<button
			type="button"
			onClick={() => {
				onClick();
				onClose();
			}}
			className={cn(
				"w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors",
				accent
					? `${accent} hover:bg-white/10`
					: "text-slate-300 hover:bg-white/10 hover:text-white",
			)}
		>
			{icon}
			{label}
		</button>
	);

	return (
		<>
			{item("Set start to now", <Clock className="w-3.5 h-3.5" />, onSetStartToNow)}
			{item("Set end to now", <Clock className="w-3.5 h-3.5" />, onSetEndToNow)}
			{onDuplicate && (
				<>
					<div className="h-[1px] bg-white/5 my-1" />
					{item("Duplicate", <Copy className="w-3.5 h-3.5" />, onDuplicate)}
				</>
			)}
			{onDelete && (
				<>
					<div className="h-[1px] bg-white/5 my-1" />
					{item(`Delete ${regionType}`, <Trash2 className="w-3.5 h-3.5" />, onDelete, "text-red-400")}
				</>
			)}
		</>
	);
}

function TrimContextMenuItems({
	trimId,
	onClose,
	onSetStartToNow,
	onSetEndToNow,
	onSetStartFromAdjacent,
	onSetEndFromAdjacent,
	onPlayFromStart,
	onPlayFromEnd,
	onToggleLoop,
	onDelete,
	onDuplicate,
	isLooping,
	hasAdjacentBefore,
	hasAdjacentAfter,
}: {
	trimId: string;
	onClose: () => void;
	onSetStartToNow?: (id: string) => void;
	onSetEndToNow?: (id: string) => void;
	onSetStartFromAdjacent?: (id: string) => void;
	onSetEndFromAdjacent?: (id: string) => void;
	onPlayFromStart?: (id: string) => void;
	onPlayFromEnd?: (id: string) => void;
	onToggleLoop?: (id: string) => void;
	onDelete?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	isLooping: boolean;
	hasAdjacentBefore: boolean;
	hasAdjacentAfter: boolean;
}) {
	const item = (
		label: string,
		icon: React.ReactNode,
		onClick: () => void,
		disabled = false,
		accent?: string,
	) => (
		<button
			type="button"
			disabled={disabled}
			onClick={() => {
				onClick();
				onClose();
			}}
			className={cn(
				"w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors",
				disabled
					? "text-slate-600 cursor-not-allowed"
					: accent
						? `${accent} hover:bg-white/10`
						: "text-slate-300 hover:bg-white/10 hover:text-white",
			)}
		>
			{icon}
			{label}
		</button>
	);

	return (
		<>
			{item("Set start to now", <Clock className="w-3.5 h-3.5" />, () => onSetStartToNow?.(trimId))}
			{item("Set end to now", <Clock className="w-3.5 h-3.5" />, () => onSetEndToNow?.(trimId))}
			<div className="h-[1px] bg-white/5 my-1" />
			{item(
				"Set start from adjacent trim",
				<Scissors className="w-3.5 h-3.5" />,
				() => onSetStartFromAdjacent?.(trimId),
				!hasAdjacentBefore,
			)}
			{item(
				"Set end from adjacent trim",
				<Scissors className="w-3.5 h-3.5" />,
				() => onSetEndFromAdjacent?.(trimId),
				!hasAdjacentAfter,
			)}
			<div className="h-[1px] bg-white/5 my-1" />
			{item("Play from start (−5s)", <Play className="w-3.5 h-3.5" />, () => onPlayFromStart?.(trimId))}
			{item("Play from end", <Play className="w-3.5 h-3.5" />, () => onPlayFromEnd?.(trimId))}
			{item(
				isLooping ? "Stop loop" : "Loop around trim",
				<Repeat className="w-3.5 h-3.5" />,
				() => onToggleLoop?.(trimId),
				false,
				isLooping ? "text-red-400" : undefined,
			)}
			<div className="h-[1px] bg-white/5 my-1" />
			{item("Duplicate", <Copy className="w-3.5 h-3.5" />, () => onDuplicate?.(trimId))}
			<div className="h-[1px] bg-white/5 my-1" />
			{item("Delete trim", <Scissors className="w-3.5 h-3.5" />, () => onDelete?.(trimId), false, "text-red-400")}
		</>
	);
}

function TrimMarkIndicator({
	timeMs,
	videoDurationMs,
}: {
	timeMs: number | null;
	videoDurationMs: number;
}) {
	const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";

	if (timeMs == null || videoDurationMs <= 0 || timeMs < range.start || timeMs > range.end) {
		return null;
	}

	const offset = valueToPixels(timeMs - range.start);

	return (
		<div
			className="absolute top-0 bottom-0 z-40 pointer-events-none"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
			}}
		>
			<div
				className="absolute top-0 bottom-0 w-[2px] bg-red-500/80 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
				style={{ [sideProperty]: `${offset}px` }}
			>
				<div
					className="absolute -top-1 left-1/2 -translate-x-1/2"
					style={{ width: "12px", height: "12px" }}
				>
					<div className="w-2.5 h-2.5 mx-auto mt-[1px] bg-red-500 rotate-45 rounded-sm shadow-lg border border-white/20 animate-pulse" />
				</div>
				<div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-red-500/90 text-[9px] text-white font-medium whitespace-nowrap shadow-lg">
					I
				</div>
			</div>
		</div>
	);
}

function Timeline({
	items,
	videoDurationMs,
	currentTimeMs,
	onSeek,
	onRangeChange,
	onSelectZoom,
	onSelectTrim,
	onSelectAnnotation,
	onSelectSpeed,
	selectedZoomId,
	selectedTrimId,
	selectedAnnotationId,
	selectedSpeedId,
	selectedChapterId,
	onSelectChapter,
	keyframes = [],
	onDeleteChapter,
	onRenameChapter,
	editingChapterId,
	onEditChapter,
	onTrimContextMenu,
	onRegionContextMenu,
	trimMarkStartMs,
	loopingTrimId,
}: {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	onRangeChange?: (updater: (previous: Range) => Range) => void;
	onSelectZoom?: (id: string | null) => void;
	onSelectTrim?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectSpeed?: (id: string | null) => void;
	selectedZoomId: string | null;
	selectedTrimId?: string | null;
	selectedAnnotationId?: string | null;
	selectedSpeedId?: string | null;
	selectedChapterId?: string | null;
	onSelectChapter?: (id: string | null) => void;
	keyframes?: { id: string; time: number }[];
	onDeleteChapter?: (id: string) => void;
	onRenameChapter?: (id: string, name: string) => void;
	editingChapterId?: string | null;
	onEditChapter?: (id: string | null) => void;
	onTrimContextMenu?: (id: string, event: React.MouseEvent) => void;
	onRegionContextMenu?: (type: "zoom" | "speed" | "annotation", id: string, event: React.MouseEvent) => void;
	trimMarkStartMs?: number | null;
	loopingTrimId?: string | null;
}) {
	const t = useScopedT("timeline");
	const { setTimelineRef, style, sidebarWidth, range, pixelsToValue } = useTimelineContext();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setTimelineRef(node);
			localTimelineRef.current = node;
		},
		[setTimelineRef],
	);

	const handleTimelineClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!onSeek || videoDurationMs <= 0) return;

			// Only clear selection if clicking on empty space (not on items)
			// This is handled by event propagation - items stop propagation
			onSelectZoom?.(null);
			onSelectTrim?.(null);
			onSelectAnnotation?.(null);
			onSelectSpeed?.(null);
			onSelectChapter?.(null);

			const rect = e.currentTarget.getBoundingClientRect();
			const clickX = e.clientX - rect.left - sidebarWidth;

			if (clickX < 0) return;

			const relativeMs = pixelsToValue(clickX);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
			const timeInSeconds = absoluteMs / 1000;

			onSeek(timeInSeconds);
		},
		[
			onSeek,
			onSelectZoom,
			onSelectTrim,
			onSelectAnnotation,
			onSelectSpeed,
			onSelectChapter,
			videoDurationMs,
			sidebarWidth,
			range.start,
			pixelsToValue,
		],
	);

	const handleTimelineWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (!onRangeChange || event.ctrlKey || event.metaKey || videoDurationMs <= 0) {
				return;
			}

			const visibleMs = range.end - range.start;
			if (visibleMs <= 0 || videoDurationMs <= visibleMs) {
				return;
			}

			const dominantDelta =
				Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (dominantDelta === 0) {
				return;
			}

			event.preventDefault();

			const pageWidthPx = Math.max(event.currentTarget.clientWidth - sidebarWidth, 1);
			const normalizedDeltaPx = normalizeWheelDelta(dominantDelta, event.deltaMode, pageWidthPx);
			const shiftMs = pixelsToValue(normalizedDeltaPx);

			onRangeChange((previous) => {
				const nextRange = clampVisibleRange(
					{
						start: previous.start + shiftMs,
						end: previous.end + shiftMs,
					},
					videoDurationMs,
				);

				return nextRange.start === previous.start && nextRange.end === previous.end
					? previous
					: nextRange;
			});
		},
		[onRangeChange, videoDurationMs, range.end, range.start, sidebarWidth, pixelsToValue],
	);

	const zoomItems = items.filter((item) => item.rowId === ZOOM_ROW_ID);
	const trimItems = items.filter((item) => item.rowId === TRIM_ROW_ID);
	const annotationItems = items.filter((item) => item.rowId === ANNOTATION_ROW_ID);
	const speedItems = items.filter((item) => item.rowId === SPEED_ROW_ID);
	const chapterItems = items.filter((item) => item.rowId === CHAPTER_ROW_ID);

	const renderRow = (
		rowId: string,
		rowItems: TimelineRenderItem[],
		selectedId: string | null | undefined,
		onSelect: ((id: string | null) => void) | undefined,
		hint: string,
		contextMenuType?: "zoom" | "speed" | "annotation",
	) => (
		<Row id={rowId} isEmpty={rowItems.length === 0} hint={hint}>
			{rowItems.map((item) => (
				<Item
					id={item.id}
					key={item.id}
					rowId={item.rowId}
					span={item.span}
					isSelected={item.id === selectedId}
					onSelect={() => onSelect?.(item.id)}
					variant={item.variant}
					zoomDepth={item.zoomDepth}
					speedValue={item.speedValue}
					onContextMenu={contextMenuType ? (e) => {
						e.preventDefault();
						onRegionContextMenu?.(contextMenuType, item.id, e);
					} : undefined}
				>
					{item.label}
				</Item>
			))}
		</Row>
	);

	const renderTrimRow = () => (
		<Row id={TRIM_ROW_ID} isEmpty={trimItems.length === 0} hint={t("hints.pressTrim")}>
			{trimItems.map((item) => (
				<Item
					id={item.id}
					key={item.id}
					rowId={item.rowId}
					span={item.span}
					isSelected={item.id === selectedTrimId}
					onSelect={() => onSelectTrim?.(item.id)}
					variant="trim"
					onContextMenu={(e) => {
						e.preventDefault();
						onTrimContextMenu?.(item.id, e);
					}}
				>
					{item.id === loopingTrimId ? (
						<span className="flex items-center gap-1">
							{item.label} <Repeat className="w-2.5 h-2.5 text-red-300 animate-spin" style={{ animationDuration: "2s" }} />
						</span>
					) : (
						item.label
					)}
				</Item>
			))}
		</Row>
	);

	const renderChapterRow = () => (
		<Row id={CHAPTER_ROW_ID} isEmpty={chapterItems.length === 0} hint="Press C to add chapter">
			{chapterItems.map((item) => (
				<Item
					id={item.id}
					key={item.id}
					rowId={item.rowId}
					span={item.span}
					isSelected={item.id === selectedChapterId}
					onSelect={() => {
						onSelectChapter?.(item.id);
						if (onSeek) onSeek(item.span.start / 1000);
					}}
					onDoubleClick={() => onEditChapter?.(item.id)}
					onContextMenu={(e) => {
						e.preventDefault();
						onDeleteChapter?.(item.id);
					}}
					variant="chapter"
					isEditing={editingChapterId === item.id}
					onRenameCommit={(name) => onRenameChapter?.(item.id, name)}
					onRenameCancel={() => onEditChapter?.(null)}
				>
					{item.chapterName}
				</Item>
			))}
		</Row>
	);

	return (
		<div
			ref={setRefs}
			style={style}
			className="select-none bg-[#09090b] min-h-[140px] relative cursor-pointer group"
			onClick={handleTimelineClick}
			onWheel={handleTimelineWheel}
		>
			<div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px)] bg-[length:20px_100%] pointer-events-none" />
			<TimelineAxis videoDurationMs={videoDurationMs} currentTimeMs={currentTimeMs} />
			<PlaybackCursor
				currentTimeMs={currentTimeMs}
				videoDurationMs={videoDurationMs}
				onSeek={onSeek}
				onRangeChange={onRangeChange}
				timelineRef={localTimelineRef}
				keyframes={keyframes}
			/>
			<TrimMarkIndicator timeMs={trimMarkStartMs ?? null} videoDurationMs={videoDurationMs} />

			{renderRow(ZOOM_ROW_ID, zoomItems, selectedZoomId, onSelectZoom, t("hints.pressZoom"), "zoom")}
			{renderTrimRow()}
			{renderChapterRow()}
			{renderRow(ANNOTATION_ROW_ID, annotationItems, selectedAnnotationId, onSelectAnnotation, t("hints.pressAnnotation"), "annotation")}
			{renderRow(SPEED_ROW_ID, speedItems, selectedSpeedId, onSelectSpeed, t("hints.pressSpeed"), "speed")}
		</div>
	);
}

export default function TimelineEditor({
	videoDuration,
	currentTime,
	onSeek,
	cursorTelemetry = [],
	zoomRegions,
	onZoomAdded,
	onZoomSuggested,
	onZoomSpanChange,
	onZoomDelete,
	selectedZoomId,
	onSelectZoom,
	trimRegions = [],
	onTrimAdded,
	onTrimSpanChange,
	onTrimDelete,
	selectedTrimId,
	onSelectTrim,
	annotationRegions = [],
	onAnnotationAdded,
	onAnnotationSpanChange,
	onAnnotationDelete,
	selectedAnnotationId,
	onSelectAnnotation,
	speedRegions = [],
	onSpeedAdded,
	onSpeedSpanChange,
	onSpeedDelete,
	selectedSpeedId,
	onSelectSpeed,
	chapters = [],
	onAddChapter,
	onChapterSpanChange,
	onRenameChapter,
	onDeleteChapter,
	selectedChapterId,
	onSelectChapter,
	editingChapterId,
	onEditChapter,
	aspectRatio,
	onAspectRatioChange,
	onTrimSetStartToNow,
	onTrimSetEndToNow,
	onTrimSetStartFromAdjacent,
	onTrimSetEndFromAdjacent,
	onTrimPlayFromStart,
	onTrimPlayFromEnd,
	onTrimToggleLoop,
	loopingTrimId,
	trimMarkStartMs,
	defaultZoomDurationMs: defaultZoomDurationMsProp = 5000,
	defaultTrimDurationMs: defaultTrimDurationMsProp = 5000,
	defaultSpeedDurationMs: defaultSpeedDurationMsProp = 5000,
	onDuplicateZoom,
	onDuplicateTrim,
	onDuplicateSpeed,
	onDuplicateAnnotation,
}: TimelineEditorProps) {
	const t = useScopedT("timeline");
	const totalMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
	const currentTimeMs = useMemo(() => Math.round(currentTime * 1000), [currentTime]);
	const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
	const safeMinDurationMs = useMemo(
		() =>
			totalMs > 0
				? Math.min(timelineScale.minItemDurationMs, totalMs)
				: timelineScale.minItemDurationMs,
		[timelineScale.minItemDurationMs, totalMs],
	);

	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));
	const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
	const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
	const [scrollLabels, setScrollLabels] = useState({
		pan: "Scroll",
		zoom: "Ctrl + Scroll",
	});
	const [trimContextMenu, setTrimContextMenu] = useState<{
		trimId: string;
		x: number;
		y: number;
	} | null>(null);
	const timelineContainerRef = useRef<HTMLDivElement>(null);
	const { shortcuts: keyShortcuts, isMac } = useShortcuts();

	useEffect(() => {
		formatShortcut(["mod", "Scroll"]).then((zoom) => {
			setScrollLabels({ pan: "Scroll", zoom });
		});
	}, []);

	const handleTrimContextMenu = useCallback((id: string, event: React.MouseEvent) => {
		setTrimContextMenu({ trimId: id, x: event.clientX, y: event.clientY });
	}, []);

	const closeTrimContextMenu = useCallback(() => setTrimContextMenu(null), []);

	const [regionContextMenu, setRegionContextMenu] = useState<RegionContextMenuState | null>(null);

	const handleRegionContextMenu = useCallback(
		(type: "zoom" | "speed" | "annotation", id: string, event: React.MouseEvent) => {
			setRegionContextMenu({ type, id, x: event.clientX, y: event.clientY });
		},
		[],
	);

	const closeRegionContextMenu = useCallback(() => setRegionContextMenu(null), []);

	useEffect(() => {
		const menu = trimContextMenu || regionContextMenu;
		if (!menu) return;
		const handleClick = () => {
			setTrimContextMenu(null);
			setRegionContextMenu(null);
		};
		window.addEventListener("click", handleClick);
		window.addEventListener("contextmenu", handleClick);
		return () => {
			window.removeEventListener("click", handleClick);
			window.removeEventListener("contextmenu", handleClick);
		};
	}, [trimContextMenu, regionContextMenu]);

	type SpanChangeHandler = ((id: string, span: Span) => void) | undefined;

	const handleRegionSetStartToNow = useCallback(() => {
		if (!regionContextMenu) return;
		const { type, id } = regionContextMenu;
		const handlers: Record<string, SpanChangeHandler> = {
			zoom: onZoomSpanChange,
			speed: onSpeedSpanChange,
			annotation: onAnnotationSpanChange,
		};
		const regions: Record<string, Array<{ id: string; startMs: number; endMs: number }>> = {
			zoom: zoomRegions,
			speed: speedRegions,
			annotation: annotationRegions,
		};
		const handler = handlers[type];
		const region = regions[type]?.find((r) => r.id === id);
		if (!handler || !region || currentTimeMs >= region.endMs) return;
		handler(id, { start: currentTimeMs, end: region.endMs });
	}, [regionContextMenu, currentTimeMs, zoomRegions, speedRegions, annotationRegions, onZoomSpanChange, onSpeedSpanChange, onAnnotationSpanChange]);

	const handleRegionSetEndToNow = useCallback(() => {
		if (!regionContextMenu) return;
		const { type, id } = regionContextMenu;
		const handlers: Record<string, SpanChangeHandler> = {
			zoom: onZoomSpanChange,
			speed: onSpeedSpanChange,
			annotation: onAnnotationSpanChange,
		};
		const regions: Record<string, Array<{ id: string; startMs: number; endMs: number }>> = {
			zoom: zoomRegions,
			speed: speedRegions,
			annotation: annotationRegions,
		};
		const handler = handlers[type];
		const region = regions[type]?.find((r) => r.id === id);
		if (!handler || !region || currentTimeMs <= region.startMs) return;
		handler(id, { start: region.startMs, end: currentTimeMs });
	}, [regionContextMenu, currentTimeMs, zoomRegions, speedRegions, annotationRegions, onZoomSpanChange, onSpeedSpanChange, onAnnotationSpanChange]);

	const handleRegionDuplicate = useCallback(() => {
		if (!regionContextMenu) return;
		const { type, id } = regionContextMenu;
		const duplicators: Record<string, ((id: string) => void) | undefined> = {
			zoom: onDuplicateZoom,
			speed: onDuplicateSpeed,
			annotation: onDuplicateAnnotation,
		};
		duplicators[type]?.(id);
	}, [regionContextMenu, onDuplicateZoom, onDuplicateSpeed, onDuplicateAnnotation]);

	const handleRegionDelete = useCallback(() => {
		if (!regionContextMenu) return;
		const { type, id } = regionContextMenu;
		const deleters: Record<string, ((id: string) => void) | undefined> = {
			zoom: onZoomDelete,
			speed: onSpeedDelete,
			annotation: onAnnotationDelete,
		};
		deleters[type]?.(id);
	}, [regionContextMenu, onZoomDelete, onSpeedDelete, onAnnotationDelete]);

	// Add keyframe at current playhead position
	const addKeyframe = useCallback(() => {
		if (totalMs === 0) return;
		const time = Math.max(0, Math.min(currentTimeMs, totalMs));
		if (keyframes.some((kf) => Math.abs(kf.time - time) < 1)) return;
		setKeyframes((prev) => [...prev, { id: uuidv4(), time }]);
	}, [currentTimeMs, totalMs, keyframes]);

	// Delete selected keyframe
	const deleteSelectedKeyframe = useCallback(() => {
		if (!selectedKeyframeId) return;
		setKeyframes((prev) => prev.filter((kf) => kf.id !== selectedKeyframeId));
		setSelectedKeyframeId(null);
	}, [selectedKeyframeId]);

	// Move keyframe to new time position
	const handleKeyframeMove = useCallback(
		(id: string, newTime: number) => {
			setKeyframes((prev) =>
				prev.map((kf) =>
					kf.id === id ? { ...kf, time: Math.max(0, Math.min(newTime, totalMs)) } : kf,
				),
			);
		},
		[totalMs],
	);

	// Delete selected zoom item
	const deleteSelectedZoom = useCallback(() => {
		if (!selectedZoomId) return;
		onZoomDelete(selectedZoomId);
		onSelectZoom(null);
	}, [selectedZoomId, onZoomDelete, onSelectZoom]);

	// Delete selected trim item
	const deleteSelectedTrim = useCallback(() => {
		if (!selectedTrimId || !onTrimDelete || !onSelectTrim) return;
		onTrimDelete(selectedTrimId);
		onSelectTrim(null);
	}, [selectedTrimId, onTrimDelete, onSelectTrim]);

	const deleteSelectedAnnotation = useCallback(() => {
		if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
		onAnnotationDelete(selectedAnnotationId);
		onSelectAnnotation(null);
	}, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

	const deleteSelectedSpeed = useCallback(() => {
		if (!selectedSpeedId || !onSpeedDelete || !onSelectSpeed) return;
		onSpeedDelete(selectedSpeedId);
		onSelectSpeed(null);
	}, [selectedSpeedId, onSpeedDelete, onSelectSpeed]);

	const deleteSelectedChapter = useCallback(() => {
		if (!selectedChapterId || !onDeleteChapter || !onSelectChapter) return;
		onDeleteChapter(selectedChapterId);
		onSelectChapter(null);
	}, [selectedChapterId, onDeleteChapter, onSelectChapter]);

	useEffect(() => {
		setRange(createInitialRange(totalMs));
	}, [totalMs]);

	// Normalize regions only when timeline bounds change (not on every region edit).
	// Using refs to read current regions avoids a dependency-loop that re-fires
	// this effect on every drag/resize and races with dnd-timeline's internal state.
	const zoomRegionsRef = useRef(zoomRegions);
	const trimRegionsRef = useRef(trimRegions);
	const speedRegionsRef = useRef(speedRegions);
	const chaptersRef = useRef(chapters);
	zoomRegionsRef.current = zoomRegions;
	trimRegionsRef.current = trimRegions;
	speedRegionsRef.current = speedRegions;
	chaptersRef.current = chapters;

	useEffect(() => {
		if (totalMs === 0 || safeMinDurationMs <= 0) {
			return;
		}

		zoomRegionsRef.current.forEach((region) => {
			const normalized = normalizeRegionSpan(region, totalMs, safeMinDurationMs);
			if (normalized) {
				onZoomSpanChange(region.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});

		trimRegionsRef.current.forEach((region) => {
			const normalized = normalizeRegionSpan(region, totalMs, safeMinDurationMs);
			if (normalized) {
				onTrimSpanChange?.(region.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});

		speedRegionsRef.current.forEach((region) => {
			const normalized = normalizeRegionSpan(region, totalMs, safeMinDurationMs);
			if (normalized) {
				onSpeedSpanChange?.(region.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});

		chaptersRef.current.forEach((ch) => {
			const normalized = normalizeRegionSpan(ch, totalMs, safeMinDurationMs);
			if (normalized) {
				onChapterSpanChange?.(ch.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});
	}, [totalMs, safeMinDurationMs, onZoomSpanChange, onTrimSpanChange, onSpeedSpanChange, onChapterSpanChange]);

	const hasOverlap = useCallback(
		(newSpan: Span, excludeId?: string): boolean => {
			// Determine which row the item belongs to
			const isZoomItem = zoomRegions.some((r) => r.id === excludeId);
			const isTrimItem = trimRegions.some((r) => r.id === excludeId);
			const isAnnotationItem = annotationRegions.some((r) => r.id === excludeId);
			const isSpeedItem = speedRegions.some((r) => r.id === excludeId);
			const isChapterItem = chapters.some((r) => r.id === excludeId);

			if (isAnnotationItem || isChapterItem) {
				return false;
			}

			// Helper to check overlap against a specific set of regions
			const checkOverlap = (regions: (ZoomRegion | TrimRegion | SpeedRegion)[]) => {
				return regions.some((region) => {
					if (region.id === excludeId) return false;
					return newSpan.end > region.startMs && newSpan.start < region.endMs;
				});
			};

			if (isZoomItem) {
				// Zoom cannot overlap other zooms OR trim regions
				return checkOverlap(zoomRegions) || checkOverlap(trimRegions);
			}

			if (isTrimItem) {
				return checkOverlap(trimRegions);
			}

			if (isSpeedItem) {
				// Speed cannot overlap other speeds OR trim regions
				return checkOverlap(speedRegions) || checkOverlap(trimRegions);
			}

			return false;
		},
		[zoomRegions, trimRegions, annotationRegions, speedRegions, chapters],
	);

	const defaultZoomDuration = useMemo(
		() => Math.max(1000, defaultZoomDurationMsProp),
		[defaultZoomDurationMsProp],
	);
	const defaultTrimDuration = useMemo(
		() => Math.max(1000, defaultTrimDurationMsProp),
		[defaultTrimDurationMsProp],
	);
	const defaultSpeedDuration = useMemo(
		() => Math.max(1000, defaultSpeedDurationMsProp),
		[defaultSpeedDurationMsProp],
	);
	const defaultAnnotationDuration = useMemo(
		() => Math.max(1000, Math.round(totalMs * 0.05)),
		[totalMs],
	);

	const isInsideTrimRegion = useCallback(
		(posMs: number): boolean => {
			return trimRegions.some((t) => posMs >= t.startMs && posMs < t.endMs);
		},
		[trimRegions],
	);

	const handleAddZoom = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		const defaultDuration = Math.min(defaultZoomDuration, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		// Always place zoom at playhead
		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));

		if (isInsideTrimRegion(startPos)) {
			toast.error(t("errors.cannotPlaceZoom"), {
				description: t("errors.cannotPlaceInsideTrim"),
			});
			return;
		}

		const { startMs, endMs, isOverlapping } = computeNewRegionSpan(
			zoomRegions, startPos, defaultZoomDuration, totalMs,
		);

		if (isOverlapping || endMs <= startMs) {
			toast.error(t("errors.cannotPlaceZoom"), {
				description: t("errors.zoomExistsAtLocation"),
			});
			return;
		}

		onZoomAdded({ start: startMs, end: endMs });
	}, [videoDuration, totalMs, currentTimeMs, zoomRegions, trimRegions, onZoomAdded, defaultZoomDuration, isInsideTrimRegion, t]);

	const handleSuggestZooms = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		if (!onZoomSuggested) {
			toast.error(t("errors.zoomSuggestionUnavailable"));
			return;
		}

		if (cursorTelemetry.length < 2) {
			toast.info(t("errors.noCursorTelemetry"), {
				description: t("errors.noCursorTelemetryDescription"),
			});
			return;
		}

		const defaultDuration = Math.min(defaultZoomDuration, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		const reservedSpans = [...zoomRegions]
			.map((region) => ({ start: region.startMs, end: region.endMs }))
			.sort((a, b) => a.start - b.start);

		const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);

		if (normalizedSamples.length < 2) {
			toast.info(t("errors.noUsableTelemetry"), {
				description: t("errors.noUsableTelemetryDescription"),
			});
			return;
		}

		const dwellCandidates = detectZoomDwellCandidates(normalizedSamples);

		if (dwellCandidates.length === 0) {
			toast.info(t("errors.noDwellMoments"), {
				description: t("errors.noDwellMomentsDescription"),
			});
			return;
		}

		const sortedCandidates = [...dwellCandidates].sort((a, b) => b.strength - a.strength);
		const acceptedCenters: number[] = [];

		let addedCount = 0;

		sortedCandidates.forEach((candidate) => {
			const tooCloseToAccepted = acceptedCenters.some(
				(center) => Math.abs(center - candidate.centerTimeMs) < SUGGESTION_SPACING_MS,
			);

			if (tooCloseToAccepted) {
				return;
			}

			const centeredStart = Math.round(candidate.centerTimeMs - defaultDuration / 2);
			const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - defaultDuration));
			const candidateEnd = candidateStart + defaultDuration;
			const hasOverlap = reservedSpans.some(
				(span) => candidateEnd > span.start && candidateStart < span.end,
			);

			if (hasOverlap) {
				return;
			}

			reservedSpans.push({ start: candidateStart, end: candidateEnd });
			acceptedCenters.push(candidate.centerTimeMs);
			onZoomSuggested({ start: candidateStart, end: candidateEnd }, candidate.focus);
			addedCount += 1;
		});

		if (addedCount === 0) {
			toast.info(t("errors.noAutoZoomSlots"), {
				description: t("errors.noAutoZoomSlotsDescription"),
			});
			return;
		}

		toast.success(
			addedCount === 1
				? t("success.addedZoomSuggestions", { count: String(addedCount) })
				: t("success.addedZoomSuggestionsPlural", { count: String(addedCount) }),
		);
	}, [
		videoDuration,
		totalMs,
		defaultZoomDuration,
		zoomRegions,
		onZoomSuggested,
		cursorTelemetry,
		t,
	]);

	const handleAddTrim = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onTrimAdded) {
			return;
		}

		const defaultDuration = Math.min(defaultTrimDuration, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		// Always place trim at playhead
		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const { startMs, endMs, isOverlapping } = computeNewRegionSpan(
			trimRegions, startPos, defaultTrimDuration, totalMs,
		);

		if (isOverlapping || endMs <= startMs) {
			toast.error(t("errors.cannotPlaceTrim"), {
				description: t("errors.trimExistsAtLocation"),
			});
			return;
		}

		onTrimAdded({ start: startMs, end: endMs });
	}, [videoDuration, totalMs, currentTimeMs, trimRegions, onTrimAdded, defaultTrimDuration, t]);

	const handleAddSpeed = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onSpeedAdded) {
			return;
		}

		const defaultDuration = Math.min(defaultSpeedDuration, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		// Always place speed region at playhead
		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));

		if (isInsideTrimRegion(startPos)) {
			toast.error(t("errors.cannotPlaceSpeed"), {
				description: t("errors.cannotPlaceInsideTrim"),
			});
			return;
		}

		// Find the next speed region after the playhead
		const sorted = [...speedRegions].sort((a, b) => a.startMs - b.startMs);
		const nextRegion = sorted.find((region) => region.startMs > startPos);
		const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

		// Check if playhead is inside any speed region
		const isOverlapping = sorted.some(
			(region) => startPos >= region.startMs && startPos < region.endMs,
		);
		if (isOverlapping || gapToNext <= 0) {
			toast.error(t("errors.cannotPlaceSpeed"), {
				description: t("errors.speedExistsAtLocation"),
			});
			return;
		}

		const actualDuration = Math.min(defaultSpeedDuration, gapToNext);
		onSpeedAdded({ start: startPos, end: startPos + actualDuration });
	}, [
		videoDuration,
		totalMs,
		currentTimeMs,
		speedRegions,
		trimRegions,
		onSpeedAdded,
		defaultSpeedDuration,
		isInsideTrimRegion,
		t,
	]);

	const handleAddAnnotation = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAnnotationAdded) {
			return;
		}

		const defaultDuration = Math.min(defaultAnnotationDuration, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		// Multiple annotations can exist at the same timestamp
		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const endPos = Math.min(startPos + defaultDuration, totalMs);

		onAnnotationAdded({ start: startPos, end: endPos });
	}, [videoDuration, totalMs, currentTimeMs, onAnnotationAdded, defaultAnnotationDuration]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
				return;
			}

			if (matchesShortcut(e, keyShortcuts.addKeyframe, isMac)) {
				addKeyframe();
			}
			if (matchesShortcut(e, keyShortcuts.addZoom, isMac)) {
				handleAddZoom();
			}
			if (matchesShortcut(e, keyShortcuts.addTrim, isMac)) {
				handleAddTrim();
			}
			if (matchesShortcut(e, keyShortcuts.addAnnotation, isMac)) {
				handleAddAnnotation();
			}
			if (matchesShortcut(e, keyShortcuts.addSpeed, isMac)) {
				handleAddSpeed();
			}

			// Tab: Cycle through overlapping annotations at current time
			if (e.key === "Tab" && annotationRegions.length > 0) {
				const currentTimeMs = Math.round(currentTime * 1000);
				const overlapping = annotationRegions
					.filter((a) => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
					.sort((a, b) => a.zIndex - b.zIndex); // Sort by z-index

				if (overlapping.length > 0) {
					e.preventDefault();

					if (!selectedAnnotationId || !overlapping.some((a) => a.id === selectedAnnotationId)) {
						onSelectAnnotation?.(overlapping[0].id);
					} else {
						// Cycle to next annotation
						const currentIndex = overlapping.findIndex((a) => a.id === selectedAnnotationId);
						const nextIndex = e.shiftKey
							? (currentIndex - 1 + overlapping.length) % overlapping.length // Shift+Tab = backward
							: (currentIndex + 1) % overlapping.length; // Tab = forward
						onSelectAnnotation?.(overlapping[nextIndex].id);
					}
				}
			}
			// Delete key or Ctrl+D / Cmd+D
			if (
				e.key === "Delete" ||
				e.key === "Backspace" ||
				matchesShortcut(e, keyShortcuts.deleteSelected, isMac)
			) {
				if (selectedKeyframeId) {
					deleteSelectedKeyframe();
				} else if (selectedZoomId) {
					deleteSelectedZoom();
				} else if (selectedTrimId) {
					deleteSelectedTrim();
				} else if (selectedAnnotationId) {
					deleteSelectedAnnotation();
				} else if (selectedSpeedId) {
					deleteSelectedSpeed();
				} else if (selectedChapterId) {
					deleteSelectedChapter();
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		addKeyframe,
		handleAddZoom,
		handleAddTrim,
		handleAddAnnotation,
		handleAddSpeed,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		deleteSelectedTrim,
		deleteSelectedAnnotation,
		deleteSelectedSpeed,
		deleteSelectedChapter,
		selectedKeyframeId,
		selectedZoomId,
		selectedTrimId,
		selectedAnnotationId,
		selectedSpeedId,
		selectedChapterId,
		annotationRegions,
		currentTime,
		onSelectAnnotation,
		keyShortcuts,
		isMac,
	]);

	const clampedRange = useMemo<Range>(() => {
		if (totalMs === 0) {
			return range;
		}

		return {
			start: Math.max(0, Math.min(range.start, totalMs)),
			end: Math.min(range.end, totalMs),
		};
	}, [range, totalMs]);

	const timelineItems = useMemo<TimelineRenderItem[]>(() => {
		const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
			id: region.id,
			rowId: ZOOM_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.zoomItem", { index: String(index + 1) }),
			zoomDepth: region.depth,
			variant: "zoom",
		}));

		const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
			id: region.id,
			rowId: TRIM_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.trimItem", { index: String(index + 1) }),
			variant: "trim",
		}));

		const annotations: TimelineRenderItem[] = annotationRegions.map((region) => {
			let label: string;

			if (region.type === "text") {
				// Show text preview
				const preview = region.content.trim() || t("labels.emptyText");
				label = preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
			} else if (region.type === "image") {
				label = t("labels.imageItem");
			} else {
				label = t("labels.annotationItem");
			}

			return {
				id: region.id,
				rowId: ANNOTATION_ROW_ID,
				span: { start: region.startMs, end: region.endMs },
				label,
				variant: "annotation",
			};
		});

		const speeds: TimelineRenderItem[] = speedRegions.map((region, index) => ({
			id: region.id,
			rowId: SPEED_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			label: t("labels.speedItem", { index: String(index + 1) }),
			speedValue: region.speed,
			variant: "speed",
		}));

		const chapterItems: TimelineRenderItem[] = chapters
			.filter((ch) => ch.endMs > ch.startMs)
			.map((ch, index) => ({
				id: ch.id,
				rowId: CHAPTER_ROW_ID,
				span: { start: ch.startMs, end: ch.endMs },
				label: t("labels.chapterItem", { index: String(index + 1) }),
				chapterName: ch.name,
				variant: "chapter",
			}));

		return [...zooms, ...trims, ...annotations, ...speeds, ...chapterItems];
	}, [zoomRegions, trimRegions, annotationRegions, speedRegions, chapters, t]);

	// Flat list of all non-annotation region spans for neighbour-clamping during drag/resize
	const allRegionSpans = useMemo(() => {
		const zooms = zoomRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		const trims = trimRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		const speeds = speedRegions.map((r) => ({ id: r.id, start: r.startMs, end: r.endMs }));
		return [...zooms, ...trims, ...speeds];
	}, [zoomRegions, trimRegions, speedRegions]);

	const handleItemSpanChange = useCallback(
		(id: string, span: Span) => {
			if (zoomRegions.some((r) => r.id === id)) {
				onZoomSpanChange(id, span);
			} else if (trimRegions.some((r) => r.id === id)) {
				onTrimSpanChange?.(id, span);
			} else if (speedRegions.some((r) => r.id === id)) {
				onSpeedSpanChange?.(id, span);
			} else if (annotationRegions.some((r) => r.id === id)) {
				onAnnotationSpanChange?.(id, span);
			} else if (chapters.some((r) => r.id === id)) {
				onChapterSpanChange?.(id, span);
			}
		},
		[
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			chapters,
			onZoomSpanChange,
			onTrimSpanChange,
			onSpeedSpanChange,
			onAnnotationSpanChange,
			onChapterSpanChange,
		],
	);

	if (!videoDuration || videoDuration === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-[#09090b] gap-3">
				<div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
					<Plus className="w-6 h-6 text-slate-600" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium text-slate-300">{t("emptyState.noVideo")}</p>
					<p className="text-xs text-slate-500 mt-1">{t("emptyState.dragAndDrop")}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col bg-[#09090b] overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-[#09090b]">
				<div className="flex items-center gap-1">
					<Button
						onClick={handleAddZoom}
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
						title={t("buttons.addZoom")}
					>
						<ZoomIn className="w-4 h-4" />
					</Button>
					<Button
						onClick={handleSuggestZooms}
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
						title={t("buttons.suggestZooms")}
					>
						<WandSparkles className="w-4 h-4" />
					</Button>
					<Button
						onClick={handleAddTrim}
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-slate-400 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
						title={t("buttons.addTrim")}
					>
						<Scissors className="w-4 h-4" />
					</Button>
					<Button
						onClick={handleAddAnnotation}
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-slate-400 hover:text-[#B4A046] hover:bg-[#B4A046]/10 transition-all"
						title={t("buttons.addAnnotation")}
					>
						<MessageSquare className="w-4 h-4" />
					</Button>
					<Button
						onClick={handleAddSpeed}
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-slate-400 hover:text-[#d97706] hover:bg-[#d97706]/10 transition-all"
						title={t("buttons.addSpeed")}
					>
						<Gauge className="w-4 h-4" />
					</Button>
					<Button
						onClick={onAddChapter}
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-slate-400 hover:text-[#a855f7] hover:bg-[#a855f7]/10 transition-all"
						title="Add chapter (C)"
					>
						<BookMarked className="w-4 h-4" />
					</Button>
				</div>
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all gap-1"
							>
								<span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
								<ChevronDown className="w-3 h-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10">
							{ASPECT_RATIOS.map((ratio) => (
								<DropdownMenuItem
									key={ratio}
									onClick={() => onAspectRatioChange(ratio)}
									className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3"
								>
									<span>{getAspectRatioLabel(ratio)}</span>
									{aspectRatio === ratio && <Check className="w-3 h-3 text-[#34B27B]" />}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					<div className="w-[1px] h-4 bg-white/10" />
					<TutorialHelp />
				</div>
				<div className="flex-1" />
				<div className="flex items-center gap-4 text-[10px] text-slate-500 font-medium">
					<span className="flex items-center gap-1.5">
						<kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-sans">
							{scrollLabels.pan}
						</kbd>
						<span>{t("labels.pan")}</span>
					</span>
					<span className="flex items-center gap-1.5">
						<kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-sans">
							{scrollLabels.zoom}
						</kbd>
						<span>{t("labels.zoom")}</span>
					</span>
				</div>
			</div>
			<div
				ref={timelineContainerRef}
				className="flex-1 overflow-y-auto overflow-x-hidden bg-[#09090b] relative"
				onClick={() => setSelectedKeyframeId(null)}
			>
				<TimelineWrapper
					range={clampedRange}
					videoDuration={videoDuration}
					hasOverlap={hasOverlap}
					onRangeChange={setRange}
					minItemDurationMs={timelineScale.minItemDurationMs}
					minVisibleRangeMs={timelineScale.minVisibleRangeMs}
					onItemSpanChange={handleItemSpanChange}
					allRegionSpans={allRegionSpans}
				>
					<KeyframeMarkers
						keyframes={keyframes}
						selectedKeyframeId={selectedKeyframeId}
						setSelectedKeyframeId={setSelectedKeyframeId}
						onKeyframeMove={handleKeyframeMove}
						videoDurationMs={totalMs}
						timelineRef={timelineContainerRef}
					/>
					<Timeline
						items={timelineItems}
						videoDurationMs={totalMs}
						currentTimeMs={currentTimeMs}
						onSeek={onSeek}
						onRangeChange={setRange}
						onSelectZoom={onSelectZoom}
						onSelectTrim={onSelectTrim}
						onSelectAnnotation={onSelectAnnotation}
						onSelectSpeed={onSelectSpeed}
						selectedZoomId={selectedZoomId}
						selectedTrimId={selectedTrimId}
						selectedAnnotationId={selectedAnnotationId}
						selectedSpeedId={selectedSpeedId}
						selectedChapterId={selectedChapterId}
						onSelectChapter={onSelectChapter}
						keyframes={keyframes}
						onDeleteChapter={onDeleteChapter}
						onRenameChapter={onRenameChapter}
						editingChapterId={editingChapterId}
						onEditChapter={onEditChapter}
						onTrimContextMenu={handleTrimContextMenu}
						onRegionContextMenu={handleRegionContextMenu}
						trimMarkStartMs={trimMarkStartMs}
						loopingTrimId={loopingTrimId}
					/>
				</TimelineWrapper>
			</div>

			{/* Trim context menu */}
			{trimContextMenu && (
				<ContextMenuPopover x={trimContextMenu.x} y={trimContextMenu.y} onClick={(e) => e.stopPropagation()}>

					<TrimContextMenuItems
						trimId={trimContextMenu.trimId}
						onClose={closeTrimContextMenu}
						onSetStartToNow={onTrimSetStartToNow}
						onSetEndToNow={onTrimSetEndToNow}
						onSetStartFromAdjacent={onTrimSetStartFromAdjacent}
						onSetEndFromAdjacent={onTrimSetEndFromAdjacent}
						onPlayFromStart={onTrimPlayFromStart}
						onPlayFromEnd={onTrimPlayFromEnd}
						onToggleLoop={onTrimToggleLoop}
						onDelete={onTrimDelete}
						onDuplicate={onDuplicateTrim}
						isLooping={loopingTrimId === trimContextMenu.trimId}
						hasAdjacentBefore={trimRegions.some(
							(r) => r.id !== trimContextMenu.trimId && r.endMs <= (trimRegions.find((t) => t.id === trimContextMenu.trimId)?.startMs ?? 0),
						)}
						hasAdjacentAfter={trimRegions.some(
							(r) => r.id !== trimContextMenu.trimId && r.startMs >= (trimRegions.find((t) => t.id === trimContextMenu.trimId)?.endMs ?? Infinity),
						)}
					/>
				</ContextMenuPopover>
			)}

			{/* Zoom / Speed / Annotation context menu */}
			{regionContextMenu && (
				<ContextMenuPopover x={regionContextMenu.x} y={regionContextMenu.y} onClick={(e) => e.stopPropagation()}>
					<RegionContextMenuItems
						regionType={regionContextMenu.type}
						onClose={closeRegionContextMenu}
						onSetStartToNow={handleRegionSetStartToNow}
						onSetEndToNow={handleRegionSetEndToNow}
						onDuplicate={handleRegionDuplicate}
						onDelete={handleRegionDelete}
					/>
				</ContextMenuPopover>
			)}
		</div>
	);
}
