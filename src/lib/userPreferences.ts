import type { ExportFormat, ExportQuality } from "@/lib/exporter";
import type { AspectRatio } from "@/utils/aspectRatioUtils";

const PREFS_KEY = "openscreen_user_preferences";

const VALID_ASPECT_RATIOS: readonly string[] = [
	"16:9",
	"9:16",
	"1:1",
	"4:3",
	"4:5",
	"16:10",
	"10:16",
	"native",
];

export interface UserPreferences {
	padding: number;
	aspectRatio: AspectRatio;
	exportQuality: ExportQuality;
	exportFormat: ExportFormat;
	seekSmallSeconds: number;
	seekLargeSeconds: number;
	defaultZoomDurationMs: number;
	defaultTrimDurationMs: number;
	defaultSpeedDurationMs: number;
}

const DEFAULT_PREFS: UserPreferences = {
	padding: 50,
	aspectRatio: "16:9",
	exportQuality: "good",
	exportFormat: "mp4",
	seekSmallSeconds: 10,
	seekLargeSeconds: 60,
	defaultZoomDurationMs: 5000,
	defaultTrimDurationMs: 5000,
	defaultSpeedDurationMs: 5000,
};

function safeJsonParse(text: string | null): Record<string, unknown> | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Load persisted user preferences from localStorage.
 * Returns defaults for any missing or invalid fields.
 */
export function loadUserPreferences(): UserPreferences {
	let raw: Record<string, unknown> | null = null;
	try {
		raw = safeJsonParse(localStorage.getItem(PREFS_KEY));
	} catch {
		return { ...DEFAULT_PREFS };
	}
	if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };

	const finitePositive = (v: unknown, fallback: number, min = 0.1) =>
		typeof v === "number" && Number.isFinite(v) && v >= min ? v : fallback;

	return {
		padding:
			typeof raw.padding === "number" &&
			Number.isFinite(raw.padding) &&
			raw.padding >= 0 &&
			raw.padding <= 100
				? raw.padding
				: DEFAULT_PREFS.padding,
		aspectRatio:
			typeof raw.aspectRatio === "string" && VALID_ASPECT_RATIOS.includes(raw.aspectRatio)
				? (raw.aspectRatio as AspectRatio)
				: DEFAULT_PREFS.aspectRatio,
		exportQuality:
			raw.exportQuality === "medium" ||
			raw.exportQuality === "good" ||
			raw.exportQuality === "source"
				? (raw.exportQuality as ExportQuality)
				: DEFAULT_PREFS.exportQuality,
		exportFormat:
			raw.exportFormat === "gif" || raw.exportFormat === "mp4"
				? (raw.exportFormat as ExportFormat)
				: DEFAULT_PREFS.exportFormat,
		seekSmallSeconds: finitePositive(raw.seekSmallSeconds, DEFAULT_PREFS.seekSmallSeconds, 1),
		seekLargeSeconds: finitePositive(raw.seekLargeSeconds, DEFAULT_PREFS.seekLargeSeconds, 1),
		defaultZoomDurationMs: finitePositive(raw.defaultZoomDurationMs, DEFAULT_PREFS.defaultZoomDurationMs, 500),
		defaultTrimDurationMs: finitePositive(raw.defaultTrimDurationMs, DEFAULT_PREFS.defaultTrimDurationMs, 500),
		defaultSpeedDurationMs: finitePositive(raw.defaultSpeedDurationMs, DEFAULT_PREFS.defaultSpeedDurationMs, 500),
	};
}

/**
 * Persist user preferences to localStorage.
 * Only the explicitly provided fields are updated.
 */
export function saveUserPreferences(partial: Partial<UserPreferences>): void {
	const current = loadUserPreferences();
	const merged = { ...current, ...partial };
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
	} catch {
		// localStorage may be unavailable (e.g. private browsing quota exceeded)
	}
}
