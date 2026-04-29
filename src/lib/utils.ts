import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export interface ParsedDecimal {
	raw: string;
	value: number | null;
}

export function parseDecimalInput(input: string): ParsedDecimal {
	const raw = input.replace(",", ".").replace(/[^\d.]/g, "");
	if ((raw.match(/\./g) || []).length > 1) {
		return { raw: input, value: null };
	}
	if (raw === "" || raw === ".") {
		return { raw, value: null };
	}
	const value = Number.parseFloat(raw);
	if (Number.isNaN(value)) {
		return { raw, value: null };
	}
	return { raw, value };
}
