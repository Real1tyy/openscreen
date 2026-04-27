import { z } from "zod";
import type { AspectRatio } from "@/utils/aspectRatioUtils";

const PREFS_KEY = "openscreen_user_preferences";

const VALID_ASPECT_RATIOS = [
	"16:9",
	"9:16",
	"1:1",
	"4:3",
	"4:5",
	"16:10",
	"10:16",
	"native",
] as const;

export const UserPreferencesSchema = z.object({
	padding: z.number().min(0).max(100).catch(50).default(50),
	aspectRatio: z
		.string()
		.refine((v): v is AspectRatio => (VALID_ASPECT_RATIOS as readonly string[]).includes(v))
		.catch("16:9" as AspectRatio)
		.default("16:9"),
	exportQuality: z.enum(["medium", "good", "source"]).catch("good").default("good"),
	exportFormat: z.enum(["mp4", "gif"]).catch("mp4").default("mp4"),
	seekSmallSeconds: z.number().min(1).catch(10).default(10),
	seekLargeSeconds: z.number().min(1).catch(60).default(60),
	defaultZoomDurationMs: z.number().min(500).catch(5000).default(5000),
	defaultTrimDurationMs: z.number().min(500).catch(5000).default(5000),
	defaultSpeedDurationMs: z.number().min(500).catch(5000).default(5000),
	trimPlayFromStartOffsetMs: z.number().min(500).catch(5000).default(5000),
	trimLoopPaddingMs: z.number().min(500).catch(3000).default(3000),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const DEFAULT_PREFS: UserPreferences = UserPreferencesSchema.parse({});

export function loadUserPreferences(): UserPreferences {
	try {
		const raw = localStorage.getItem(PREFS_KEY);
		if (!raw) return { ...DEFAULT_PREFS };
		return UserPreferencesSchema.parse(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

export function saveUserPreferences(partial: Partial<UserPreferences>): void {
	const current = loadUserPreferences();
	const merged = { ...current, ...partial };
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
	} catch {
		// localStorage may be unavailable
	}
}
