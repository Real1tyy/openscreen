import { describe, expect, it, vi } from "vitest";
import { normalizeProjectMedia, normalizeRecordingSession } from "./recordingSession";

describe("normalizeProjectMedia", () => {
	it("returns null for null input", () => {
		expect(normalizeProjectMedia(null)).toBeNull();
	});

	it("returns null for non-object input", () => {
		expect(normalizeProjectMedia("string")).toBeNull();
		expect(normalizeProjectMedia(42)).toBeNull();
		expect(normalizeProjectMedia(undefined)).toBeNull();
	});

	it("returns null when screenVideoPath is missing", () => {
		expect(normalizeProjectMedia({})).toBeNull();
	});

	it("returns null when screenVideoPath is empty string", () => {
		expect(normalizeProjectMedia({ screenVideoPath: "" })).toBeNull();
	});

	it("returns null when screenVideoPath is whitespace", () => {
		expect(normalizeProjectMedia({ screenVideoPath: "   " })).toBeNull();
	});

	it("returns media with screenVideoPath only", () => {
		const result = normalizeProjectMedia({ screenVideoPath: "/video.mp4" });
		expect(result).toEqual({ screenVideoPath: "/video.mp4" });
		expect(result).not.toHaveProperty("webcamVideoPath");
	});

	it("returns media with both paths", () => {
		const result = normalizeProjectMedia({
			screenVideoPath: "/screen.mp4",
			webcamVideoPath: "/webcam.mp4",
		});
		expect(result).toEqual({
			screenVideoPath: "/screen.mp4",
			webcamVideoPath: "/webcam.mp4",
		});
	});

	it("ignores webcam path if it is empty", () => {
		const result = normalizeProjectMedia({
			screenVideoPath: "/screen.mp4",
			webcamVideoPath: "",
		});
		expect(result).toEqual({ screenVideoPath: "/screen.mp4" });
		expect(result).not.toHaveProperty("webcamVideoPath");
	});

	it("trims screenVideoPath whitespace", () => {
		const result = normalizeProjectMedia({ screenVideoPath: "  /video.mp4  " });
		expect(result?.screenVideoPath).toBe("/video.mp4");
	});

	it("returns null for non-string screenVideoPath", () => {
		expect(normalizeProjectMedia({ screenVideoPath: 123 })).toBeNull();
	});
});

describe("normalizeRecordingSession", () => {
	it("returns null for null input", () => {
		expect(normalizeRecordingSession(null)).toBeNull();
	});

	it("returns null for non-object", () => {
		expect(normalizeRecordingSession("string")).toBeNull();
	});

	it("returns null when media is invalid", () => {
		expect(normalizeRecordingSession({ createdAt: 1000 })).toBeNull();
	});

	it("returns session with valid createdAt", () => {
		const result = normalizeRecordingSession({
			screenVideoPath: "/video.mp4",
			createdAt: 1700000000000,
		});
		expect(result).toEqual({
			screenVideoPath: "/video.mp4",
			createdAt: 1700000000000,
		});
	});

	it("uses Date.now() when createdAt is missing", () => {
		const now = 1700000000000;
		vi.spyOn(Date, "now").mockReturnValue(now);
		const result = normalizeRecordingSession({ screenVideoPath: "/video.mp4" });
		expect(result?.createdAt).toBe(now);
		vi.restoreAllMocks();
	});

	it("uses Date.now() when createdAt is not a number", () => {
		const now = 1700000000000;
		vi.spyOn(Date, "now").mockReturnValue(now);
		const result = normalizeRecordingSession({
			screenVideoPath: "/video.mp4",
			createdAt: "invalid",
		});
		expect(result?.createdAt).toBe(now);
		vi.restoreAllMocks();
	});

	it("uses Date.now() when createdAt is NaN", () => {
		const now = 1700000000000;
		vi.spyOn(Date, "now").mockReturnValue(now);
		const result = normalizeRecordingSession({
			screenVideoPath: "/video.mp4",
			createdAt: Number.NaN,
		});
		expect(result?.createdAt).toBe(now);
		vi.restoreAllMocks();
	});

	it("includes webcamVideoPath when present", () => {
		const result = normalizeRecordingSession({
			screenVideoPath: "/screen.mp4",
			webcamVideoPath: "/webcam.mp4",
			createdAt: 1000,
		});
		expect(result?.webcamVideoPath).toBe("/webcam.mp4");
	});
});
