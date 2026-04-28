import { Bug, Lock, Star, Trash2, Unlock, Video, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { getAPI } from "@/lib/tauriBridge";
import { cn } from "@/lib/utils";
import { useEditorPreferencesStore } from "@/stores/useEditorPreferencesStore";
import { useEditorSelectionStore } from "@/stores/useEditorSelectionStore";
import { useEditorStore } from "@/stores/useEditorStore";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { CropControl } from "./CropControl";
import { BackgroundSection } from "./settings/BackgroundSection";
import { EffectsSection } from "./settings/EffectsSection";
import { RegionSection } from "./settings/RegionSection";
import { SpeedSection } from "./settings/SpeedSection";
import { WebcamSection } from "./settings/WebcamSection";
import { ZoomSection } from "./settings/ZoomSection";
import type { CropRegion } from "./types";

interface SettingsPanelProps {
	videoElement?: HTMLVideoElement | null;
	hasCursorTelemetry?: boolean;
	videoDuration?: number;
	currentTimeMs?: number;
	hasWebcam?: boolean;
	onNewRecording?: () => void;
}

export function SettingsPanel({
	videoElement,
	hasCursorTelemetry = false,
	videoDuration = 0,
	currentTimeMs,
	hasWebcam = false,
	onNewRecording,
}: SettingsPanelProps) {
	const t = useScopedT("settings");

	// Read from stores
	const cropRegion = useEditorStore((s) => s.cropRegion);
	const setCropRegion = useEditorStore((s) => s.setCropRegion);
	const aspectRatio = useEditorStore((s) => s.aspectRatio);
	const trimRegions = useEditorStore((s) => s.trimRegions);
	const deleteTrim = useEditorStore((s) => s.deleteTrim);
	const setTrimSpan = useEditorStore((s) => s.setTrimSpan);

	const showSidebarFooter = useEditorPreferencesStore((s) => s.showSidebarFooter);

	const selectedZoomId = useEditorSelectionStore((s) => s.selectedZoomId);
	const selectedTrimId = useEditorSelectionStore((s) => s.selectedTrimId);
	const selectedSpeedId = useEditorSelectionStore((s) => s.selectedSpeedId);
	const selectedAnnotationId = useEditorSelectionStore((s) => s.selectedAnnotationId);

	const [showCropModal, setShowCropModal] = useState(false);
	const cropSnapshotRef = useRef<CropRegion | null>(null);
	const [cropAspectLocked, setCropAspectLocked] = useState(false);
	const [cropAspectRatio, setCropAspectRatio] = useState("");

	const selectedTrimRegion = selectedTrimId
		? (trimRegions.find((r) => r.id === selectedTrimId) ?? null)
		: null;
	const durationMs = videoDuration * 1000;

	const videoWidth = videoElement?.videoWidth || 1920;
	const videoHeight = videoElement?.videoHeight || 1080;

	const handleCropNumericChange = useCallback(
		(field: "x" | "y" | "width" | "height", pixelValue: number) => {
			if (!cropRegion) return;

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

			setCropRegion(next);
		},
		[cropRegion, setCropRegion, videoWidth, videoHeight, cropAspectLocked],
	);

	const applyCropAspectPreset = useCallback(
		(preset: string) => {
			if (!cropRegion) return;

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

			setCropRegion(next);
			setCropAspectLocked(true);
		},
		[cropRegion, setCropRegion, videoWidth, videoHeight],
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

	const handleCropToggle = () => {
		if (!showCropModal && cropRegion) {
			cropSnapshotRef.current = { ...cropRegion };
		}
		setShowCropModal(!showCropModal);
	};

	const handleCropCancel = () => {
		if (cropSnapshotRef.current) {
			setCropRegion(cropSnapshotRef.current);
		}
		setShowCropModal(false);
	};

	// If an annotation is selected, show annotation settings instead
	if (selectedAnnotationId) {
		return <AnnotationSettingsPanel />;
	}

	return (
		<div className="flex-[2] min-w-0 bg-[#09090b] border-l border-white/5 flex flex-col h-full overflow-hidden">
			<div className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-0">
				{selectedZoomId && (
					<ZoomSection
						hasCursorTelemetry={hasCursorTelemetry}
						videoDuration={videoDuration}
						currentTimeMs={currentTimeMs}
					/>
				)}

				{selectedTrimId && (
					<div className="mb-4">
						<div className="flex items-center justify-between mb-3">
							<span className="text-sm font-medium text-slate-200">{t("trim.title")}</span>
							{selectedTrimRegion && (
								<span className="text-[10px] uppercase tracking-wider font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
									{t("region.active")}
								</span>
							)}
						</div>
						{selectedTrimRegion && (
							<div className="mb-2">
								<RegionSection
									region={selectedTrimRegion}
									videoDurationMs={durationMs}
									onSpanChange={setTrimSpan}
									currentTimeMs={currentTimeMs}
								/>
							</div>
						)}
						<Button
							onClick={() => selectedTrimId && deleteTrim(selectedTrimId)}
							variant="destructive"
							size="sm"
							className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
						>
							<Trash2 className="w-3 h-3" />
							{t("trim.deleteRegion")}
						</Button>
					</div>
				)}

				{selectedSpeedId && (
					<SpeedSection videoDuration={videoDuration} currentTimeMs={currentTimeMs} />
				)}

				<Accordion type="multiple" defaultValue={hasWebcam ? ["layout"] : []} className="space-y-1">
					{hasWebcam && <WebcamSection />}

					<EffectsSection onCropToggle={handleCropToggle} />

					<BackgroundSection />
				</Accordion>
			</div>

			{showCropModal && cropRegion && (
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
							onCropChange={setCropRegion}
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

			{showSidebarFooter && (
				<div className="flex-shrink-0 px-4 py-2 border-t border-white/5 bg-[#09090b]">
					<div className="flex gap-2">
						{onNewRecording && (
							<button
								type="button"
								onClick={onNewRecording}
								className="flex-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 py-1.5 transition-colors"
							>
								<Video className="w-3 h-3 text-[#34B27B]" />
								New Recording
							</button>
						)}
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
			)}
		</div>
	);
}
