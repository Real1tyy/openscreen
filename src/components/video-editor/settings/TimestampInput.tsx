import { useCallback, useRef, useState } from "react";

function formatMsForInput(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
	}
	return seconds.toFixed(1);
}

function parseMsFromInput(input: string): number | null {
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

	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-[10px] text-slate-500 whitespace-nowrap">{label}</span>
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
		</div>
	);
}
