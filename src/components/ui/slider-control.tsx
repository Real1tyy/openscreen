import { Slider } from "@/components/ui/slider";

export interface SliderControlProps {
	label: string;
	value: number;
	display: string;
	onChange?: (v: number) => void;
	onCommit?: () => void;
	min: number;
	max: number;
	step: number;
}

export function SliderControl({
	label,
	value,
	display,
	onChange,
	onCommit,
	min,
	max,
	step,
}: SliderControlProps) {
	return (
		<div className="p-2 rounded-lg bg-white/5 border border-white/5">
			<div className="flex items-center justify-between mb-1">
				<div className="text-[10px] font-medium text-slate-300">{label}</div>
				<span className="text-[10px] text-slate-500 font-mono">{display}</span>
			</div>
			<Slider
				value={[value]}
				onValueChange={(values) => onChange?.(values[0])}
				onValueCommit={() => onCommit?.()}
				min={min} max={max} step={step}
				className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
			/>
		</div>
	);
}
