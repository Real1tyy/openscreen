import { Keyboard, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { type Locale, SUPPORTED_LOCALES } from "@/i18n/config";
import { getLocaleName } from "@/i18n/loader";
import type { UserPreferences } from "@/lib/userPreferences";
import { parseDecimalInput } from "@/lib/utils";
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
			const { value: num } = parseDecimalInput(raw);
			if (num === null) {
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
	const { locale, setLocale } = useI18n();
	const { openConfig } = useShortcuts();

	const set = useCallback(
		(key: keyof UserPreferences, value: number) => {
			update({ [key]: value });
		},
		[update],
	);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				aria-describedby={undefined}
				className="bg-[#141414] border-white/10 text-white max-w-md"
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-slate-100">
						<Settings className="w-4 h-4" />
						Preferences
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-5 mt-2 max-h-[60vh] overflow-y-auto pr-1">
					<Section title="Language">
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Display language</span>
							<select
								value={locale}
								onChange={(e) => setLocale(e.target.value as Locale)}
								className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[13px] text-slate-200 outline-none focus:ring-1 focus:ring-[#34B27B]/50 cursor-pointer"
							>
								{SUPPORTED_LOCALES.map((loc) => (
									<option key={loc} value={loc} className="bg-[#141414] text-white">
										{getLocaleName(loc)}
									</option>
								))}
							</select>
						</div>
					</Section>

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
						<NumberField
							label="Annotation"
							value={prefs.defaultAnnotationDurationMs / 1000}
							onChange={(v) => set("defaultAnnotationDurationMs", v * 1000)}
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
							label="Loop before trim"
							value={prefs.trimLoopBeforeMs / 1000}
							onChange={(v) => set("trimLoopBeforeMs", v * 1000)}
							suffix="sec"
							min={0}
							max={30}
							step={0.1}
						/>
						<NumberField
							label="Loop after trim"
							value={prefs.trimLoopAfterMs / 1000}
							onChange={(v) => set("trimLoopAfterMs", v * 1000)}
							suffix="sec"
							min={0}
							max={30}
							step={0.1}
						/>
					</Section>

					<Section title="Annotation defaults">
						<NumberField
							label="Width"
							value={prefs.defaultAnnotationWidth}
							onChange={(v) => update({ defaultAnnotationWidth: v })}
							suffix="%"
							min={5}
							max={100}
						/>
						<NumberField
							label="Height"
							value={prefs.defaultAnnotationHeight}
							onChange={(v) => update({ defaultAnnotationHeight: v })}
							suffix="%"
							min={5}
							max={100}
						/>
						<NumberField
							label="Font size"
							value={prefs.defaultAnnotationFontSize}
							onChange={(v) => update({ defaultAnnotationFontSize: v })}
							suffix="px"
							min={8}
							max={200}
						/>
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Text color</span>
							<input
								type="color"
								value={prefs.defaultAnnotationColor}
								onChange={(e) => update({ defaultAnnotationColor: e.target.value })}
								className="w-8 h-6 rounded border border-white/10 bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none"
							/>
						</div>
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Background</span>
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									onClick={() => update({ defaultAnnotationBgColor: "transparent" })}
									className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${prefs.defaultAnnotationBgColor === "transparent" ? "border-[#34B27B]/50 bg-[#34B27B]/10 text-[#34B27B]" : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"}`}
								>
									None
								</button>
								<input
									type="color"
									value={
										prefs.defaultAnnotationBgColor === "transparent"
											? "#000000"
											: prefs.defaultAnnotationBgColor
									}
									onChange={(e) => update({ defaultAnnotationBgColor: e.target.value })}
									className="w-8 h-6 rounded border border-white/10 bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none"
								/>
							</div>
						</div>
					</Section>

					<Section title="Annotation presets">
						{prefs.annotationPresets.length === 0 && (
							<p className="text-[12px] text-slate-500">
								No presets saved yet. Configure an annotation, then save it as a preset from the
								annotation settings panel.
							</p>
						)}
						{prefs.annotationPresets.map((preset, i) => (
							<div key={preset.name} className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 min-w-0">
									<div
										className="w-4 h-4 rounded border border-white/10 flex-shrink-0"
										style={{
											backgroundColor:
												preset.backgroundColor === "transparent"
													? undefined
													: preset.backgroundColor,
											color: preset.color,
										}}
									/>
									<span className="text-[12px] text-slate-300 truncate">{preset.name}</span>
								</div>
								<button
									type="button"
									onClick={() => {
										const next = prefs.annotationPresets.filter((_, idx) => idx !== i);
										update({ annotationPresets: next });
									}}
									className="text-[10px] text-red-400 hover:text-red-300 shrink-0"
								>
									Remove
								</button>
							</div>
						))}
					</Section>

					<Section title="Interface">
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Show trimming tutorial</span>
							<Switch
								checked={prefs.showTrimHelp}
								onCheckedChange={(v) => update({ showTrimHelp: v })}
								className="data-[state=checked]:bg-[#34B27B] scale-75"
							/>
						</div>
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Show scroll/pan help</span>
							<Switch
								checked={prefs.showScrollHelp}
								onCheckedChange={(v) => update({ showScrollHelp: v })}
								className="data-[state=checked]:bg-[#34B27B] scale-75"
							/>
						</div>
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Show sidebar footer links</span>
							<Switch
								checked={prefs.showSidebarFooter}
								onCheckedChange={(v) => update({ showSidebarFooter: v })}
								className="data-[state=checked]:bg-[#34B27B] scale-75"
							/>
						</div>
						<div className="flex items-center justify-between gap-4">
							<span className="text-[13px] text-slate-300 shrink-0">Keyboard shortcuts</span>
							<button
								type="button"
								onClick={() => {
									onClose();
									openConfig();
								}}
								className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[12px] text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
							>
								<Keyboard className="w-3.5 h-3.5" />
								Customize
							</button>
						</div>
					</Section>
				</div>
			</DialogContent>
		</Dialog>
	);
}
