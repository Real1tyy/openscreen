import { Sparkles } from "lucide-react";
import {
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useScopedT } from "@/contexts/I18nContext";
import { WEBCAM_LAYOUT_PRESETS } from "@/lib/compositeLayout";
import { cn } from "@/lib/utils";
import {
	pauseEditorHistory,
	resumeEditorHistory,
	useEditorStore,
} from "@/stores/useEditorStore";
import { isPortraitAspectRatio } from "@/utils/aspectRatioUtils";
import type { WebcamLayoutPreset, WebcamMaskShape } from "../types";

const MASK_SHAPES: Array<{ value: WebcamMaskShape; label: string }> = [
	{ value: "rectangle", label: "Rect" },
	{ value: "circle", label: "Circle" },
	{ value: "square", label: "Square" },
	{ value: "rounded", label: "Rounded" },
];

const SHAPE_PATHS: Record<WebcamMaskShape, React.ReactNode> = {
	rectangle: <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />,
	circle: <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />,
	square: <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />,
	rounded: <rect x="1" y="3" width="14" height="10" rx="5" stroke="currentColor" strokeWidth="1.5" />,
};

export function WebcamSection() {
	const t = useScopedT("settings");

	const aspectRatio = useEditorStore((s) => s.aspectRatio);
	const webcamLayoutPreset = useEditorStore((s) => s.webcamLayoutPreset);
	const setWebcamLayoutPreset = useEditorStore((s) => s.setWebcamLayoutPreset);
	const setWebcamPosition = useEditorStore((s) => s.setWebcamPosition);
	const webcamMaskShape = useEditorStore((s) => s.webcamMaskShape);
	const setWebcamMaskShape = useEditorStore((s) => s.setWebcamMaskShape);
	const webcamSizePreset = useEditorStore((s) => s.webcamSizePreset);
	const setWebcamSizePreset = useEditorStore((s) => s.setWebcamSizePreset);

	const handleWebcamLayoutPresetChange = (preset: WebcamLayoutPreset) => {
		setWebcamLayoutPreset(preset);
		if (preset === "vertical-stack") setWebcamPosition(null);
	};

	const handleWebcamSizePresetChange = (v: number) => {
		pauseEditorHistory();
		setWebcamSizePreset(v);
	};

	const handleWebcamSizePresetCommit = () => resumeEditorHistory();

	return (
		<AccordionItem value="layout" className="border-white/5 rounded-xl bg-white/[0.02] px-3">
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
							handleWebcamLayoutPresetChange(value)
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
							{MASK_SHAPES.map((shape) => (
								<button
									key={shape.value}
									type="button"
									onClick={() => setWebcamMaskShape(shape.value)}
									className={cn(
										"h-10 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-all",
										webcamMaskShape === shape.value
											? "bg-[#34B27B] border-[#34B27B] text-white"
											: "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-400",
									)}
								>
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
										{SHAPE_PATHS[shape.value]}
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
							onValueChange={(values) => handleWebcamSizePresetChange(values[0])}
							onValueCommit={() => handleWebcamSizePresetCommit()}
							min={10}
							max={50}
							step={1}
							className="w-full"
						/>
					</div>
				)}
			</AccordionContent>
		</AccordionItem>
	);
}
