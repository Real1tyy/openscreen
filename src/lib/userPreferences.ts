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
	trimLoopPaddingMs: z.number().min(0).catch(3000).default(3000),
	trimLoopBeforeMs: z.number().min(0).catch(500).default(500),
	trimLoopAfterMs: z.number().min(0).catch(3000).default(3000),
	defaultAnnotationDurationMs: z.number().min(500).catch(5000).default(5000),
	defaultAnnotationWidth: z.number().min(5).max(100).catch(30).default(30),
	defaultAnnotationHeight: z.number().min(5).max(100).catch(20).default(20),
	defaultAnnotationFontSize: z.number().min(8).max(200).catch(32).default(32),
	defaultAnnotationColor: z.string().catch("#ffffff").default("#ffffff"),
	defaultAnnotationBgColor: z.string().catch("transparent").default("transparent"),
	annotationPresets: z
		.array(
			z.object({
				name: z.string(),
				width: z.number(),
				height: z.number(),
				fontSize: z.number(),
				color: z.string(),
				backgroundColor: z.string(),
				fontWeight: z.enum(["normal", "bold"]).catch("bold"),
				fontStyle: z.enum(["normal", "italic"]).catch("normal"),
				textAlign: z.enum(["left", "center", "right"]).catch("center"),
			}),
		)
		.catch([])
		.default([]),
	showTrimHelp: z.boolean().catch(true).default(true),
	showScrollHelp: z.boolean().catch(true).default(true),
	sidebarWidth: z.number().min(200).max(500).catch(350).default(350),
	followPlayhead: z.boolean().catch(false).default(false),
	showSidebarFooter: z.boolean().catch(true).default(true),
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
