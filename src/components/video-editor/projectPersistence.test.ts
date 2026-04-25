import { describe, expect, it } from "vitest";
import {
	createProjectData,
	createProjectSnapshot,
	deriveNextId,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	PROJECT_VERSION,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";

describe("toFileUrl", () => {
	it("converts a unix absolute path", () => {
		expect(toFileUrl("/home/user/video.mp4")).toBe("file:///home/user/video.mp4");
	});

	it("converts a Windows drive path", () => {
		expect(toFileUrl("C:/Users/test/video.mp4")).toBe("file:///C:/Users/test/video.mp4");
	});

	it("converts backslashes to forward slashes", () => {
		expect(toFileUrl("C:\\Users\\test\\video.mp4")).toBe("file:///C:/Users/test/video.mp4");
	});

	it("encodes special characters in path segments", () => {
		const result = toFileUrl("/home/user/my video (1).mp4");
		expect(result).toBe("file:///home/user/my%20video%20(1).mp4");
	});

	it("preserves Windows drive letter without encoding", () => {
		const result = toFileUrl("D:/My Files/test.mp4");
		expect(result).toContain("file:///D:/");
	});

	it("handles UNC paths", () => {
		const result = toFileUrl("//server/share/file.mp4");
		expect(result).toBe("file://server/share/file.mp4");
	});

	it("handles UNC path with special characters", () => {
		const result = toFileUrl("//server/share/my file.mp4");
		expect(result).toBe("file://server/share/my%20file.mp4");
	});

	it("adds leading slash to relative paths", () => {
		const result = toFileUrl("relative/path.mp4");
		expect(result).toBe("file:///relative/path.mp4");
	});
});

describe("fromFileUrl", () => {
	it("converts a unix file URL back to path", () => {
		expect(fromFileUrl("file:///home/user/video.mp4")).toBe("/home/user/video.mp4");
	});

	it("converts a Windows file URL back to drive path", () => {
		expect(fromFileUrl("file:///C:/Users/test/video.mp4")).toBe("C:/Users/test/video.mp4");
	});

	it("decodes percent-encoded characters", () => {
		expect(fromFileUrl("file:///home/user/my%20video.mp4")).toBe("/home/user/my video.mp4");
	});

	it("handles UNC file URLs", () => {
		expect(fromFileUrl("file://server/share/file.mp4")).toBe("//server/share/file.mp4");
	});

	it("returns input unchanged for non-file URLs", () => {
		expect(fromFileUrl("https://example.com")).toBe("https://example.com");
	});

	it("returns input unchanged for plain paths", () => {
		expect(fromFileUrl("/home/user/video.mp4")).toBe("/home/user/video.mp4");
	});

	it("trims whitespace before checking", () => {
		expect(fromFileUrl("  file:///home/user/video.mp4  ")).toBe("/home/user/video.mp4");
	});

	it("handles case-insensitive file:// prefix", () => {
		expect(fromFileUrl("FILE:///home/user/video.mp4")).toBe("/home/user/video.mp4");
	});

	it("handles malformed URL with fallback", () => {
		const result = fromFileUrl("file://");
		expect(typeof result).toBe("string");
	});
});

describe("deriveNextId", () => {
	it("returns 1 for empty id list", () => {
		expect(deriveNextId("zoom", [])).toBe(1);
	});

	it("returns max + 1 from existing ids", () => {
		expect(deriveNextId("zoom", ["zoom-3", "zoom-7", "zoom-2"])).toBe(8);
	});

	it("ignores ids with wrong prefix", () => {
		expect(deriveNextId("trim", ["zoom-5", "trim-2", "speed-3"])).toBe(3);
	});

	it("ignores non-numeric suffixes", () => {
		expect(deriveNextId("trim", ["trim-abc", "trim-2"])).toBe(3);
	});

	it("handles single id", () => {
		expect(deriveNextId("chapter", ["chapter-10"])).toBe(11);
	});
});

describe("validateProjectData", () => {
	it("rejects null", () => {
		expect(validateProjectData(null)).toBe(false);
	});

	it("rejects non-object", () => {
		expect(validateProjectData("string")).toBe(false);
	});

	it("rejects missing version", () => {
		expect(validateProjectData({ editor: {}, media: { screenVideoPath: "/v.mp4" } })).toBe(false);
	});

	it("rejects missing editor", () => {
		expect(
			validateProjectData({ version: 2, media: { screenVideoPath: "/v.mp4" } }),
		).toBe(false);
	});

	it("rejects when no media or videoPath", () => {
		expect(validateProjectData({ version: 2, editor: {} })).toBe(false);
	});

	it("accepts valid project with media", () => {
		expect(
			validateProjectData({
				version: 2,
				media: { screenVideoPath: "/video.mp4" },
				editor: {},
			}),
		).toBe(true);
	});

	it("accepts legacy project with videoPath", () => {
		expect(
			validateProjectData({ version: 1, videoPath: "/video.mp4", editor: {} }),
		).toBe(true);
	});
});

describe("resolveProjectMedia", () => {
	it("returns media from media field", () => {
		const result = resolveProjectMedia({
			media: { screenVideoPath: "/screen.mp4", webcamVideoPath: "/webcam.mp4" },
		});
		expect(result).toEqual({ screenVideoPath: "/screen.mp4", webcamVideoPath: "/webcam.mp4" });
	});

	it("falls back to videoPath for legacy projects", () => {
		const result = resolveProjectMedia({ videoPath: "/old.mp4" });
		expect(result).toEqual({ screenVideoPath: "/old.mp4" });
	});

	it("prefers media field over videoPath", () => {
		const result = resolveProjectMedia({
			media: { screenVideoPath: "/new.mp4" },
			videoPath: "/old.mp4",
		});
		expect(result?.screenVideoPath).toBe("/new.mp4");
	});

	it("returns null when both are missing", () => {
		expect(resolveProjectMedia({})).toBeNull();
	});

	it("returns null for empty videoPath", () => {
		expect(resolveProjectMedia({ videoPath: "  " })).toBeNull();
	});
});

describe("normalizeProjectEditor", () => {
	it("returns full defaults for empty input", () => {
		const result = normalizeProjectEditor({});
		expect(result.wallpaper).toContain("wallpaper1.jpg");
		expect(result.shadowIntensity).toBe(0);
		expect(result.showBlur).toBe(false);
		expect(result.motionBlurAmount).toBe(0);
		expect(result.borderRadius).toBe(0);
		expect(result.padding).toBe(50);
		expect(result.cropRegion).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(result.zoomRegions).toEqual([]);
		expect(result.trimRegions).toEqual([]);
		expect(result.speedRegions).toEqual([]);
		expect(result.annotationRegions).toEqual([]);
		expect(result.aspectRatio).toBe("16:9");
		expect(result.exportQuality).toBe("good");
		expect(result.exportFormat).toBe("mp4");
		expect(result.gifFrameRate).toBe(15);
		expect(result.gifLoop).toBe(true);
		expect(result.gifSizePreset).toBe("medium");
	});

	it("preserves valid wallpaper", () => {
		expect(normalizeProjectEditor({ wallpaper: "/custom/bg.png" }).wallpaper).toBe("/custom/bg.png");
	});

	it("clamps padding to [0, 100]", () => {
		expect(normalizeProjectEditor({ padding: -10 }).padding).toBe(0);
		expect(normalizeProjectEditor({ padding: 200 }).padding).toBe(100);
		expect(normalizeProjectEditor({ padding: 75 }).padding).toBe(75);
	});

	it("clamps motionBlurAmount to [0, 1]", () => {
		expect(normalizeProjectEditor({ motionBlurAmount: 2 }).motionBlurAmount).toBe(1);
		expect(normalizeProjectEditor({ motionBlurAmount: -1 }).motionBlurAmount).toBe(0);
	});

	it("converts legacy motionBlurEnabled to motionBlurAmount", () => {
		const result = normalizeProjectEditor({ motionBlurEnabled: true } as any);
		expect(result.motionBlurAmount).toBe(0.35);
	});

	it("normalizes zoom regions", () => {
		const result = normalizeProjectEditor({
			zoomRegions: [
				{ id: "z1", startMs: 5000, endMs: 10000, depth: 3, focus: { cx: 0.5, cy: 0.5 }, focusMode: "manual" },
			],
		});
		expect(result.zoomRegions).toHaveLength(1);
		expect(result.zoomRegions[0].id).toBe("z1");
		expect(result.zoomRegions[0].depth).toBe(3);
	});

	it("clamps zoom focus to [0,1]", () => {
		const result = normalizeProjectEditor({
			zoomRegions: [
				{ id: "z1", startMs: 0, endMs: 1000, depth: 2, focus: { cx: -0.5, cy: 1.5 }, focusMode: "manual" },
			],
		});
		expect(result.zoomRegions[0].focus.cx).toBe(0);
		expect(result.zoomRegions[0].focus.cy).toBe(1);
	});

	it("defaults invalid zoom depth to DEFAULT_ZOOM_DEPTH", () => {
		const result = normalizeProjectEditor({
			zoomRegions: [
				{ id: "z1", startMs: 0, endMs: 1000, depth: 99 as any, focus: { cx: 0.5, cy: 0.5 }, focusMode: "manual" },
			],
		});
		expect(result.zoomRegions[0].depth).toBe(3);
	});

	it("ensures zoom endMs > startMs", () => {
		const result = normalizeProjectEditor({
			zoomRegions: [
				{ id: "z1", startMs: 5000, endMs: 3000, depth: 2, focus: { cx: 0.5, cy: 0.5 }, focusMode: "manual" },
			],
		});
		expect(result.zoomRegions[0].startMs).toBeLessThan(result.zoomRegions[0].endMs);
	});

	it("normalizes trim regions with bad data", () => {
		const result = normalizeProjectEditor({
			trimRegions: [
				{ id: "t1", startMs: Number.NaN, endMs: 5000 },
			],
		});
		expect(result.trimRegions[0].startMs).toBe(0);
		expect(result.trimRegions[0].endMs).toBe(5000);
	});

	it("filters out trim regions without id", () => {
		const result = normalizeProjectEditor({
			trimRegions: [
				{ startMs: 0, endMs: 1000 } as any,
				{ id: "t1", startMs: 0, endMs: 1000 },
			],
		});
		expect(result.trimRegions).toHaveLength(1);
	});

	it("normalizes speed regions with clamped speed", () => {
		const result = normalizeProjectEditor({
			speedRegions: [
				{ id: "s1", startMs: 0, endMs: 5000, speed: 0.5 },
			],
		});
		expect(result.speedRegions[0].speed).toBe(0.5);
	});

	it("defaults out-of-range speed to DEFAULT_PLAYBACK_SPEED", () => {
		const result = normalizeProjectEditor({
			speedRegions: [
				{ id: "s1", startMs: 0, endMs: 5000, speed: -5 },
			],
		});
		expect(result.speedRegions[0].speed).toBe(1.5);
	});

	it("normalizes annotation regions", () => {
		const result = normalizeProjectEditor({
			annotationRegions: [
				{ id: "a1", startMs: 0, endMs: 5000, type: "text", content: "hello" },
			],
		});
		expect(result.annotationRegions).toHaveLength(1);
		expect(result.annotationRegions[0].content).toBe("hello");
		expect(result.annotationRegions[0].type).toBe("text");
	});

	it("defaults invalid annotation type to text", () => {
		const result = normalizeProjectEditor({
			annotationRegions: [
				{ id: "a1", startMs: 0, endMs: 5000, type: "invalid" as any, content: "" },
			],
		});
		expect(result.annotationRegions[0].type).toBe("text");
	});

	it("clamps crop region values", () => {
		const result = normalizeProjectEditor({
			cropRegion: { x: -0.5, y: 0.5, width: 2, height: -1 },
		});
		expect(result.cropRegion.x).toBe(0);
		expect(result.cropRegion.y).toBe(0.5);
		expect(result.cropRegion.width).toBeGreaterThanOrEqual(0.01);
		expect(result.cropRegion.height).toBeGreaterThanOrEqual(0.01);
	});

	it("clamps crop height to 0 when y is at boundary", () => {
		const result = normalizeProjectEditor({
			cropRegion: { x: 0, y: 1, width: 0.5, height: 0.5 },
		});
		expect(result.cropRegion.y).toBe(1);
		expect(result.cropRegion.height).toBe(0);
	});

	it("normalizes webcam values", () => {
		expect(normalizeProjectEditor({ webcamMaskShape: "circle" }).webcamMaskShape).toBe("circle");
		expect(normalizeProjectEditor({ webcamMaskShape: "rounded" }).webcamMaskShape).toBe("rounded");
		expect(normalizeProjectEditor({ webcamMaskShape: "bogus" as any }).webcamMaskShape).toBe("rectangle");
		expect(normalizeProjectEditor({ webcamLayoutPreset: "vertical-stack" }).webcamLayoutPreset).toBe("vertical-stack");
		expect(normalizeProjectEditor({ webcamLayoutPreset: "bogus" as any }).webcamLayoutPreset).toBe("picture-in-picture");
	});

	it("clamps webcam size preset to [10, 50]", () => {
		expect(normalizeProjectEditor({ webcamSizePreset: 5 as any }).webcamSizePreset).toBe(10);
		expect(normalizeProjectEditor({ webcamSizePreset: 100 as any }).webcamSizePreset).toBe(50);
	});

	it("normalizes webcam position", () => {
		const result = normalizeProjectEditor({
			webcamPosition: { cx: 1.5, cy: -0.2 },
		});
		expect(result.webcamPosition?.cx).toBe(1);
		expect(result.webcamPosition?.cy).toBe(0);
	});

	it("normalizes export settings", () => {
		expect(normalizeProjectEditor({ exportQuality: "source" }).exportQuality).toBe("source");
		expect(normalizeProjectEditor({ exportQuality: "medium" }).exportQuality).toBe("medium");
		expect(normalizeProjectEditor({ exportQuality: "bogus" as any }).exportQuality).toBe("good");
		expect(normalizeProjectEditor({ exportFormat: "gif" }).exportFormat).toBe("gif");
		expect(normalizeProjectEditor({ exportFormat: "bogus" as any }).exportFormat).toBe("mp4");
	});

	it("normalizes gif settings", () => {
		expect(normalizeProjectEditor({ gifFrameRate: 30 }).gifFrameRate).toBe(30);
		expect(normalizeProjectEditor({ gifFrameRate: 12 as any }).gifFrameRate).toBe(15);
		expect(normalizeProjectEditor({ gifLoop: false }).gifLoop).toBe(false);
		expect(normalizeProjectEditor({ gifSizePreset: "large" }).gifSizePreset).toBe("large");
		expect(normalizeProjectEditor({ gifSizePreset: "bogus" as any }).gifSizePreset).toBe("medium");
	});

	it("defaults aspect ratio to 16:9 for invalid value", () => {
		expect(normalizeProjectEditor({ aspectRatio: "bogus" as any }).aspectRatio).toBe("16:9");
	});

	it("handles non-array region inputs gracefully", () => {
		const result = normalizeProjectEditor({
			zoomRegions: "not-an-array" as any,
			trimRegions: null as any,
			speedRegions: undefined as any,
		});
		expect(result.zoomRegions).toEqual([]);
		expect(result.trimRegions).toEqual([]);
		expect(result.speedRegions).toEqual([]);
	});
});

describe("createProjectData", () => {
	it("creates project with correct version", () => {
		const editor = normalizeProjectEditor({});
		const data = createProjectData({ screenVideoPath: "/v.mp4" }, editor);
		expect(data.version).toBe(PROJECT_VERSION);
		expect(data.media?.screenVideoPath).toBe("/v.mp4");
		expect(data.editor).toBe(editor);
	});
});

describe("createProjectSnapshot", () => {
	it("produces identical JSON for identical inputs", () => {
		const media = { screenVideoPath: "/v.mp4" };
		const editor = { wallpaper: "/bg.jpg" };
		expect(createProjectSnapshot(media, editor)).toBe(createProjectSnapshot(media, editor));
	});

	it("produces different JSON for different inputs", () => {
		const media = { screenVideoPath: "/v.mp4" };
		const a = createProjectSnapshot(media, { padding: 10 });
		const b = createProjectSnapshot(media, { padding: 90 });
		expect(a).not.toBe(b);
	});
});

describe("hasProjectUnsavedChanges", () => {
	it("returns false when both are null", () => {
		expect(hasProjectUnsavedChanges(null, null)).toBe(false);
	});

	it("returns false when snapshots are equal", () => {
		expect(hasProjectUnsavedChanges("same", "same")).toBe(false);
	});

	it("returns true when snapshots differ", () => {
		expect(hasProjectUnsavedChanges("current", "baseline")).toBe(true);
	});

	it("returns false when current is null", () => {
		expect(hasProjectUnsavedChanges(null, "baseline")).toBe(false);
	});

	it("returns false when baseline is null", () => {
		expect(hasProjectUnsavedChanges("current", null)).toBe(false);
	});
});
