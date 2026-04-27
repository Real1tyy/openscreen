import type { Span } from "dnd-timeline";
import { z } from "zod";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import {
	type AnnotationRegion,
	type AnnotationType,
	type ChapterMarker,
	type CropRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_CROP_REGION,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_WEBCAM_LAYOUT_PRESET,
	DEFAULT_WEBCAM_MASK_SHAPE,
	DEFAULT_WEBCAM_POSITION,
	DEFAULT_WEBCAM_SIZE_PRESET,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	type PlaybackSpeed,
	type SpeedRegion,
	type TrimRegion,
	type WebcamLayoutPreset,
	type WebcamMaskShape,
	type WebcamPosition,
	type WebcamSizePreset,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
	clampFocusToDepth,
} from "@/components/video-editor/types";
import { useEditorSelectionStore } from "./useEditorSelectionStore";

// ── EditorState (Zod schema = single source of truth) ───────────────

export const EditorStateSchema = z.object({
	zoomRegions: z.custom<ZoomRegion[]>().default([]),
	trimRegions: z.custom<TrimRegion[]>().default([]),
	speedRegions: z.custom<SpeedRegion[]>().default([]),
	annotationRegions: z.custom<AnnotationRegion[]>().default([]),
	chapters: z.custom<ChapterMarker[]>().default([]),
	cropRegion: z.custom<CropRegion>().default(DEFAULT_CROP_REGION),
	wallpaper: z.string().default("/wallpapers/wallpaper1.jpg"),
	shadowIntensity: z.number().default(0),
	showBlur: z.boolean().default(false),
	motionBlurAmount: z.number().default(0),
	borderRadius: z.number().default(0),
	padding: z.number().default(50),
	aspectRatio: z.custom<AspectRatio>().default("16:9"),
	webcamLayoutPreset: z.custom<WebcamLayoutPreset>().default(DEFAULT_WEBCAM_LAYOUT_PRESET),
	webcamMaskShape: z.custom<WebcamMaskShape>().default(DEFAULT_WEBCAM_MASK_SHAPE),
	webcamSizePreset: z.custom<WebcamSizePreset>().default(DEFAULT_WEBCAM_SIZE_PRESET),
	webcamPosition: z.custom<WebcamPosition | null>().default(DEFAULT_WEBCAM_POSITION),
});

export type EditorState = z.infer<typeof EditorStateSchema>;
export const INITIAL_EDITOR_STATE: EditorState = EditorStateSchema.parse({});

// ── Internal counters (excluded from undo history) ──────────────────

interface InternalState {
	_nextIds: { zoom: number; trim: number; speed: number; annotation: number; chapter: number };
	_nextAnnotationZIndex: number;
}

// ── Actions ─────────────────────────────────────────────────────────

interface EditorActions {
	// Zoom
	addZoom: (span: Span) => string;
	addZoomSuggested: (span: Span, focus: ZoomFocus) => string;
	addAndSelectZoom: (span: Span) => void;
	addAndSelectZoomSuggested: (span: Span, focus: ZoomFocus) => void;
	setZoomSpan: (id: string, span: Span) => void;
	setZoomFocus: (id: string, focus: ZoomFocus) => void;
	setZoomDepth: (id: string, depth: ZoomDepth) => void;
	setZoomFocusMode: (id: string, mode: ZoomFocusMode) => void;
	setZoomCustomScale: (id: string, customScale: number | undefined) => void;
	duplicateZoom: (id: string) => void;
	deleteZoom: (id: string) => void;

	// Trim
	addTrim: (span: Span) => string;
	addAndSelectTrim: (span: Span) => void;
	setTrimSpan: (id: string, span: Span) => void;
	setTrimField: (id: string, updater: (r: TrimRegion) => Partial<TrimRegion>) => void;
	setTrimStartToNow: (id: string, nowMs: number) => void;
	setTrimEndToNow: (id: string, nowMs: number) => void;
	setTrimStartFromAdjacent: (id: string) => void;
	setTrimEndFromAdjacent: (id: string) => void;
	duplicateTrim: (id: string) => void;
	deleteTrim: (id: string) => void;

	// Speed
	addSpeed: (span: Span) => string;
	addAndSelectSpeed: (span: Span) => void;
	setSpeedSpan: (id: string, span: Span) => void;
	setSpeed: (id: string, speed: PlaybackSpeed) => void;
	duplicateSpeed: (id: string) => void;
	deleteSpeed: (id: string) => void;

	// Annotation
	addAnnotation: (span: Span) => string;
	addAndSelectAnnotation: (span: Span) => void;
	setAnnotationSpan: (id: string, span: Span) => void;
	setAnnotationContent: (id: string, content: string) => void;
	setAnnotationType: (id: string, type: AnnotationType) => void;
	setAnnotationStyle: (id: string, style: Partial<AnnotationRegion["style"]>) => void;
	setAnnotationFigureData: (id: string, figureData: FigureData) => void;
	setAnnotationPosition: (id: string, position: { x: number; y: number }) => void;
	setAnnotationSize: (id: string, size: { width: number; height: number }) => void;
	duplicateAnnotation: (id: string) => void;
	deleteAnnotation: (id: string) => void;

	// Chapter
	addChapter: (startMs: number, endMs: number) => string;
	renameChapter: (id: string, name: string) => void;
	setChapterSpan: (id: string, span: Span) => void;
	deleteChapter: (id: string) => void;

	// Visual settings
	setWallpaper: (w: string) => void;
	setShadowIntensity: (v: number) => void;
	setShowBlur: (v: boolean) => void;
	setMotionBlurAmount: (v: number) => void;
	setBorderRadius: (v: number) => void;
	setPadding: (v: number) => void;
	setCropRegion: (r: CropRegion) => void;
	setAspectRatio: (ar: AspectRatio) => void;
	setWebcamLayoutPreset: (p: WebcamLayoutPreset) => void;
	setWebcamMaskShape: (s: WebcamMaskShape) => void;
	setWebcamSizePreset: (v: WebcamSizePreset) => void;
	setWebcamPosition: (pos: WebcamPosition | null) => void;

	// Batch / project
	loadState: (state: Partial<EditorState>) => void;
	resetIdCounters: (state: EditorState) => void;
}

export type EditorStore = EditorState & InternalState & EditorActions;

// ── Helpers ─────────────────────────────────────────────────────────

function setSpan<T extends { id: string; startMs: number; endMs: number }>(
	regions: T[],
	id: string,
	span: Span,
): T[] {
	return regions.map((r) =>
		r.id === id ? { ...r, startMs: Math.round(span.start), endMs: Math.round(span.end) } : r,
	);
}

function deriveNextId(prefix: string, ids: string[]): number {
	return (
		ids.reduce((max, id) => {
			const n = Number.parseInt(id.replace(`${prefix}-`, ""), 10);
			return Number.isNaN(n) ? max : Math.max(max, n);
		}, 0) + 1
	);
}

function clearSelectionIf(type: "Zoom" | "Trim" | "Speed" | "Annotation" | "Chapter", id: string) {
	const sel = useEditorSelectionStore.getState();
	const key = `selected${type}Id` as keyof typeof sel;
	if (sel[key] === id) {
		const fn = sel[`select${type}` as keyof typeof sel] as (id: string | null) => void;
		fn(null);
	}
}

// ── Store ───────────────────────────────────────────────────────────

const sel = () => useEditorSelectionStore.getState();

export const useEditorStore = create<EditorStore>()(
	temporal(
		immer((set, get) => ({
			...INITIAL_EDITOR_STATE,
			_nextIds: { zoom: 1, trim: 1, speed: 1, annotation: 1, chapter: 1 },
			_nextAnnotationZIndex: 1,

			// ── Zoom ──────────────────────────────────────────
			addZoom: (span) => {
				const id = `zoom-${get()._nextIds.zoom}`;
				set((s) => {
					s._nextIds.zoom++;
					s.zoomRegions.push({ id, startMs: Math.round(span.start), endMs: Math.round(span.end), depth: DEFAULT_ZOOM_DEPTH, focus: { cx: 0.5, cy: 0.5 } });
				});
				return id;
			},
			addZoomSuggested: (span, focus) => {
				const id = `zoom-${get()._nextIds.zoom}`;
				set((s) => {
					s._nextIds.zoom++;
					s.zoomRegions.push({ id, startMs: Math.round(span.start), endMs: Math.round(span.end), depth: DEFAULT_ZOOM_DEPTH, focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH) });
				});
				return id;
			},
			addAndSelectZoom: (span) => { sel().selectZoom(get().addZoom(span)); },
			addAndSelectZoomSuggested: (span, focus) => { sel().selectZoom(get().addZoomSuggested(span, focus)); },
			setZoomSpan: (id, span) => set({ zoomRegions: setSpan(get().zoomRegions, id, span) }),
			setZoomFocus: (id, focus) => set((s) => {
				const r = s.zoomRegions.find((z) => z.id === id);
				if (r) r.focus = clampFocusToDepth(focus, r.depth);
			}),
			setZoomDepth: (id, depth) => set((s) => {
				const r = s.zoomRegions.find((z) => z.id === id);
				if (r) { r.depth = depth; r.customScale = undefined; r.focus = clampFocusToDepth(r.focus, depth); }
			}),
			setZoomFocusMode: (id, mode) => set((s) => {
				const r = s.zoomRegions.find((z) => z.id === id);
				if (r) r.focusMode = mode;
			}),
			setZoomCustomScale: (id, customScale) => set((s) => {
				const r = s.zoomRegions.find((z) => z.id === id);
				if (r) r.customScale = customScale;
			}),
			duplicateZoom: (id) => set((s) => {
				const src = s.zoomRegions.find((z) => z.id === id);
				if (!src) return;
				const dur = src.endMs - src.startMs;
				s.zoomRegions.push({ ...src, id: `zoom-${s._nextIds.zoom++}`, startMs: src.endMs, endMs: src.endMs + dur });
			}),
			deleteZoom: (id) => { set((s) => { s.zoomRegions = s.zoomRegions.filter((r) => r.id !== id); }); clearSelectionIf("Zoom", id); },

			// ── Trim ──────────────────────────────────────────
			addTrim: (span) => {
				const id = `trim-${get()._nextIds.trim}`;
				set((s) => { s._nextIds.trim++; s.trimRegions.push({ id, startMs: Math.round(span.start), endMs: Math.round(span.end) }); });
				return id;
			},
			addAndSelectTrim: (span) => { sel().selectTrim(get().addTrim(span)); },
			setTrimSpan: (id, span) => set({ trimRegions: setSpan(get().trimRegions, id, span) }),
			setTrimField: (id, updater) => set((s) => {
				const r = s.trimRegions.find((t) => t.id === id);
				if (r) Object.assign(r, updater(r));
			}),
			setTrimStartToNow: (id, nowMs) => {
				const r = get().trimRegions.find((t) => t.id === id);
				if (r && nowMs < r.endMs) get().setTrimSpan(id, { start: nowMs, end: r.endMs });
			},
			setTrimEndToNow: (id, nowMs) => {
				const r = get().trimRegions.find((t) => t.id === id);
				if (r && nowMs > r.startMs) get().setTrimSpan(id, { start: r.startMs, end: nowMs });
			},
			setTrimStartFromAdjacent: (id) => {
				const { trimRegions: regions } = get();
				const target = regions.find((r) => r.id === id);
				if (!target) return;
				const adj = [...regions].filter((r) => r.id !== id && r.endMs <= target.startMs).sort((a, b) => b.endMs - a.endMs)[0];
				if (adj) get().setTrimSpan(id, { start: adj.endMs, end: target.endMs });
			},
			setTrimEndFromAdjacent: (id) => {
				const { trimRegions: regions } = get();
				const target = regions.find((r) => r.id === id);
				if (!target) return;
				const adj = [...regions].filter((r) => r.id !== id && r.startMs >= target.endMs).sort((a, b) => a.startMs - b.startMs)[0];
				if (adj) get().setTrimSpan(id, { start: target.startMs, end: adj.startMs });
			},
			duplicateTrim: (id) => set((s) => {
				const src = s.trimRegions.find((t) => t.id === id);
				if (!src) return;
				const dur = src.endMs - src.startMs;
				s.trimRegions.push({ id: `trim-${s._nextIds.trim++}`, startMs: src.endMs, endMs: src.endMs + dur });
			}),
			deleteTrim: (id) => { set((s) => { s.trimRegions = s.trimRegions.filter((r) => r.id !== id); }); clearSelectionIf("Trim", id); },

			// ── Speed ──────────────────────────────────────────
			addSpeed: (span) => {
				const id = `speed-${get()._nextIds.speed}`;
				set((s) => { s._nextIds.speed++; s.speedRegions.push({ id, startMs: Math.round(span.start), endMs: Math.round(span.end), speed: DEFAULT_PLAYBACK_SPEED }); });
				return id;
			},
			addAndSelectSpeed: (span) => { sel().selectSpeed(get().addSpeed(span)); },
			setSpeedSpan: (id, span) => set({ speedRegions: setSpan(get().speedRegions, id, span) }),
			setSpeed: (id, speed) => set((s) => { const r = s.speedRegions.find((sp) => sp.id === id); if (r) r.speed = speed; }),
			duplicateSpeed: (id) => set((s) => {
				const src = s.speedRegions.find((sp) => sp.id === id);
				if (!src) return;
				const dur = src.endMs - src.startMs;
				s.speedRegions.push({ ...src, id: `speed-${s._nextIds.speed++}`, startMs: src.endMs, endMs: src.endMs + dur });
			}),
			deleteSpeed: (id) => { set((s) => { s.speedRegions = s.speedRegions.filter((r) => r.id !== id); }); clearSelectionIf("Speed", id); },

			// ── Annotation ──────────────────────────────────────
			addAnnotation: (span) => {
				const id = `annotation-${get()._nextIds.annotation}`;
				set((s) => {
					s._nextIds.annotation++;
					const zIndex = s._nextAnnotationZIndex++;
					s.annotationRegions.push({
						id, startMs: Math.round(span.start), endMs: Math.round(span.end),
						type: "text", content: "Enter text...",
						position: { ...DEFAULT_ANNOTATION_POSITION }, size: { ...DEFAULT_ANNOTATION_SIZE },
						style: { ...DEFAULT_ANNOTATION_STYLE }, zIndex,
					});
				});
				return id;
			},
			addAndSelectAnnotation: (span) => { sel().selectAnnotation(get().addAnnotation(span)); },
			setAnnotationSpan: (id, span) => set({ annotationRegions: setSpan(get().annotationRegions, id, span) }),
			setAnnotationContent: (id, content) => set((s) => {
				const r = s.annotationRegions.find((a) => a.id === id);
				if (!r) return;
				if (r.type === "text") { r.content = content; r.textContent = content; }
				else if (r.type === "image") { r.content = content; r.imageContent = content; }
				else r.content = content;
			}),
			setAnnotationType: (id, type) => set((s) => {
				const r = s.annotationRegions.find((a) => a.id === id);
				if (!r) return;
				r.type = type;
				if (type === "text") r.content = r.textContent || "Enter text...";
				else if (type === "image") r.content = r.imageContent || "";
				else if (type === "figure") { r.content = ""; if (!r.figureData) r.figureData = { ...DEFAULT_FIGURE_DATA }; }
			}),
			setAnnotationStyle: (id, style) => set((s) => { const r = s.annotationRegions.find((a) => a.id === id); if (r) Object.assign(r.style, style); }),
			setAnnotationFigureData: (id, figureData) => set((s) => { const r = s.annotationRegions.find((a) => a.id === id); if (r) r.figureData = figureData; }),
			setAnnotationPosition: (id, position) => set((s) => { const r = s.annotationRegions.find((a) => a.id === id); if (r) r.position = position; }),
			setAnnotationSize: (id, size) => set((s) => { const r = s.annotationRegions.find((a) => a.id === id); if (r) r.size = size; }),
			duplicateAnnotation: (id) => set((s) => {
				const src = s.annotationRegions.find((a) => a.id === id);
				if (!src) return;
				const dur = src.endMs - src.startMs;
				s.annotationRegions.push({ ...src, id: `annotation-${s._nextIds.annotation++}`, zIndex: s._nextAnnotationZIndex++, startMs: src.endMs, endMs: src.endMs + dur });
			}),
			deleteAnnotation: (id) => { set((s) => { s.annotationRegions = s.annotationRegions.filter((r) => r.id !== id); }); clearSelectionIf("Annotation", id); },

			// ── Chapter ──────────────────────────────────────────
			addChapter: (startMs, endMs) => {
				const id = `chapter-${get()._nextIds.chapter}`;
				set((s) => { s._nextIds.chapter++; s.chapters.push({ id, startMs, endMs, name: "" }); });
				return id;
			},
			renameChapter: (id, name) => set((s) => { const ch = s.chapters.find((c) => c.id === id); if (ch) ch.name = name; }),
			setChapterSpan: (id, span) => set({ chapters: setSpan(get().chapters, id, span) }),
			deleteChapter: (id) => { set((s) => { s.chapters = s.chapters.filter((c) => c.id !== id); }); clearSelectionIf("Chapter", id); },

			// ── Visual settings ──────────────────────────────────
			setWallpaper: (w) => set({ wallpaper: w }),
			setShadowIntensity: (v) => set({ shadowIntensity: v }),
			setShowBlur: (v) => set({ showBlur: v }),
			setMotionBlurAmount: (v) => set({ motionBlurAmount: v }),
			setBorderRadius: (v) => set({ borderRadius: v }),
			setPadding: (v) => set({ padding: v }),
			setCropRegion: (r) => set({ cropRegion: r }),
			setAspectRatio: (ar) => set({ aspectRatio: ar }),
			setWebcamLayoutPreset: (p) => set({ webcamLayoutPreset: p }),
			setWebcamMaskShape: (ms) => set({ webcamMaskShape: ms }),
			setWebcamSizePreset: (v) => set({ webcamSizePreset: v }),
			setWebcamPosition: (pos) => set({ webcamPosition: pos }),

			// ── Batch / project ──────────────────────────────────
			loadState: (state) => set({ ...INITIAL_EDITOR_STATE, ...state }),
			resetIdCounters: (state) => set({
				_nextIds: {
					zoom: deriveNextId("zoom", state.zoomRegions.map((r) => r.id)),
					trim: deriveNextId("trim", state.trimRegions.map((r) => r.id)),
					speed: deriveNextId("speed", state.speedRegions.map((r) => r.id)),
					annotation: deriveNextId("annotation", state.annotationRegions.map((r) => r.id)),
					chapter: deriveNextId("chapter", state.chapters.map((c) => c.id)),
				},
				_nextAnnotationZIndex: state.annotationRegions.reduce((max, r) => Math.max(max, r.zIndex), 0) + 1,
			}),
		})),
		{
			limit: 80,
			partialize: (state) => {
				const data: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(state)) {
					if (typeof value !== "function" && !key.startsWith("_")) data[key] = value;
				}
				return data as unknown as EditorState;
			},
		},
	),
);

// ── Temporal helpers ────────────────────────────────────────────────

export function pauseEditorHistory() {
	useEditorStore.temporal.getState().pause();
}

export function resumeEditorHistory() {
	useEditorStore.temporal.getState().resume();
}

export function undoEditor() {
	useEditorStore.temporal.getState().undo();
}

export function redoEditor() {
	useEditorStore.temporal.getState().redo();
}
