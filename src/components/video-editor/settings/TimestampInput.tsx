import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";

export function formatMsForInput(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
	}
	return seconds.toFixed(1);
}

export function parseMsFromInput(input: string): number | null {
	const trimmed = input.trim().replace(/s$/i, "");
	if (!trimmed) return null;

	const colonParts = trimmed.split(":");
	if (colonParts.length === 2) {
		const mins = Number.parseFloat(colonParts[0]);
		const secs = Number.parseFloat(colonParts[1]);
		if (Number.isNaN(mins) || Number.isNaN(secs) || mins < 0 || secs < 0) return null;
		return Math.round((mins * 60 + secs) * 1000);
	}

	if (colonParts.length === 1) {
		const secs = Number.parseFloat(colonParts[0]);
		if (Number.isNaN(secs) || secs < 0) return null;
		return Math.round(secs * 1000);
	}

	return null;
}

const STEP_MS = 1000;

interface TimestampInputProps {
	label: string;
	valueMs: number;
	minMs?: number;
	maxMs?: number;
	onChange: (ms: number) => void;
	disabled?: boolean;
}

export function TimestampInput({
	label,
	valueMs,
	minMs = 0,
	maxMs = Infinity,
	onChange,
	disabled = false,
}: TimestampInputProps) {
	const [draft, setDraft] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const prevValue = useRef(valueMs);

	if (!isFocused && prevValue.current !== valueMs) {
		prevValue.current = valueMs;
	}

	const displayValue = isFocused ? draft : formatMsForInput(valueMs);

	const commit = useCallback(() => {
		const parsed = parseMsFromInput(draft);
		if (parsed !== null) {
			const clamped = Math.max(minMs, Math.min(maxMs, parsed));
			onChange(clamped);
		}
		setIsFocused(false);
	}, [draft, minMs, maxMs, onChange]);

	const handleFocus = useCallback(() => {
		setDraft(formatMsForInput(valueMs));
		setIsFocused(true);
	}, [valueMs]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				commit();
			} else if (e.key === "Escape") {
				setIsFocused(false);
			}
		},
		[commit],
	);

	const stepUp = useCallback(() => {
		const next = Math.min(maxMs, valueMs + STEP_MS);
		if (next !== valueMs) onChange(next);
	}, [valueMs, maxMs, onChange]);

	const stepDown = useCallback(() => {
		const next = Math.max(minMs, valueMs - STEP_MS);
		if (next !== valueMs) onChange(next);
	}, [valueMs, minMs, onChange]);

	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-[10px] text-slate-500 whitespace-nowrap">{label}</span>
			<div className="flex items-center gap-0.5">
				<input
					type="text"
					value={displayValue}
					disabled={disabled}
					onFocus={handleFocus}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={handleKeyDown}
					className="w-[72px] bg-white/5 border border-white/10 rounded-md px-2 py-0.5 text-[11px] font-mono text-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-[#34B27B]/50 focus:border-[#34B27B]/30 disabled:opacity-40 disabled:cursor-not-allowed"
				/>
				<div className="flex flex-col gap-0">
					<button
						type="button"
						disabled={disabled || valueMs >= maxMs}
						onClick={stepUp}
						className="h-[11px] w-[14px] flex items-center justify-center text-slate-500 hover:text-[#34B27B] disabled:opacity-30 disabled:pointer-events-none transition-colors"
					>
						<ChevronUp className="w-2.5 h-2.5" />
					</button>
					<button
						type="button"
						disabled={disabled || valueMs <= minMs}
						onClick={stepDown}
						className="h-[11px] w-[14px] flex items-center justify-center text-slate-500 hover:text-[#34B27B] disabled:opacity-30 disabled:pointer-events-none transition-colors"
					>
						<ChevronDown className="w-2.5 h-2.5" />
					</button>
				</div>
			</div>
		</div>
	);
}
