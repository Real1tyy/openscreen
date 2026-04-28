import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { cn } from "@/lib/utils";
import { FormatSelector } from "./FormatSelector";
import { GifOptionsPanel } from "./GifOptionsPanel";

interface ExportSettingsDialogProps {
	isOpen: boolean;
	onClose: () => void;
	exportFormat: ExportFormat;
	onExportFormatChange: (format: ExportFormat) => void;
	exportQuality: ExportQuality;
	onExportQualityChange: (quality: ExportQuality) => void;
	gifFrameRate: GifFrameRate;
	onGifFrameRateChange: (rate: GifFrameRate) => void;
	gifLoop: boolean;
	onGifLoopChange: (loop: boolean) => void;
	gifSizePreset: GifSizePreset;
	onGifSizePresetChange: (preset: GifSizePreset) => void;
	gifOutputDimensions: { width: number; height: number };
	onExport: () => void;
	unsavedExport?: {
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null;
	onSaveUnsavedExport?: () => void;
}

export function ExportSettingsDialog({
	isOpen,
	onClose,
	exportFormat,
	onExportFormatChange,
	exportQuality,
	onExportQualityChange,
	gifFrameRate,
	onGifFrameRateChange,
	gifLoop,
	onGifLoopChange,
	gifSizePreset,
	onGifSizePresetChange,
	gifOutputDimensions,
	onExport,
	unsavedExport,
	onSaveUnsavedExport,
}: ExportSettingsDialogProps) {
	const t = useScopedT("settings");

	if (!isOpen) return null;

	const handleExport = () => {
		onClose();
		onExport();
	};

	return (
		<>
			<div
				className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
				onClick={onClose}
			/>
			<div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 p-6 w-[90vw] max-w-lg animate-in zoom-in-95 duration-200">
				<div className="flex items-center justify-between mb-5">
					<span className="text-lg font-bold text-slate-200">Export</span>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						className="hover:bg-white/10 text-slate-400 hover:text-white rounded-full"
					>
						<X className="w-5 h-5" />
					</Button>
				</div>

				<FormatSelector selectedFormat={exportFormat} onFormatChange={onExportFormatChange} />

				{exportFormat === "mp4" && (
					<div className="mt-5">
						<label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
							{t("exportQuality.title")}
						</label>
						<div className="bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-9 rounded-lg">
							{(["medium", "good", "source"] as const).map((q) => (
								<button
									key={q}
									type="button"
									onClick={() => onExportQualityChange(q)}
									className={cn(
										"rounded-md transition-all text-xs font-medium",
										exportQuality === q
											? "bg-white text-black"
											: "text-slate-400 hover:text-slate-200",
									)}
								>
									{t(`exportQuality.${q === "medium" ? "low" : q === "good" ? "medium" : "high"}`)}
								</button>
							))}
						</div>
					</div>
				)}

				{exportFormat === "gif" && (
					<div className="mt-5">
						<GifOptionsPanel
							frameRate={gifFrameRate}
							onFrameRateChange={onGifFrameRateChange}
							loop={gifLoop}
							onLoopChange={onGifLoopChange}
							sizePreset={gifSizePreset}
							onSizePresetChange={onGifSizePresetChange}
							outputDimensions={gifOutputDimensions}
						/>
					</div>
				)}

				<div className="mt-6 flex flex-col gap-2">
					{unsavedExport && onSaveUnsavedExport && (
						<Button
							type="button"
							size="lg"
							onClick={onSaveUnsavedExport}
							className="w-full py-5 text-sm font-semibold flex items-center justify-center gap-2 bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 hover:bg-indigo-500/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
						>
							<Download className="w-4 h-4" />
							{t("export.chooseSaveLocation")}
						</Button>
					)}
					<Button
						type="button"
						size="lg"
						onClick={handleExport}
						className="w-full py-5 text-sm font-semibold flex items-center justify-center gap-2 bg-[#34B27B] text-white rounded-xl shadow-lg shadow-[#34B27B]/20 hover:bg-[#34B27B]/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
					>
						<Download className="w-4 h-4" />
						{exportFormat === "gif" ? t("export.gifButton") : t("export.videoButton")}
					</Button>
				</div>
			</div>
		</>
	);
}
