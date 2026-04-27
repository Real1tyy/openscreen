import { Crop, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Slider } from "@/components/ui/slider";
import { SliderControl } from "@/components/ui/slider-control";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import {
	pauseEditorHistory,
	resumeEditorHistory,
	useEditorStore,
} from "@/stores/useEditorStore";

interface EffectsSectionProps {
	onCropToggle: () => void;
}

export function EffectsSection({
	onCropToggle,
}: EffectsSectionProps) {
	const t = useScopedT("settings");

	const showBlur = useEditorStore((s) => s.showBlur);
	const setShowBlur = useEditorStore((s) => s.setShowBlur);
	const motionBlurAmount = useEditorStore((s) => s.motionBlurAmount);
	const setMotionBlurAmount = useEditorStore((s) => s.setMotionBlurAmount);
	const shadowIntensity = useEditorStore((s) => s.shadowIntensity);
	const setShadowIntensity = useEditorStore((s) => s.setShadowIntensity);
	const borderRadius = useEditorStore((s) => s.borderRadius);
	const setBorderRadius = useEditorStore((s) => s.setBorderRadius);
	const padding = useEditorStore((s) => s.padding);
	const setPadding = useEditorStore((s) => s.setPadding);
	const webcamLayoutPreset = useEditorStore((s) => s.webcamLayoutPreset);

	const isVerticalStack = webcamLayoutPreset === "vertical-stack";

	const handleBlurChange = (v: boolean) => setShowBlur(v);
	const handleMotionBlurChange = (v: number) => { pauseEditorHistory(); setMotionBlurAmount(v); };
	const handleMotionBlurCommit = () => resumeEditorHistory();
	const handleShadowChange = (v: number) => { pauseEditorHistory(); setShadowIntensity(v); };
	const handleShadowCommit = () => resumeEditorHistory();
	const handleBorderRadiusChange = (v: number) => { pauseEditorHistory(); setBorderRadius(v); };
	const handleBorderRadiusCommit = () => resumeEditorHistory();
	const handlePaddingChange = (v: number) => { pauseEditorHistory(); setPadding(v); };
	const handlePaddingCommit = () => resumeEditorHistory();

	return (
		<AccordionItem value="effects" className="border-white/5 rounded-xl bg-white/[0.02] px-3">
			<AccordionTrigger className="py-2.5 hover:no-underline">
				<div className="flex items-center gap-2">
					<Sparkles className="w-4 h-4 text-[#34B27B]" />
					<span className="text-xs font-medium">{t("effects.title")}</span>
				</div>
			</AccordionTrigger>
			<AccordionContent className="pb-3">
				<div className="grid grid-cols-2 gap-2 mb-3">
					<div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5">
						<div className="text-[10px] font-medium text-slate-300">
							{t("effects.blurBg")}
						</div>
						<Switch
							checked={showBlur}
							onCheckedChange={handleBlurChange}
							className="data-[state=checked]:bg-[#34B27B] scale-90"
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2">
					<SliderControl
						label={t("effects.motionBlur")}
						value={motionBlurAmount}
						display={motionBlurAmount === 0 ? t("effects.off") : motionBlurAmount.toFixed(2)}
						onChange={handleMotionBlurChange}
						onCommit={handleMotionBlurCommit}
						min={0} max={1} step={0.01}
					/>
					<SliderControl
						label={t("effects.shadow")}
						value={shadowIntensity}
						display={`${Math.round(shadowIntensity * 100)}%`}
						onChange={handleShadowChange}
						onCommit={handleShadowCommit}
						min={0} max={1} step={0.01}
					/>
					<SliderControl
						label={t("effects.roundness")}
						value={borderRadius}
						display={`${borderRadius}px`}
						onChange={handleBorderRadiusChange}
						onCommit={handleBorderRadiusCommit}
						min={0} max={16} step={0.5}
					/>
					<div
						className={`p-2 rounded-lg bg-white/5 border border-white/5 ${isVerticalStack ? "opacity-40 pointer-events-none" : ""}`}
					>
						<div className="flex items-center justify-between mb-1">
							<div className="text-[10px] font-medium text-slate-300">
								{t("effects.padding")}
							</div>
							<span className="text-[10px] text-slate-500 font-mono">
								{isVerticalStack ? "—" : `${padding}%`}
							</span>
						</div>
						<Slider
							value={[isVerticalStack ? 0 : padding]}
							onValueChange={(values) => handlePaddingChange(values[0])}
							onValueCommit={() => handlePaddingCommit()}
							min={0} max={100} step={1}
							disabled={isVerticalStack}
							className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
						/>
					</div>
				</div>

				<Button
					onClick={onCropToggle}
					variant="outline"
					className="w-full mt-2 gap-1.5 bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white text-[10px] h-8 transition-all"
				>
					<Crop className="w-3 h-3" />
					{t("crop.cropVideo")}
				</Button>
			</AccordionContent>
		</AccordionItem>
	);
}
