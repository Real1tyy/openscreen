import { BackgroundSection } from "./settings/BackgroundSection";
import { EffectsSection } from "./settings/EffectsSection";
import {
	Bug,
	Download,
	Film,
	Image,
	Lock,
	Sparkles,
	Star,
	Trash2,
	Unlock,
	X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { WEBCAM_LAYOUT_PRESETS } from "@/lib/compositeLayout";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS } from "@/lib/exporter";
import { cn } from "@/lib/utils";
import { type AspectRatio, isPortraitAspectRatio } from "@/utils/aspectRatioUtils";
import { getAPI } from "@/lib/tauriBridge";
import { getTestId } from "@/utils/getTestId";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { CropControl } from "./CropControl";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import type {
	AnnotationRegion,
	AnnotationType,
	CropRegion,
	FigureData,
	PlaybackSpeed,
	WebcamLayoutPreset,
	WebcamMaskShape,
	WebcamSizePreset,
	ZoomDepth,
	ZoomFocusMode,
} from "./types";
import { DEFAULT_WEBCAM_SIZE_PRESET, MAX_PLAYBACK_SPEED, SPEED_OPTIONS } from "./types";

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
				pattern="[0-9]*"
				placeholder="--"
				value={draft}
				onFocus={() => setIsFocused(true)}
				onChange={handleChange}
				onBlur={handleBlur}
				onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
				className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-0.5 text-[11px] font-semibold text-[#d97706] text-center focus:outline-none focus:border-[#d97706]/40"
			/>
			<span className="text-[11px] font-semibold text-slate-500">×</span>
		</div>
	);
}

interface SettingsPanelProps {
	selected: string;
	onWallpaperChange: (path: string) => void;
	selectedZoomDepth?: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	selectedZoomFocusMode?: ZoomFocusMode | null;
	onZoomFocusModeChange?: (mode: ZoomFocusMode) => void;
	hasCursorTelemetry?: boolean;
	selectedZoomId?: string | null;
	onZoomDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onTrimDelete?: (id: string) => void;
	shadowIntensity?: number;
	onShadowChange?: (intensity: number) => void;
	onShadowCommit?: () => void;
	showBlur?: boolean;
	onBlurChange?: (showBlur: boolean) => void;
	motionBlurAmount?: number;
	onMotionBlurChange?: (amount: number) => void;
	onMotionBlurCommit?: () => void;
	borderRadius?: number;
	onBorderRadiusChange?: (radius: number) => void;
	onBorderRadiusCommit?: () => void;
	padding?: number;
	onPaddingChange?: (padding: number) => void;
	onPaddingCommit?: () => void;
	cropRegion?: CropRegion;
	onCropChange?: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
	videoElement?: HTMLVideoElement | null;
	exportQuality?: ExportQuality;
	onExportQualityChange?: (quality: ExportQuality) => void;
	// Export format settings
	exportFormat?: ExportFormat;
	onExportFormatChange?: (format: ExportFormat) => void;
	gifFrameRate?: GifFrameRate;
	onGifFrameRateChange?: (rate: GifFrameRate) => void;
	gifLoop?: boolean;
	onGifLoopChange?: (loop: boolean) => void;
	gifSizePreset?: GifSizePreset;
	onGifSizePresetChange?: (preset: GifSizePreset) => void;
	gifOutputDimensions?: { width: number; height: number };
	onExport?: () => void;
	unsavedExport?: {
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null;
	onSaveUnsavedExport?: () => void;
	selectedAnnotationId?: string | null;
	annotationRegions?: AnnotationRegion[];
	onAnnotationContentChange?: (id: string, content: string) => void;
	onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
	onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion["style"]>) => void;
	onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedSpeedId?: string | null;
	selectedSpeedValue?: PlaybackSpeed | null;
	onSpeedChange?: (speed: PlaybackSpeed) => void;
	onSpeedDelete?: (id: string) => void;
	hasWebcam?: boolean;
	webcamLayoutPreset?: WebcamLayoutPreset;
	onWebcamLayoutPresetChange?: (preset: WebcamLayoutPreset) => void;
	webcamMaskShape?: import("./types").WebcamMaskShape;
	onWebcamMaskShapeChange?: (shape: import("./types").WebcamMaskShape) => void;
	webcamSizePreset?: WebcamSizePreset;
	onWebcamSizePresetChange?: (size: WebcamSizePreset) => void;
	onWebcamSizePresetCommit?: () => void;
}

export default SettingsPanel;

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
	{ depth: 1, label: "1.25×" },
	{ depth: 2, label: "1.5×" },
	{ depth: 3, label: "1.8×" },
	{ depth: 4, label: "2.2×" },
	{ depth: 5, label: "3.5×" },
	{ depth: 6, label: "5×" },
];

export function SettingsPanel({
	selected,
	onWallpaperChange,
	selectedZoomDepth,
	onZoomDepthChange,
	selectedZoomFocusMode,
	onZoomFocusModeChange,
	hasCursorTelemetry = false,
	selectedZoomId,
	onZoomDelete,
	selectedTrimId,
	onTrimDelete,
	shadowIntensity = 0,
	onShadowChange,
	onShadowCommit,
	showBlur,
	onBlurChange,
	motionBlurAmount = 0,
	onMotionBlurChange,
	onMotionBlurCommit,
	borderRadius = 0,
	onBorderRadiusChange,
	onBorderRadiusCommit,
	padding = 50,
	onPaddingChange,
	onPaddingCommit,
	cropRegion,
	onCropChange,
	aspectRatio,
	videoElement,
	exportQuality = "good",
	onExportQualityChange,
	exportFormat = "mp4",
	onExportFormatChange,
	gifFrameRate = 15,
	onGifFrameRateChange,
	gifLoop = true,
	onGifLoopChange,
	gifSizePreset = "medium",
	onGifSizePresetChange,
	gifOutputDimensions = { width: 1280, height: 720 },
	onExport,
	unsavedExport,
	onSaveUnsavedExport,
	selectedAnnotationId,
	annotationRegions = [],
	onAnnotationContentChange,
	onAnnotationTypeChange,
	onAnnotationStyleChange,
	onAnnotationFigureDataChange,
	onAnnotationDelete,
	selectedSpeedId,
	selectedSpeedValue,
	onSpeedChange,
	onSpeedDelete,
	hasWebcam = false,
	webcamLayoutPreset = "picture-in-picture",
	onWebcamLayoutPresetChange,
	webcamMaskShape = "rectangle",
	onWebcamMaskShapeChange,
	webcamSizePreset = DEFAULT_WEBCAM_SIZE_PRESET,
	onWebcamSizePresetChange,
	onWebcamSizePresetCommit,
}: SettingsPanelProps) {
	const t = useScopedT("settings");
	const [showCropModal, setShowCropModal] = useState(false);
	const cropSnapshotRef = useRef<CropRegion | null>(null);
	const [cropAspectLocked, setCropAspectLocked] = useState(false);
	const [cropAspectRatio, setCropAspectRatio] = useState("");

	const videoWidth = videoElement?.videoWidth || 1920;
	const videoHeight = videoElement?.videoHeight || 1080;

	const handleCropNumericChange = useCallback(
		(field: "x" | "y" | "width" | "height", pixelValue: number) => {
			if (!cropRegion || !onCropChange) return;

			const next = { ...cropRegion };
			switch (field) {
				case "x":
					next.x = Math.max(0, Math.min(pixelValue / videoWidth, 1 - next.width));
					break;
				case "y":
					next.y = Math.max(0, Math.min(pixelValue / videoHeight, 1 - next.height));
					break;
				case "width": {
					const newWidth = Math.max(0.05, Math.min(pixelValue / videoWidth, 1 - next.x));
					if (cropAspectLocked && next.width > 0 && next.height > 0) {
						const ratio = next.width / next.height;
						const newHeight = newWidth / ratio;
						if (next.y + newHeight <= 1) {
							next.width = newWidth;
							next.height = newHeight;
						}
					} else {
						next.width = newWidth;
					}
					break;
				}
				case "height": {
					const newHeight = Math.max(0.05, Math.min(pixelValue / videoHeight, 1 - next.y));
					if (cropAspectLocked && next.width > 0 && next.height > 0) {
						const ratio = next.width / next.height;
						const newWidth = newHeight * ratio;
						if (next.x + newWidth <= 1) {
							next.height = newHeight;
							next.width = newWidth;
						}
					} else {
						next.height = newHeight;
					}
					break;
				}
			}

			onCropChange(next);
		},
		[cropRegion, onCropChange, videoWidth, videoHeight, cropAspectLocked],
	);

	const applyCropAspectPreset = useCallback(
		(preset: string) => {
			if (!cropRegion || !onCropChange) return;

			setCropAspectRatio(preset);
			if (preset === "") {
				setCropAspectLocked(false);
				return;
			}

			const [wStr, hStr] = preset.split(":");
			const targetRatio = Number(wStr) / Number(hStr);
			const next = { ...cropRegion };

			const nextHeight = (next.width * videoWidth) / (targetRatio * videoHeight);
			if (next.y + nextHeight <= 1 && nextHeight >= 0.05) {
				next.height = nextHeight;
			} else {
				const nextWidth = (next.height * videoHeight * targetRatio) / videoWidth;
				if (next.x + nextWidth <= 1 && nextWidth >= 0.05) {
					next.width = nextWidth;
				}
			}

			onCropChange(next);
			setCropAspectLocked(true);
		},
		[cropRegion, onCropChange, videoWidth, videoHeight],
	);

	const getCropPixelValue = useCallback(
		(field: "x" | "y" | "width" | "height"): number => {
			if (!cropRegion) return 0;
			switch (field) {
				case "x":
					return Math.round(cropRegion.x * videoWidth);
				case "y":
					return Math.round(cropRegion.y * videoHeight);
				case "width":
					return Math.round(cropRegion.width * videoWidth);
				case "height":
					return Math.round(cropRegion.height * videoHeight);
			}
		},
		[cropRegion, videoWidth, videoHeight],
	);

	const zoomEnabled = Boolean(selectedZoomDepth);
	const trimEnabled = Boolean(selectedTrimId);

	const handleDeleteClick = () => {
		if (selectedZoomId && onZoomDelete) {
			onZoomDelete(selectedZoomId);
		}
	};

	const handleTrimDeleteClick = () => {
		if (selectedTrimId && onTrimDelete) {
			onTrimDelete(selectedTrimId);
		}
	};

	const handleCropToggle = () => {
		if (!showCropModal && cropRegion) {
			cropSnapshotRef.current = { ...cropRegion };
		}
		setShowCropModal(!showCropModal);
	};

	const handleCropCancel = () => {
		if (cropSnapshotRef.current && onCropChange) {
			onCropChange(cropSnapshotRef.current);
		}
		setShowCropModal(false);
	};

	// Find selected annotation
	const selectedAnnotation = selectedAnnotationId
		? annotationRegions.find((a) => a.id === selectedAnnotationId)
		: null;

	// If an annotation is selected, show annotation settings instead
	if (
		selectedAnnotation &&
		onAnnotationContentChange &&
		onAnnotationTypeChange &&
		onAnnotationStyleChange &&
		onAnnotationDelete
	) {
		return (
			<AnnotationSettingsPanel
				annotation={selectedAnnotation}
				onContentChange={(content) => onAnnotationContentChange(selectedAnnotation.id, content)}
				onTypeChange={(type) => onAnnotationTypeChange(selectedAnnotation.id, type)}
				onStyleChange={(style) => onAnnotationStyleChange(selectedAnnotation.id, style)}
				onFigureDataChange={
					onAnnotationFigureDataChange
						? (figureData) => onAnnotationFigureDataChange(selectedAnnotation.id, figureData)
						: undefined
				}
				onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
			/>
		);
	}

	return (
		<div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
			<div className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-0">
				<div className="mb-4">
					<div className="flex items-center justify-between mb-3">
						<span className="text-sm font-medium text-slate-200">{t("zoom.level")}</span>
						<div className="flex items-center gap-2">
							{zoomEnabled && selectedZoomDepth && (
								<span className="text-[10px] uppercase tracking-wider font-medium text-[#34B27B] bg-[#34B27B]/10 px-2 py-0.5 rounded-full">
									{ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)?.label}
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
					{zoomEnabled && (
						<Button
							onClick={handleDeleteClick}
							variant="destructive"
							size="sm"
							className="mt-2 w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
						>
							<Trash2 className="w-3 h-3" />
							{t("zoom.deleteZoom")}
						</Button>
					)}
				</div>

				{trimEnabled && (
					<div className="mb-4">
						<Button
							onClick={handleTrimDeleteClick}
							variant="destructive"
							size="sm"
							className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
						>
							<Trash2 className="w-3 h-3" />
							{t("trim.deleteRegion")}
						</Button>
					</div>
				)}

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
					{selectedSpeedId && (
						<Button
							onClick={() => selectedSpeedId && onSpeedDelete?.(selectedSpeedId)}
							variant="destructive"
							size="sm"
							className="mt-2 w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
						>
							<Trash2 className="w-3 h-3" />
							{t("speed.deleteRegion")}
						</Button>
					)}
				</div>

				<Accordion
					type="multiple"
					defaultValue={hasWebcam ? ["layout", "effects", "background"] : ["effects", "background"]}
					className="space-y-1"
				>
					{hasWebcam && (
						<AccordionItem
							value="layout"
							className="border-white/5 rounded-xl bg-white/[0.02] px-3"
						>
							<AccordionTrigger className="py-2.5 hover:no-underline">
								<div className="flex items-center gap-2">
									<Sparkles className="w-4 h-4 text-[#34B27B]" />
									<span className="text-xs font-medium">{t("layout.title")}</span>
								</div>
							</AccordionTrigger>
							<AccordionContent className="pb-3">
								<div className="p-2 rounded-lg bg-white/5 border border-white/5">
									<div className="text-[10px] font-medium text-slate-300 mb-1.5">
										{t("layout.preset")}
									</div>
									<Select
										value={webcamLayoutPreset}
										onValueChange={(value: WebcamLayoutPreset) =>
											onWebcamLayoutPresetChange?.(value)
										}
									>
										<SelectTrigger className="h-8 bg-black/20 border-white/10 text-xs">
											<SelectValue placeholder={t("layout.selectPreset")} />
										</SelectTrigger>
										<SelectContent>
											{WEBCAM_LAYOUT_PRESETS.filter(
												(preset) =>
													preset.value === "picture-in-picture" ||
													isPortraitAspectRatio(aspectRatio),
											).map((preset) => (
												<SelectItem key={preset.value} value={preset.value} className="text-xs">
													{preset.value === "picture-in-picture"
														? t("layout.pictureInPicture")
														: t("layout.verticalStack")}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{webcamLayoutPreset === "picture-in-picture" && (
									<div className="mt-2 p-2 rounded-lg bg-white/5 border border-white/5">
										<div className="text-[10px] font-medium text-slate-300 mb-1.5">
											{t("layout.webcamShape")}
										</div>
										<div className="grid grid-cols-4 gap-1.5">
											{(
												[
													{ value: "rectangle", label: "Rect" },
													{ value: "circle", label: "Circle" },
													{ value: "square", label: "Square" },
													{ value: "rounded", label: "Rounded" },
												] as Array<{ value: WebcamMaskShape; label: string }>
											).map((shape) => (
												<button
													key={shape.value}
													type="button"
													onClick={() => onWebcamMaskShapeChange?.(shape.value)}
													className={cn(
														"h-10 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-all",
														webcamMaskShape === shape.value
															? "bg-[#34B27B] border-[#34B27B] text-white"
															: "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-400",
													)}
												>
													<svg
														width="16"
														height="16"
														viewBox="0 0 16 16"
														fill="none"
														xmlns="http://www.w3.org/2000/svg"
													>
														{shape.value === "rectangle" && (
															<rect
																x="1"
																y="3"
																width="14"
																height="10"
																rx="2"
																stroke="currentColor"
																strokeWidth="1.5"
															/>
														)}
														{shape.value === "circle" && (
															<circle
																cx="8"
																cy="8"
																r="6.5"
																stroke="currentColor"
																strokeWidth="1.5"
															/>
														)}
														{shape.value === "square" && (
															<rect
																x="2"
																y="2"
																width="12"
																height="12"
																rx="1"
																stroke="currentColor"
																strokeWidth="1.5"
															/>
														)}
														{shape.value === "rounded" && (
															<rect
																x="1"
																y="3"
																width="14"
																height="10"
																rx="5"
																stroke="currentColor"
																strokeWidth="1.5"
															/>
														)}
													</svg>
													<span className="text-[8px] leading-none">{shape.label}</span>
												</button>
											))}
										</div>
									</div>
								)}
								{webcamLayoutPreset === "picture-in-picture" && (
									<div className="p-2 rounded-lg bg-white/5 border border-white/5 mt-2">
										<div className="flex items-center justify-between mb-1.5">
											<div className="text-[10px] font-medium text-slate-300">
												{t("layout.webcamSize")}
											</div>
											<div className="text-[10px] font-medium text-slate-400">
												{webcamSizePreset}%
											</div>
										</div>
										<Slider
											value={[webcamSizePreset]}
											onValueChange={(values) => onWebcamSizePresetChange?.(values[0])}
											onValueCommit={() => onWebcamSizePresetCommit?.()}
											min={10}
											max={50}
											step={1}
											className="w-full"
										/>
									</div>
								)}
							</AccordionContent>
						</AccordionItem>
					)}

					<EffectsSection
						showBlur={showBlur}
						onBlurChange={onBlurChange}
						motionBlurAmount={motionBlurAmount}
						onMotionBlurChange={onMotionBlurChange}
						onMotionBlurCommit={onMotionBlurCommit}
						shadowIntensity={shadowIntensity}
						onShadowChange={onShadowChange}
						onShadowCommit={onShadowCommit}
						borderRadius={borderRadius}
						onBorderRadiusChange={onBorderRadiusChange}
						onBorderRadiusCommit={onBorderRadiusCommit}
						padding={padding}
						onPaddingChange={onPaddingChange}
						onPaddingCommit={onPaddingCommit}
						webcamLayoutPreset={webcamLayoutPreset}
						onCropToggle={handleCropToggle}
					/>

					<BackgroundSection selected={selected} onWallpaperChange={onWallpaperChange} />
				</Accordion>
			</div>

			{showCropModal && cropRegion && onCropChange && (
				<>
					<div
						className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
						onClick={handleCropCancel}
					/>
					<div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 p-8 w-[90vw] max-w-5xl max-h-[90vh] overflow-auto animate-in zoom-in-95 duration-200">
						<div className="flex items-center justify-between mb-6">
							<div>
								<span className="text-xl font-bold text-slate-200">{t("crop.cropVideo")}</span>
								<p className="text-sm text-slate-400 mt-2">{t("crop.dragInstruction")}</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCropCancel}
								className="hover:bg-white/10 text-slate-400 hover:text-white"
							>
								<X className="w-5 h-5" />
							</Button>
						</div>
						<CropControl
							videoElement={videoElement || null}
							cropRegion={cropRegion}
							onCropChange={onCropChange}
							aspectRatio={aspectRatio}
						/>
						<div className="mt-6 space-y-4">
							<div className="flex flex-wrap items-end gap-3">
								{[
									{ label: "X", field: "x" as const, max: videoWidth },
									{ label: "Y", field: "y" as const, max: videoHeight },
									{ label: "W", field: "width" as const, max: videoWidth },
									{ label: "H", field: "height" as const, max: videoHeight },
								].map(({ label, field, max }) => (
									<div key={field} className="flex flex-col gap-1">
										<label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
											{label}
										</label>
										<input
											type="number"
											min={0}
											max={max}
											value={getCropPixelValue(field)}
											onChange={(e) => handleCropNumericChange(field, Number(e.target.value))}
											className="w-[90px] h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/50 focus:ring-1 focus:ring-[#34B27B]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
										/>
									</div>
								))}

								<div className="flex flex-col gap-1">
									<label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
										{t("crop.ratio")}
									</label>
									<div className="flex items-center gap-1.5">
										<select
											value={cropAspectRatio}
											onChange={(e) => applyCropAspectPreset(e.target.value)}
											className="h-8 rounded-md border border-white/10 bg-[#1a1a1f] px-2 text-xs text-slate-200 outline-none focus:border-[#34B27B]/50 cursor-pointer"
										>
											<option value="" className="bg-[#1a1a1f] text-slate-200">
												{t("crop.free")}
											</option>
											<option value="16:9" className="bg-[#1a1a1f] text-slate-200">
												16:9
											</option>
											<option value="9:16" className="bg-[#1a1a1f] text-slate-200">
												9:16
											</option>
											<option value="4:3" className="bg-[#1a1a1f] text-slate-200">
												4:3
											</option>
											<option value="3:4" className="bg-[#1a1a1f] text-slate-200">
												3:4
											</option>
											<option value="1:1" className="bg-[#1a1a1f] text-slate-200">
												1:1
											</option>
											<option value="21:9" className="bg-[#1a1a1f] text-slate-200">
												21:9
											</option>
										</select>
										<button
											type="button"
											onClick={() => setCropAspectLocked((prev) => !prev)}
											className={cn(
												"h-8 w-8 flex items-center justify-center rounded-md border transition-all",
												cropAspectLocked
													? "border-[#34B27B]/50 bg-[#34B27B]/10 text-[#34B27B]"
													: "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200",
											)}
											title={
												cropAspectLocked ? t("crop.unlockAspectRatio") : t("crop.lockAspectRatio")
											}
										>
											{cropAspectLocked ? (
												<Lock className="w-3.5 h-3.5" />
											) : (
												<Unlock className="w-3.5 h-3.5" />
											)}
										</button>
									</div>
								</div>

								<p className="text-[10px] text-slate-500 self-center ml-2">
									{videoWidth} × {videoHeight}px
								</p>
							</div>

							<div className="flex justify-end">
								<Button
									onClick={() => setShowCropModal(false)}
									size="lg"
									className="bg-[#34B27B] hover:bg-[#34B27B]/90 text-white"
								>
									{t("crop.done")}
								</Button>
							</div>
						</div>
					</div>
				</>
			)}

			<div className="flex-shrink-0 p-4 pt-3 border-t border-white/5 bg-[#09090b]">
				<div className="flex items-center gap-2 mb-3">
					<button
						onClick={() => onExportFormatChange?.("mp4")}
						className={cn(
							"flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all text-xs font-medium",
							exportFormat === "mp4"
								? "bg-[#34B27B]/10 border-[#34B27B]/50 text-white"
								: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200",
						)}
					>
						<Film className="w-3.5 h-3.5" />
						{t("exportFormat.mp4")}
					</button>
					<button
						data-testid={getTestId("gif-format-button")}
						onClick={() => onExportFormatChange?.("gif")}
						className={cn(
							"flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all text-xs font-medium",
							exportFormat === "gif"
								? "bg-[#34B27B]/10 border-[#34B27B]/50 text-white"
								: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200",
						)}
					>
						<Image className="w-3.5 h-3.5" />
						{t("exportFormat.gif")}
					</button>
				</div>

				{exportFormat === "mp4" && (
					<div className="mb-3 bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
						<button
							onClick={() => onExportQualityChange?.("medium")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "medium"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{t("exportQuality.low")}
						</button>
						<button
							onClick={() => onExportQualityChange?.("good")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "good"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{t("exportQuality.medium")}
						</button>
						<button
							onClick={() => onExportQualityChange?.("source")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "source"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{t("exportQuality.high")}
						</button>
					</div>
				)}

				{exportFormat === "gif" && (
					<div className="mb-3 space-y-2">
						<div className="flex items-center gap-2">
							<div className="flex-1 bg-white/5 border border-white/5 p-0.5 grid grid-cols-4 h-7 rounded-lg">
								{GIF_FRAME_RATES.map((rate) => (
									<button
										key={rate.value}
										onClick={() => onGifFrameRateChange?.(rate.value)}
										className={cn(
											"rounded-md transition-all text-[10px] font-medium",
											gifFrameRate === rate.value
												? "bg-white text-black"
												: "text-slate-400 hover:text-slate-200",
										)}
									>
										{rate.value}
									</button>
								))}
							</div>
							<div className="flex-1 bg-white/5 border border-white/5 p-0.5 grid grid-cols-3 h-7 rounded-lg">
								{Object.entries(GIF_SIZE_PRESETS).map(([key, _preset]) => (
									<button
										key={key}
										data-testid={getTestId(`gif-size-button-${key}`)}
										onClick={() => onGifSizePresetChange?.(key as GifSizePreset)}
										className={cn(
											"rounded-md transition-all text-[10px] font-medium",
											gifSizePreset === key
												? "bg-white text-black"
												: "text-slate-400 hover:text-slate-200",
										)}
									>
										{key === "original" ? "Orig" : key.charAt(0).toUpperCase() + key.slice(1, 3)}
									</button>
								))}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-[10px] text-slate-500">
								{gifOutputDimensions.width} × {gifOutputDimensions.height}px
							</span>
							<div className="flex items-center gap-2">
								<span className="text-[10px] text-slate-400">{t("gifSettings.loop")}</span>
								<Switch
									checked={gifLoop}
									onCheckedChange={onGifLoopChange}
									className="data-[state=checked]:bg-[#34B27B] scale-75"
								/>
							</div>
						</div>
					</div>
				)}

				{unsavedExport && (
					<Button
						type="button"
						size="lg"
						onClick={onSaveUnsavedExport}
						className="w-full mb-2 py-5 text-sm font-semibold flex items-center justify-center gap-2 bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 hover:bg-indigo-500/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
					>
						<Download className="w-4 h-4" />
						{t("export.chooseSaveLocation")}
					</Button>
				)}
				<Button
					data-testid={getTestId("export-button")}
					type="button"
					size="lg"
					onClick={onExport}
					className="w-full py-5 text-sm font-semibold flex items-center justify-center gap-2 bg-[#34B27B] text-white rounded-xl shadow-lg shadow-[#34B27B]/20 hover:bg-[#34B27B]/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
				>
					<Download className="w-4 h-4" />
					{exportFormat === "gif" ? t("export.gifButton") : t("export.videoButton")}
				</Button>

				<div className="flex gap-2 mt-3">
					<button
						type="button"
						onClick={() => {
							getAPI()?.openExternalUrl(
								"https://github.com/siddharthvaddem/openscreen/issues/new/choose",
							);
						}}
						className="flex-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 py-1.5 transition-colors"
					>
						<Bug className="w-3 h-3 text-[#34B27B]" />
						{t("links.reportBug")}
					</button>
					<button
						type="button"
						onClick={() => {
							getAPI()?.openExternalUrl("https://github.com/siddharthvaddem/openscreen");
						}}
						className="flex-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 py-1.5 transition-colors"
					>
						<Star className="w-3 h-3 text-yellow-400" />
						{t("links.starOnGithub")}
					</button>
				</div>
			</div>
		</div>
	);
}
