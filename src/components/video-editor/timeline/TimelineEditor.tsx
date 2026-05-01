import type { Range, Span } from "dnd-timeline";
import { useTimelineContext } from "dnd-timeline";
import {
	Check,
	ChevronDown,
	Clock,
	Copy,
	Crosshair,
	Gauge,
	LocateFixed,
	MessageSquare,
	Play,
	Plus,
	Repeat,
	ScanSearch,
	Scissors,
	SkipBack,
	SkipForward,
	Trash2,
	WandSparkles,
	ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import {
	type DetectionProgress,
	detectDeadZones,
	listenDeadZoneProgress,
} from "@/lib/deadZoneDetection";
import { matchesShortcut } from "@/lib/shortcuts";
import { isTauri } from "@/lib/tauriBridge";
import { cn } from "@/lib/utils";
import { type RegionType, useContextMenuStore } from "@/stores/useContextMenuStore";
import { useEditorPreferencesStore } from "@/stores/useEditorPreferencesStore";
import { useEditorSelectionStore } from "@/stores/useEditorSelectionStore";
import { useEditorStore } from "@/stores/useEditorStore";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioLabel } from "@/utils/aspectRatioUtils";
import { formatShortcut } from "@/utils/platformUtils";
import { formatMsCompact } from "@/utils/timeUtils";
import { TutorialHelp } from "../TutorialHelp";
import type { CursorTelemetryPoint, SpeedRegion, TrimRegion, ZoomRegion } from "../types";
import Item from "./Item";
import Row from "./Row";
import { computeNewRegionSpan, normalizeRegionSpan } from "./regionUtils";
import TimelineWrapper from "./TimelineWrapper";
import {
	calculateAxisScale,
	calculateTimelineScale,
	clampVisibleRange,
	createInitialRange,
	formatTimeLabel,
	normalizeWheelDelta,
} from "./timelineScaleUtils";
import { detectZoomDwellCandidates, normalizeCursorTelemetry } from "./zoomSuggestionUtils";

const ZOOM_ROW_ID = "row-zoom";
const TRIM_ROW_ID = "row-trim";
const ANNOTATION_ROW_ID = "row-annotation";
const SPEED_ROW_ID = "row-speed";
const SUGGESTION_SPACING_MS = 1800;

interface TimelineEditorProps {
	videoDuration: number;
	currentTime: number;
	onSeek?: (time: number) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	aspectRatio: AspectRatio;
	onAspectRatioChange: (aspectRatio: AspectRatio) => void;
	// Trim playback actions that need DOM refs
	onTrimPlayFromStart?: (id: string) => void;
	onTrimPlayFromEnd?: (id: string) => void;
	onTrimToggleLoop?: (id: string) => void;
	loopingTrimId?: string | null;
	trimMarkStartMs?: number | null;
}

interface TimelineRenderItem {
	id: string;
	rowId: string;
	span: Span;
	label: string;
	zoomDepth?: number;
	speedValue?: number;
	variant: "zoom" | "trim" | "annotation" | "speed";
}

function PlaybackCursor({
	currentTimeMs,
	videoDurationMs,
	onSeek,
	onRangeChange,
	timelineRef,
}: {
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	onRangeChange?: (updater: (previous: Range) => Range) => void;
	timelineRef: React.RefObject<HTMLDivElement>;
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
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

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
	onDuplicate,
	onDelete,
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
	onDuplicate?: (id: string) => void;
	onDelete?: (id: string) => void;
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
			{item("Play from start (−5s)", <Play className="w-3.5 h-3.5" />, () =>
				onPlayFromStart?.(trimId),
			)}
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
			{item(
				"Delete trim",
				<Trash2 className="w-3.5 h-3.5" />,
				() => onDelete?.(trimId),
				false,
				"text-red-400",
			)}
		</>
	);
}

function ContextMenuPopover({
	x,
	y,
	onClose,
	children,
}: {
	x: number;
	y: number;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const menuRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		if (rect.bottom > window.innerHeight) {
			el.style.top = `${y - rect.height}px`;
		}
		if (rect.right > window.innerWidth) {
			el.style.left = `${x - rect.width}px`;
		}
	}, [x, y]);

	useEffect(() => {
		const handle = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		window.addEventListener("mousedown", handle);
		window.addEventListener("contextmenu", handle);
		return () => {
			window.removeEventListener("mousedown", handle);
			window.removeEventListener("contextmenu", handle);
		};
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			className="fixed z-[200] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[200px] text-[12px]"
			style={{ left: x, top: y }}
			onClick={(e) => e.stopPropagation()}
		>
			{children}
		</div>
	);
}

function RegionContextMenuItems({
	regionType,
	regionId,
	onClose,
	onSetStartToNow,
	onSetEndToNow,
	onDuplicate,
	onDelete,
}: {
	regionType: RegionType;
	regionId: string;
	onClose: () => void;
	onSetStartToNow?: (id: string) => void;
	onSetEndToNow?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	onDelete?: (id: string) => void;
}) {
	const item = (label: string, icon: React.ReactNode, onClick: () => void, accent?: string) => (
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
			{item("Set start to now", <Clock className="w-3.5 h-3.5" />, () =>
				onSetStartToNow?.(regionId),
			)}
			{item("Set end to now", <Clock className="w-3.5 h-3.5" />, () => onSetEndToNow?.(regionId))}
			<div className="h-[1px] bg-white/5 my-1" />
			{item("Duplicate", <Copy className="w-3.5 h-3.5" />, () => onDuplicate?.(regionId))}
			<div className="h-[1px] bg-white/5 my-1" />
			{item(
				`Delete ${regionType}`,
				<Trash2 className="w-3.5 h-3.5" />,
				() => onDelete?.(regionId),
				"text-red-400",
			)}
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
	onTrimContextMenu?: (id: string, event: React.MouseEvent) => void;
	onRegionContextMenu?: (type: RegionType, id: string, event: React.MouseEvent) => void;
	trimMarkStartMs?: number | null;
	loopingTrimId?: string | null;
}) {
	const t = useScopedT("timeline");
	const { setTimelineRef, style, sidebarWidth, range, pixelsToValue } = useTimelineContext();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);

	const {
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectZoom: onSelectZoom,
		selectTrim: onSelectTrim,
		selectSpeed: onSelectSpeed,
		selectAnnotation: onSelectAnnotation,
	} = useEditorSelectionStore();

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
			onSelectZoom(null);
			onSelectTrim(null);
			onSelectAnnotation(null);
			onSelectSpeed(null);

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

	const renderRow = (
		rowId: string,
		rowItems: TimelineRenderItem[],
		selectedId: string | null | undefined,
		onSelect: ((id: string | null) => void) | undefined,
		hint: string,
		contextMenuType?: RegionType,
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
					onContextMenu={
						contextMenuType
							? (e) => {
									e.preventDefault();
									onRegionContextMenu?.(contextMenuType, item.id, e);
								}
							: undefined
					}
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
							{item.label}{" "}
							<Repeat
								className="w-2.5 h-2.5 text-red-300 animate-spin"
								style={{ animationDuration: "2s" }}
							/>
						</span>
					) : (
						item.label
					)}
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
			/>
			<TrimMarkIndicator timeMs={trimMarkStartMs ?? null} videoDurationMs={videoDurationMs} />

			{renderRow(
				ZOOM_ROW_ID,
				zoomItems,
				selectedZoomId,
				onSelectZoom,
				t("hints.pressZoom"),
				"zoom",
			)}
			{renderTrimRow()}
			{renderRow(
				ANNOTATION_ROW_ID,
				annotationItems,
				selectedAnnotationId,
				onSelectAnnotation,
				t("hints.pressAnnotation"),
				"annotation",
			)}
			{renderRow(
				SPEED_ROW_ID,
				speedItems,
				selectedSpeedId,
				onSelectSpeed,
				t("hints.pressSpeed"),
				"speed",
			)}
		</div>
	);
}

export default function TimelineEditor({
	videoDuration,
	currentTime,
	onSeek,
	cursorTelemetry = [],
	aspectRatio,
	onAspectRatioChange,
	onTrimPlayFromStart,
	onTrimPlayFromEnd,
	onTrimToggleLoop,
	loopingTrimId,
	trimMarkStartMs,
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
	const [scrollLabels, setScrollLabels] = useState({
		pan: "Scroll",
		zoom: "Ctrl + Scroll",
	});
	const [isDetectingDeadZones, setIsDetectingDeadZones] = useState(false);
	const [detectionProgress, setDetectionProgress] = useState<DetectionProgress | null>(null);
	const [detectionElapsed, setDetectionElapsed] = useState(0);
	const timelineContainerRef = useRef<HTMLDivElement>(null);
	const { shortcuts: keyShortcuts, isMac } = useShortcuts();

	useEffect(() => {
		if (!isDetectingDeadZones) {
			setDetectionElapsed(0);
			return;
		}
		const start = Date.now();
		const id = setInterval(() => setDetectionElapsed(Date.now() - start), 100);
		return () => clearInterval(id);
	}, [isDetectingDeadZones]);

	// ── Read state & actions from stores ───────────────────────
	const store = useEditorStore();
	const { zoomRegions, trimRegions, speedRegions, annotationRegions, chapters } = store;

	const {
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectedChapterId,
		selectZoom: onSelectZoom,
		selectTrim: onSelectTrim,
		selectSpeed: onSelectSpeed,
		selectAnnotation: onSelectAnnotation,
		selectChapter: onSelectChapter,
	} = useEditorSelectionStore();

	const ctxMenu = useContextMenuStore();
	const defaultZoomDurationMs = useEditorPreferencesStore((s) => s.defaultZoomDurationMs);
	const defaultTrimDurationMs = useEditorPreferencesStore((s) => s.defaultTrimDurationMs);
	const defaultSpeedDurationMs = useEditorPreferencesStore((s) => s.defaultSpeedDurationMs);
	const defaultAnnotationDurationMs = useEditorPreferencesStore(
		(s) => s.defaultAnnotationDurationMs,
	);
	const followPlayhead = useEditorPreferencesStore((s) => s.followPlayhead);
	const showTrimHelp = useEditorPreferencesStore((s) => s.showTrimHelp);
	const showScrollHelp = useEditorPreferencesStore((s) => s.showScrollHelp);
	const updatePrefs = useEditorPreferencesStore((s) => s.update);
	const rangeRef = useRef(range);
	rangeRef.current = range;

	useEffect(() => {
		formatShortcut(["mod", "Scroll"]).then((zoom) => {
			setScrollLabels({ pan: "Scroll", zoom });
		});
	}, []);

	const handleTrimContextMenu = useCallback(
		(id: string, event: React.MouseEvent) => {
			ctxMenu.open("trim", id, event.clientX, event.clientY);
		},
		[ctxMenu],
	);

	const handleRegionContextMenu = useCallback(
		(type: RegionType, id: string, event: React.MouseEvent) => {
			ctxMenu.open(type, id, event.clientX, event.clientY);
		},
		[ctxMenu],
	);

	const findRegion = useCallback(
		(type: RegionType, id: string) => {
			if (type === "zoom") return zoomRegions.find((r) => r.id === id);
			if (type === "speed") return speedRegions.find((r) => r.id === id);
			if (type === "annotation") return annotationRegions.find((r) => r.id === id);
			return undefined;
		},
		[zoomRegions, speedRegions, annotationRegions],
	);

	const spanChangeForType = useCallback(
		(type: RegionType, id: string, span: { start: number; end: number }) => {
			if (type === "zoom") store.setZoomSpan(id, span);
			else if (type === "speed") store.setSpeedSpan(id, span);
			else if (type === "annotation") store.setAnnotationSpan(id, span);
		},
		[store],
	);

	const handleCtxSetStartToNow = useCallback(
		(id: string) => {
			if (!ctxMenu.regionType) return;
			const nowMs = Math.round(currentTime * 1000);
			const r = findRegion(ctxMenu.regionType, id);
			if (r && nowMs < r.endMs)
				spanChangeForType(ctxMenu.regionType, id, { start: nowMs, end: r.endMs });
		},
		[ctxMenu.regionType, currentTime, findRegion, spanChangeForType],
	);

	const handleCtxSetEndToNow = useCallback(
		(id: string) => {
			if (!ctxMenu.regionType) return;
			const nowMs = Math.round(currentTime * 1000);
			const r = findRegion(ctxMenu.regionType, id);
			if (r && nowMs > r.startMs)
				spanChangeForType(ctxMenu.regionType, id, { start: r.startMs, end: nowMs });
		},
		[ctxMenu.regionType, currentTime, findRegion, spanChangeForType],
	);

	const handleCtxDuplicate = useCallback(
		(id: string) => {
			if (ctxMenu.regionType === "zoom") store.duplicateZoom(id);
			else if (ctxMenu.regionType === "speed") store.duplicateSpeed(id);
			else if (ctxMenu.regionType === "annotation") store.duplicateAnnotation(id);
		},
		[ctxMenu.regionType, store],
	);

	const handleCtxDelete = useCallback(
		(id: string) => {
			if (ctxMenu.regionType === "zoom") store.deleteZoom(id);
			else if (ctxMenu.regionType === "speed") store.deleteSpeed(id);
			else if (ctxMenu.regionType === "annotation") store.deleteAnnotation(id);
		},
		[ctxMenu.regionType, store],
	);

	// Delete selected zoom item
	const deleteSelectedZoom = useCallback(() => {
		if (!selectedZoomId) return;
		store.deleteZoom(selectedZoomId);
		onSelectZoom(null);
	}, [selectedZoomId, store, onSelectZoom]);

	// Delete selected trim item
	const deleteSelectedTrim = useCallback(() => {
		if (!selectedTrimId) return;
		store.deleteTrim(selectedTrimId);
		onSelectTrim(null);
	}, [selectedTrimId, store, onSelectTrim]);

	const deleteSelectedAnnotation = useCallback(() => {
		if (!selectedAnnotationId) return;
		store.deleteAnnotation(selectedAnnotationId);
		onSelectAnnotation(null);
	}, [selectedAnnotationId, store, onSelectAnnotation]);

	const deleteSelectedSpeed = useCallback(() => {
		if (!selectedSpeedId) return;
		store.deleteSpeed(selectedSpeedId);
		onSelectSpeed(null);
	}, [selectedSpeedId, store, onSelectSpeed]);

	const deleteSelectedChapter = useCallback(() => {
		if (!selectedChapterId) return;
		store.deleteChapter(selectedChapterId);
		onSelectChapter(null);
	}, [selectedChapterId, store, onSelectChapter]);

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
				store.setZoomSpan(region.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});

		trimRegionsRef.current.forEach((region) => {
			const normalized = normalizeRegionSpan(region, totalMs, safeMinDurationMs);
			if (normalized) {
				store.setTrimSpan(region.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});

		speedRegionsRef.current.forEach((region) => {
			const normalized = normalizeRegionSpan(region, totalMs, safeMinDurationMs);
			if (normalized) {
				store.setSpeedSpan(region.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});

		chaptersRef.current.forEach((ch) => {
			const normalized = normalizeRegionSpan(ch, totalMs, safeMinDurationMs);
			if (normalized) {
				store.setChapterSpan(ch.id, { start: normalized.startMs, end: normalized.endMs });
			}
		});
	}, [totalMs, safeMinDurationMs, store]);

	const hasOverlap = useCallback(
		(newSpan: Span, excludeId?: string): boolean => {
			// Determine which row the item belongs to
			const isZoomItem = zoomRegions.some((r) => r.id === excludeId);
			const isTrimItem = trimRegions.some((r) => r.id === excludeId);
			const isAnnotationItem = annotationRegions.some((r) => r.id === excludeId);
			const isSpeedItem = speedRegions.some((r) => r.id === excludeId);

			if (isAnnotationItem) {
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
				return false;
			}

			if (isSpeedItem) {
				// Speed cannot overlap other speeds OR trim regions
				return checkOverlap(speedRegions) || checkOverlap(trimRegions);
			}

			return false;
		},
		[zoomRegions, trimRegions, annotationRegions, speedRegions],
	);

	const clampDuration = useCallback(
		(preferredMs: number) => Math.max(1000, Math.min(preferredMs, totalMs)),
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

		const dur = clampDuration(defaultZoomDurationMs);
		if (dur <= 0) return;

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));

		if (isInsideTrimRegion(startPos)) {
			toast.error(t("errors.cannotPlaceZoom"), {
				description: t("errors.cannotPlaceInsideTrim"),
			});
			return;
		}

		const { startMs, endMs, isOverlapping } = computeNewRegionSpan(
			zoomRegions,
			startPos,
			dur,
			totalMs,
		);

		if (isOverlapping || endMs <= startMs) {
			toast.error(t("errors.cannotPlaceZoom"), {
				description: t("errors.zoomExistsAtLocation"),
			});
			return;
		}

		store.addAndSelectZoom({ start: startMs, end: endMs });
	}, [
		videoDuration,
		totalMs,
		currentTimeMs,
		zoomRegions,
		store,
		defaultZoomDurationMs,
		clampDuration,
		isInsideTrimRegion,
		t,
	]);

	const handleSuggestZooms = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		if (!store.addAndSelectZoomSuggested) {
			toast.error(t("errors.zoomSuggestionUnavailable"));
			return;
		}

		if (cursorTelemetry.length < 2) {
			toast.info(t("errors.noCursorTelemetry"), {
				description: t("errors.noCursorTelemetryDescription"),
			});
			return;
		}

		const dur = clampDuration(defaultZoomDurationMs);
		if (dur <= 0) return;

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

			const centeredStart = Math.round(candidate.centerTimeMs - dur / 2);
			const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - dur));
			const candidateEnd = candidateStart + dur;
			const hasOverlap = reservedSpans.some(
				(span) => candidateEnd > span.start && candidateStart < span.end,
			);

			if (hasOverlap) {
				return;
			}

			reservedSpans.push({ start: candidateStart, end: candidateEnd });
			acceptedCenters.push(candidate.centerTimeMs);
			store.addAndSelectZoomSuggested(
				{ start: candidateStart, end: candidateEnd },
				candidate.focus,
			);
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
		defaultZoomDurationMs,
		clampDuration,
		zoomRegions,
		store,
		cursorTelemetry,
		t,
	]);

	const handleDetectDeadZones = useCallback(async () => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) return;
		if (!isTauri()) {
			toast.error(t("errors.deadZoneDesktopOnly"));
			return;
		}
		if (isDetectingDeadZones) return;

		setIsDetectingDeadZones(true);
		setDetectionProgress(null);

		let unlisten: (() => void) | null = null;
		try {
			unlisten = await listenDeadZoneProgress((p) => setDetectionProgress(p));

			const result = await detectDeadZones();
			if (result.deadZones.length === 0) {
				toast.info(t("deadZone.noDeadZones"), {
					description: t("deadZone.noDeadZonesDescription"),
				});
				return;
			}

			let addedCount = 0;
			for (const zone of result.deadZones) {
				const hasOverlap = trimRegions.some(
					(r) => zone.endMs > r.startMs && zone.startMs < r.endMs,
				);
				if (!hasOverlap) {
					store.addTrim({ start: zone.startMs, end: zone.endMs });
					addedCount++;
				}
			}

			if (addedCount === 0) {
				toast.info(t("deadZone.allOverlap"));
			} else {
				toast.success(
					t("deadZone.added", {
						count: String(addedCount),
						total: String(result.deadZones.length),
					}),
				);
			}
		} catch (err) {
			toast.error(t("deadZone.failed"), {
				description: String(err),
			});
		} finally {
			unlisten?.();
			setIsDetectingDeadZones(false);
			setDetectionProgress(null);
		}
	}, [videoDuration, totalMs, isDetectingDeadZones, trimRegions, store, t]);

	const handleAddTrim = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		const dur = clampDuration(defaultTrimDurationMs);
		if (dur <= 0) return;

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const { startMs, endMs, isOverlapping } = computeNewRegionSpan(
			trimRegions,
			startPos,
			dur,
			totalMs,
		);

		if (isOverlapping || endMs <= startMs) {
			toast.error(t("errors.cannotPlaceTrim"), {
				description: t("errors.trimExistsAtLocation"),
			});
			return;
		}

		store.addAndSelectTrim({ start: startMs, end: endMs });
	}, [
		videoDuration,
		totalMs,
		currentTimeMs,
		trimRegions,
		store,
		defaultTrimDurationMs,
		clampDuration,
		t,
	]);

	const handleAddSpeed = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		const dur = clampDuration(defaultSpeedDurationMs);
		if (dur <= 0) return;

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));

		if (isInsideTrimRegion(startPos)) {
			toast.error(t("errors.cannotPlaceSpeed"), {
				description: t("errors.cannotPlaceInsideTrim"),
			});
			return;
		}

		const sorted = [...speedRegions].sort((a, b) => a.startMs - b.startMs);
		const nextRegion = sorted.find((region) => region.startMs > startPos);
		const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

		const isOverlapping = sorted.some(
			(region) => startPos >= region.startMs && startPos < region.endMs,
		);
		if (isOverlapping || gapToNext <= 0) {
			toast.error(t("errors.cannotPlaceSpeed"), {
				description: t("errors.speedExistsAtLocation"),
			});
			return;
		}

		const actualDuration = Math.min(dur, gapToNext);
		store.addAndSelectSpeed({ start: startPos, end: startPos + actualDuration });
	}, [
		videoDuration,
		totalMs,
		currentTimeMs,
		speedRegions,
		store,
		defaultSpeedDurationMs,
		clampDuration,
		isInsideTrimRegion,
		t,
	]);

	const handleAddAnnotation = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		const dur = clampDuration(defaultAnnotationDurationMs);
		if (dur <= 0) return;

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const endPos = Math.min(startPos + dur, totalMs);

		store.addAndSelectAnnotation({ start: startPos, end: endPos });
	}, [videoDuration, totalMs, currentTimeMs, store, defaultAnnotationDurationMs, clampDuration]);

	const handleGoToNow = useCallback(() => {
		const currentRange = rangeRef.current;
		const visibleMs = currentRange.end - currentRange.start;
		if (visibleMs <= 0 || totalMs === 0) return;

		let newStart = currentTimeMs - visibleMs / 2;
		let newEnd = currentTimeMs + visibleMs / 2;

		if (newStart < 0) {
			newStart = 0;
			newEnd = Math.min(visibleMs, totalMs);
		}
		if (newEnd > totalMs) {
			newEnd = totalMs;
			newStart = Math.max(0, totalMs - visibleMs);
		}

		setRange({ start: newStart, end: newEnd });
	}, [currentTimeMs, totalMs]);

	useEffect(() => {
		if (!followPlayhead || totalMs === 0) return;

		const currentRange = rangeRef.current;
		const visibleMs = currentRange.end - currentRange.start;
		if (visibleMs <= 0) return;

		let newStart = currentTimeMs - visibleMs / 2;
		let newEnd = currentTimeMs + visibleMs / 2;

		if (newStart < 0) {
			newStart = 0;
			newEnd = Math.min(visibleMs, totalMs);
		}
		if (newEnd > totalMs) {
			newEnd = totalMs;
			newStart = Math.max(0, totalMs - visibleMs);
		}

		setRange({ start: newStart, end: newEnd });
	}, [followPlayhead, currentTimeMs, totalMs]);

	const handleGoToTrimStart = useCallback(() => {
		if (trimRegions.length === 0 || !onSeek) return;
		const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
		const nowMs = currentTimeMs;
		const next = sorted.find((t) => t.startMs > nowMs + 50);
		const target = next ?? sorted[0];
		onSeek(target.startMs / 1000);
		handleGoToNow();
	}, [trimRegions, currentTimeMs, onSeek, handleGoToNow]);

	const handleGoToPrevTrimStart = useCallback(() => {
		if (trimRegions.length === 0 || !onSeek) return;
		const sorted = [...trimRegions].sort((a, b) => b.startMs - a.startMs);
		const nowMs = currentTimeMs;
		const prev = sorted.find((t) => t.startMs < nowMs - 50);
		const target = prev ?? sorted[0];
		onSeek(target.startMs / 1000);
		handleGoToNow();
	}, [trimRegions, currentTimeMs, onSeek, handleGoToNow]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
				return;
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
			if (matchesShortcut(e, keyShortcuts.goToNow, isMac)) {
				handleGoToNow();
			}
			if (matchesShortcut(e, keyShortcuts.followPlayhead, isMac)) {
				updatePrefs({ followPlayhead: !followPlayhead });
			}
			if (matchesShortcut(e, keyShortcuts.goToTrimStart, isMac)) {
				handleGoToTrimStart();
			}
			if (matchesShortcut(e, keyShortcuts.goToPrevTrimStart, isMac)) {
				handleGoToPrevTrimStart();
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
						onSelectAnnotation(overlapping[0].id);
					} else {
						// Cycle to next annotation
						const currentIndex = overlapping.findIndex((a) => a.id === selectedAnnotationId);
						const nextIndex = e.shiftKey
							? (currentIndex - 1 + overlapping.length) % overlapping.length // Shift+Tab = backward
							: (currentIndex + 1) % overlapping.length; // Tab = forward
						onSelectAnnotation(overlapping[nextIndex].id);
					}
				}
			}
			// Delete key or Ctrl+D / Cmd+D
			if (
				e.key === "Delete" ||
				e.key === "Backspace" ||
				matchesShortcut(e, keyShortcuts.deleteSelected, isMac)
			) {
				if (selectedZoomId) {
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
		handleAddZoom,
		handleAddTrim,
		handleAddAnnotation,
		handleAddSpeed,
		handleGoToNow,
		handleGoToTrimStart,
		handleGoToPrevTrimStart,
		followPlayhead,
		updatePrefs,
		deleteSelectedZoom,
		deleteSelectedTrim,
		deleteSelectedAnnotation,
		deleteSelectedSpeed,
		deleteSelectedChapter,
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

		return [...zooms, ...trims, ...annotations, ...speeds];
	}, [zoomRegions, trimRegions, annotationRegions, speedRegions, t]);

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
				store.setZoomSpan(id, span);
			} else if (trimRegions.some((r) => r.id === id)) {
				store.setTrimSpan(id, span);
			} else if (speedRegions.some((r) => r.id === id)) {
				store.setSpeedSpan(id, span);
			} else if (annotationRegions.some((r) => r.id === id)) {
				store.setAnnotationSpan(id, span);
			}
		},
		[zoomRegions, trimRegions, speedRegions, annotationRegions, store],
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
					{isTauri() && !isDetectingDeadZones && (
						<Button
							onClick={handleDetectDeadZones}
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-slate-400 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
							title={t("buttons.detectDeadZones")}
						>
							<ScanSearch className="w-4 h-4" />
						</Button>
					)}
					{isDetectingDeadZones && (
						<div className="flex items-center gap-1.5 px-2 h-7">
							<ScanSearch className="w-3.5 h-3.5 text-[#ef4444] animate-pulse" />
							<div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
								{detectionProgress ? (
									<div
										className="h-full rounded-full bg-[#ef4444]/80 transition-all duration-300"
										style={{ width: `${Math.round(detectionProgress.percent * 100)}%` }}
									/>
								) : (
									<div className="h-full w-1/3 rounded-full bg-[#ef4444]/80 animate-indeterminate" />
								)}
							</div>
							<span className="text-[10px] tabular-nums text-slate-400 min-w-[4ch]">
								{detectionProgress
									? `${Math.round(detectionProgress.percent * 100)}%`
									: `${(detectionElapsed / 1000).toFixed(1)}s`}
							</span>
							{detectionProgress && (
								<span className="text-[10px] text-slate-500">{detectionProgress.phase}</span>
							)}
						</div>
					)}
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
				</div>
				<div className="w-[1px] h-4 bg-white/10" />
				<Button
					onClick={handleGoToNow}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
					title="Go to playhead position (G)"
				>
					<Crosshair className="w-4 h-4" />
				</Button>
				<Button
					onClick={handleGoToPrevTrimStart}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-slate-400 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
					title="Go to previous trim (Shift+I)"
				>
					<SkipBack className="w-4 h-4" />
				</Button>
				<Button
					onClick={handleGoToTrimStart}
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-slate-400 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
					title="Go to next trim (I)"
				>
					<SkipForward className="w-4 h-4" />
				</Button>
				<Button
					onClick={() => updatePrefs({ followPlayhead: !followPlayhead })}
					variant="ghost"
					size="icon"
					className={cn(
						"h-7 w-7 transition-all",
						followPlayhead
							? "text-[#34B27B] bg-[#34B27B]/10"
							: "text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10",
					)}
					title={followPlayhead ? "Stop following playhead (L)" : "Follow playhead (L)"}
				>
					<LocateFixed className="w-4 h-4" />
				</Button>

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
					{showTrimHelp && (
						<>
							<div className="w-[1px] h-4 bg-white/10" />
							<TutorialHelp />
						</>
					)}
				</div>
				<div className="flex-1" />
				{showScrollHelp && (
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
				)}
			</div>
			<div
				ref={timelineContainerRef}
				className="flex-1 overflow-y-auto overflow-x-hidden bg-[#09090b] relative"
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
					<Timeline
						items={timelineItems}
						videoDurationMs={totalMs}
						currentTimeMs={currentTimeMs}
						onSeek={onSeek}
						onRangeChange={setRange}
						onTrimContextMenu={handleTrimContextMenu}
						onRegionContextMenu={handleRegionContextMenu}
						trimMarkStartMs={trimMarkStartMs}
						loopingTrimId={loopingTrimId}
					/>
				</TimelineWrapper>
			</div>

			{/* Trim context menu (with trim-specific actions) */}
			{ctxMenu.regionType === "trim" && ctxMenu.regionId && (
				<ContextMenuPopover x={ctxMenu.x} y={ctxMenu.y} onClose={ctxMenu.close}>
					<TrimContextMenuItems
						trimId={ctxMenu.regionId}
						onClose={ctxMenu.close}
						onSetStartToNow={(id) => store.setTrimStartToNow(id, Math.round(currentTime * 1000))}
						onSetEndToNow={(id) => store.setTrimEndToNow(id, Math.round(currentTime * 1000))}
						onSetStartFromAdjacent={store.setTrimStartFromAdjacent}
						onSetEndFromAdjacent={store.setTrimEndFromAdjacent}
						onPlayFromStart={onTrimPlayFromStart}
						onPlayFromEnd={onTrimPlayFromEnd}
						onToggleLoop={onTrimToggleLoop}
						onDuplicate={store.duplicateTrim}
						onDelete={store.deleteTrim}
						isLooping={loopingTrimId === ctxMenu.regionId}
						hasAdjacentBefore={trimRegions.some(
							(r) =>
								r.id !== ctxMenu.regionId &&
								r.endMs <= (trimRegions.find((tr) => tr.id === ctxMenu.regionId)?.startMs ?? 0),
						)}
						hasAdjacentAfter={trimRegions.some(
							(r) =>
								r.id !== ctxMenu.regionId &&
								r.startMs >=
									(trimRegions.find((tr) => tr.id === ctxMenu.regionId)?.endMs ?? Infinity),
						)}
					/>
				</ContextMenuPopover>
			)}

			{/* Generic context menu for zoom/speed/annotation */}
			{ctxMenu.regionType && ctxMenu.regionType !== "trim" && ctxMenu.regionId && (
				<ContextMenuPopover x={ctxMenu.x} y={ctxMenu.y} onClose={ctxMenu.close}>
					<RegionContextMenuItems
						regionType={ctxMenu.regionType}
						regionId={ctxMenu.regionId}
						onClose={ctxMenu.close}
						onSetStartToNow={handleCtxSetStartToNow}
						onSetEndToNow={handleCtxSetEndToNow}
						onDuplicate={handleCtxDuplicate}
						onDelete={handleCtxDelete}
					/>
				</ContextMenuPopover>
			)}
		</div>
	);
}
