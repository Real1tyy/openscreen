import { Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UserPreferences } from "@/lib/userPreferences";
import { useEditorPreferencesStore } from "@/stores/useEditorPreferencesStore";

interface PreferencesDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

function NumberField({
	label,
	value,
	onChange,
	suffix,
	min = 0,
	max,
	step = 1,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	suffix?: string;
	min?: number;
	max?: number;
	step?: number;
}) {
	const [draft, setDraft] = useState(String(value));

	useEffect(() => {
		setDraft(String(value));
	}, [value]);

	const commit = useCallback(
		(raw: string) => {
			const num = Number.parseFloat(raw);
			if (Number.isNaN(num)) {
				setDraft(String(value));
				return;
			}
			const clamped = Math.max(min, max != null ? Math.min(max, num) : num);
			onChange(clamped);
			setDraft(String(clamped));
		},
		[value, onChange, min, max],
	);

	return (
		<div className="flex items-center justify-between gap-4">
			<span className="text-[13px] text-slate-300 shrink-0">{label}</span>
			<div className="flex items-center gap-1.5">
				<input
					type="number"
					value={draft}
					min={min}
					max={max}
					step={step}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={(e) => commit(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
					}}
					className="w-20 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[13px] text-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-[#34B27B]/50 focus:border-[#34B27B]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
				/>
				{suffix && <span className="text-[12px] text-slate-500">{suffix}</span>}
			</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2.5">
			<h3 className="text-[12px] uppercase tracking-wider font-semibold text-slate-400">{title}</h3>
			<div className="space-y-2 pl-1">{children}</div>
		</div>
	);
}

export function PreferencesDialog({ isOpen, onClose }: PreferencesDialogProps) {
	const prefs = useEditorPreferencesStore();
	const update = useEditorPreferencesStore((s) => s.update);

	const set = useCallback(
		(key: keyof UserPreferences, value: number) => {
			update({ [key]: value });
		},
		[update],
	);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="bg-[#141414] border-white/10 text-white max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-slate-100">
						<Settings className="w-4 h-4" />
						Preferences
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-5 mt-2 max-h-[60vh] overflow-y-auto pr-1">
					<Section title="Navigation">
						<NumberField
							label="Arrow key seek"
							value={prefs.seekSmallSeconds}
							onChange={(v) => set("seekSmallSeconds", v)}
							suffix="sec"
							min={1}
							max={300}
						/>
						<NumberField
							label="Shift + Arrow seek"
							value={prefs.seekLargeSeconds}
							onChange={(v) => set("seekLargeSeconds", v)}
							suffix="sec"
							min={1}
							max={600}
						/>
					</Section>

					<Section title="Default region durations">
						<NumberField
							label="Zoom"
							value={prefs.defaultZoomDurationMs / 1000}
							onChange={(v) => set("defaultZoomDurationMs", v * 1000)}
							suffix="sec"
							min={0.5}
							max={120}
							step={0.5}
						/>
						<NumberField
							label="Trim"
							value={prefs.defaultTrimDurationMs / 1000}
							onChange={(v) => set("defaultTrimDurationMs", v * 1000)}
							suffix="sec"
							min={0.5}
							max={120}
							step={0.5}
						/>
						<NumberField
							label="Speed"
							value={prefs.defaultSpeedDurationMs / 1000}
							onChange={(v) => set("defaultSpeedDurationMs", v * 1000)}
							suffix="sec"
							min={0.5}
							max={120}
							step={0.5}
						/>
					</Section>

					<Section title="Trim playback">
						<NumberField
							label="Play from start offset"
							value={prefs.trimPlayFromStartOffsetMs / 1000}
							onChange={(v) => set("trimPlayFromStartOffsetMs", v * 1000)}
							suffix="sec"
							min={0.5}
							max={30}
							step={0.5}
						/>
						<NumberField
							label="Loop padding"
							value={prefs.trimLoopPaddingMs / 1000}
							onChange={(v) => set("trimLoopPaddingMs", v * 1000)}
							suffix="sec"
							min={0.5}
							max={30}
							step={0.5}
						/>
					</Section>
				</div>
			</DialogContent>
		</Dialog>
	);
}
