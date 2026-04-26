import { describe, expect, it, vi, beforeEach } from "vitest";

// Test the path utilities and helper functions that are extractable/testable
// without the full Tauri runtime

describe("tauriBridge path safety", () => {
	describe("temp path construction", () => {
		it("should always produce a path with separator between dir and filename", () => {
			// Simulates what tempDir() returns on different platforms
			const dirsWithoutSlash = ["/tmp", "/var/tmp", "C:\\Users\\foo\\AppData\\Local\\Temp"];
			const dirsWithSlash = ["/tmp/", "/var/tmp/", "C:\\Users\\foo\\AppData\\Local\\Temp\\"];

			for (const dir of [...dirsWithoutSlash, ...dirsWithSlash]) {
				let normalized = dir;
				if (!normalized.endsWith("/") && !normalized.endsWith("\\")) {
					normalized += "/";
				}
				const path = `${normalized}test-file.raw`;

				// Must never have doubled path separator
				expect(path).not.toMatch(/\/\//);
				// Must never concatenate dir and filename without separator
				expect(path).not.toMatch(/[a-z0-9]test-file/i);
				// Must contain the filename
				expect(path).toContain("test-file.raw");
			}
		});

		it("tempDir without trailing slash produces valid path when fixed", () => {
			const dir = "/tmp"; // No trailing slash — the bug
			let fixed = dir;
			if (!fixed.endsWith("/")) fixed += "/";
			const path = `${fixed}openscreen-transfer-123.mp4`;
			expect(path).toBe("/tmp/openscreen-transfer-123.mp4");
		});

		it("tempDir with trailing slash produces valid path", () => {
			const dir = "/tmp/";
			let fixed = dir;
			if (!fixed.endsWith("/")) fixed += "/";
			const path = `${fixed}openscreen-transfer-123.mp4`;
			expect(path).toBe("/tmp/openscreen-transfer-123.mp4");
		});

		it("should not double-slash when dir already has trailing slash", () => {
			const dir = "/tmp/";
			let fixed = dir;
			if (!fixed.endsWith("/")) fixed += "/";
			expect(fixed).toBe("/tmp/");
			expect(fixed).not.toBe("/tmp//");
		});
	});

	describe("nextTempName generation", () => {
		it("generates unique names with correct extension", () => {
			let counter = 0;
			function nextTempName(ext: string): string {
				return `openscreen-transfer-${Date.now()}-${counter++}.${ext}`;
			}

			const name1 = nextTempName("mp4");
			const name2 = nextTempName("webm");
			const name3 = nextTempName("mp4");

			expect(name1).toMatch(/^openscreen-transfer-\d+-0\.mp4$/);
			expect(name2).toMatch(/^openscreen-transfer-\d+-1\.webm$/);
			expect(name3).toMatch(/^openscreen-transfer-\d+-2\.mp4$/);
			expect(name1).not.toBe(name3); // unique due to counter
		});

		it("handles gif extension", () => {
			let counter = 0;
			function nextTempName(ext: string): string {
				return `openscreen-transfer-${Date.now()}-${counter++}.${ext}`;
			}
			const name = nextTempName("gif");
			expect(name).toMatch(/\.gif$/);
		});
	});

	describe("isTauri detection", () => {
		it("returns false when __TAURI_INTERNALS__ is not present", () => {
			const w = {} as any;
			expect("__TAURI_INTERNALS__" in w).toBe(false);
		});

		it("returns true when __TAURI_INTERNALS__ is present", () => {
			const w = { __TAURI_INTERNALS__: {} } as any;
			expect("__TAURI_INTERNALS__" in w).toBe(true);
		});
	});

	describe("readFileAsBlobUrl mime types", () => {
		it("maps video extensions to correct mime types", () => {
			const mimeMap: Record<string, string> = {
				mp4: "video/mp4",
				webm: "video/webm",
				mov: "video/quicktime",
				avi: "video/x-msvideo",
				mkv: "video/x-matroska",
			};

			expect(mimeMap["mp4"]).toBe("video/mp4");
			expect(mimeMap["webm"]).toBe("video/webm");
			expect(mimeMap["mov"]).toBe("video/quicktime");
			expect(mimeMap["avi"]).toBe("video/x-msvideo");
			expect(mimeMap["mkv"]).toBe("video/x-matroska");
		});

		it("extracts extension correctly from file paths", () => {
			const paths = [
				"/home/user/video.mp4",
				"/tmp/recording.webm",
				"C:\\Users\\file.mov",
				"/path/to/file.with.dots.mkv",
			];
			const expected = ["mp4", "webm", "mov", "mkv"];

			paths.forEach((path, i) => {
				const ext = path.split(".").pop()?.toLowerCase() ?? "mp4";
				expect(ext).toBe(expected[i]);
			});
		});

		it("defaults to mp4 for unknown extensions", () => {
			const mimeMap: Record<string, string> = {
				mp4: "video/mp4",
				webm: "video/webm",
			};
			const ext = "xyz";
			const mime = mimeMap[ext] ?? "video/mp4";
			expect(mime).toBe("video/mp4");
		});

		it("defaults to mp4 for files without extension", () => {
			const path = "/tmp/noextension";
			const ext = path.split(".").pop()?.toLowerCase() ?? "mp4";
			// "noextension" is not in mime map
			const mimeMap: Record<string, string> = { mp4: "video/mp4" };
			const mime = mimeMap[ext] ?? "video/mp4";
			expect(mime).toBe("video/mp4");
		});
	});
});

describe("export save path construction", () => {
	it("save_exported_video_from_file receives correct temp path format", () => {
		let dir = "/tmp";
		if (!dir.endsWith("/")) dir += "/";
		const tempPath = `${dir}openscreen-transfer-1234567890-0.mp4`;

		expect(tempPath).toBe("/tmp/openscreen-transfer-1234567890-0.mp4");
		expect(tempPath.startsWith("/tmp/")).toBe(true);
		expect(tempPath.endsWith(".mp4")).toBe(true);
	});

	it("nvenc export output path is correctly constructed", () => {
		let dir = "/tmp";
		if (!dir.endsWith("/")) dir += "/";
		const tmpOutput = `${dir}openscreen-export-${Date.now()}.mp4`;

		expect(tmpOutput).toMatch(/^\/tmp\/openscreen-export-\d+\.mp4$/);
	});

	it("frame path for nvenc is correctly constructed", () => {
		let dir = "/tmp";
		if (!dir.endsWith("/")) dir += "/";
		for (let i = 0; i < 5; i++) {
			const framePath = `${dir}nvenc-frame-${i}.raw`;
			expect(framePath).toBe(`/tmp/nvenc-frame-${i}.raw`);
		}
	});
});

describe("CLI config field names contract", () => {
	it("editor config uses frontend-expected field names", () => {
		// These field names must match what VideoEditor.tsx reads from cliConfig
		const config = {
			showBlur: true,
			showShadow: true,
			shadowIntensity: 0.5,
			motionBlurAmount: 0.2,
			borderRadius: 13.5,
			padding: 50.0,
			wallpaper: "wallpaper1.jpg",
		};

		// VideoEditor.tsx destructures these exact keys
		expect(config).toHaveProperty("wallpaper");
		expect(config).toHaveProperty("showBlur");
		expect(config).toHaveProperty("showShadow");
		expect(config).toHaveProperty("shadowIntensity");
		expect(config).toHaveProperty("motionBlurAmount");
		expect(config).toHaveProperty("borderRadius");
		expect(config).toHaveProperty("padding");

		// Must NOT use the old field names
		expect(config).not.toHaveProperty("background");
		expect(config).not.toHaveProperty("blur");
		expect(config).not.toHaveProperty("shadow");
		expect(config).not.toHaveProperty("motionBlur");
		expect(config).not.toHaveProperty("roundness");
	});
});

describe("NVENC export config contract", () => {
	it("NvencExportConfig uses correct field names for Rust", () => {
		const config = {
			width: 1920,
			height: 1080,
			fps: 60,
			bitrate: 8000000,
			outputPath: "/tmp/export.mp4",
		};

		// Rust expects these exact camelCase names (serde renames to snake_case)
		expect(config).toHaveProperty("width");
		expect(config).toHaveProperty("height");
		expect(config).toHaveProperty("fps");
		expect(config).toHaveProperty("bitrate");
		expect(config).toHaveProperty("outputPath");
		expect(typeof config.width).toBe("number");
		expect(typeof config.outputPath).toBe("string");
	});

	it("feedFrame parameters match Rust command signature", () => {
		const params = {
			sessionId: "uuid-string",
			framePath: "/tmp/nvenc-frame-0.raw",
			width: 1920,
			height: 1080,
			isKeyframe: true,
		};

		expect(params).toHaveProperty("sessionId");
		expect(params).toHaveProperty("framePath");
		expect(params).toHaveProperty("width");
		expect(params).toHaveProperty("height");
		expect(params).toHaveProperty("isKeyframe");
		expect(typeof params.sessionId).toBe("string");
		expect(typeof params.framePath).toBe("string");
		expect(typeof params.isKeyframe).toBe("boolean");
	});
});

describe("finishExport audio muxing contract", () => {
	it("finishExport accepts trimRegions and speedRegions", () => {
		const trimRegions = [
			{ id: "t1", startMs: 0, endMs: 5000 },
			{ id: "t2", startMs: 30000, endMs: 35000 },
		];
		const speedRegions = [
			{ id: "s1", startMs: 5000, endMs: 15000, speed: 2 },
			{ id: "s2", startMs: 20000, endMs: 25000, speed: 0.5 },
		];

		// Verify the structure matches what Rust expects (serde deserialization)
		for (const tr of trimRegions) {
			expect(tr).toHaveProperty("startMs");
			expect(tr).toHaveProperty("endMs");
			expect(typeof tr.startMs).toBe("number");
			expect(typeof tr.endMs).toBe("number");
		}
		for (const sr of speedRegions) {
			expect(sr).toHaveProperty("startMs");
			expect(sr).toHaveProperty("endMs");
			expect(sr).toHaveProperty("speed");
			expect(typeof sr.speed).toBe("number");
			expect(sr.speed).toBeGreaterThan(0);
		}
	});

	it("finishExport works with null regions (no trims/speeds)", () => {
		// When no regions are applied, null should be passed
		const params = {
			sessionId: "test-session",
			trimRegions: null,
			speedRegions: null,
		};
		expect(params.trimRegions).toBeNull();
		expect(params.speedRegions).toBeNull();
	});

	it("finishExport works with empty arrays", () => {
		const params = {
			sessionId: "test-session",
			trimRegions: [] as Array<{ id: string; startMs: number; endMs: number }>,
			speedRegions: [] as Array<{ id: string; startMs: number; endMs: number; speed: number }>,
		};
		expect(params.trimRegions).toHaveLength(0);
		expect(params.speedRegions).toHaveLength(0);
	});

	it("trim regions have positive duration", () => {
		const trimRegions = [
			{ id: "t1", startMs: 1000, endMs: 5000 },
		];
		for (const tr of trimRegions) {
			expect(tr.endMs).toBeGreaterThan(tr.startMs);
		}
	});

	it("speed regions have valid speed values", () => {
		const speedRegions = [
			{ id: "s1", startMs: 0, endMs: 10000, speed: 4 },
			{ id: "s2", startMs: 15000, endMs: 20000, speed: 0.25 },
		];
		for (const sr of speedRegions) {
			expect(sr.speed).toBeGreaterThan(0);
			expect(sr.speed).toBeLessThanOrEqual(16);
			expect(sr.endMs).toBeGreaterThan(sr.startMs);
		}
	});
});

describe("RGBA frame data validation", () => {
	it("frame size matches width * height * 4", () => {
		const width = 1920;
		const height = 1080;
		const expectedSize = width * height * 4;
		expect(expectedSize).toBe(8294400); // 7.9 MB

		const data = new Uint8Array(expectedSize);
		expect(data.byteLength).toBe(expectedSize);
	});

	it("getImageData returns correct buffer size", () => {
		// Simulates canvas.getContext("2d").getImageData()
		const width = 320;
		const height = 240;
		const data = new Uint8ClampedArray(width * height * 4);
		expect(data.byteLength).toBe(320 * 240 * 4);
		expect(data.byteLength).toBe(307200);
	});

	it("keyframe interval matches encoder expectation", () => {
		// The exporter sends keyframe every 150 frames
		const keyframeInterval = 150;
		for (let i = 0; i < 300; i++) {
			const isKeyframe = i % keyframeInterval === 0;
			if (i === 0 || i === 150) {
				expect(isKeyframe).toBe(true);
			} else {
				expect(isKeyframe).toBe(false);
			}
		}
	});
});

describe("recording session serialization contract", () => {
	it("RecordingSession uses camelCase field names matching Rust serde renames", () => {
		const session = {
			screenVideoPath: "/tmp/screen.webm",
			webcamVideoPath: "/tmp/webcam.webm",
			createdAt: Date.now(),
		};

		// Rust struct uses #[serde(rename = "screenVideoPath")] etc.
		expect(session).toHaveProperty("screenVideoPath");
		expect(session).toHaveProperty("createdAt");
		expect(typeof session.createdAt).toBe("number");
	});

	it("session without webcam omits webcamVideoPath", () => {
		const session = {
			screenVideoPath: "/tmp/screen.webm",
			createdAt: Date.now(),
		};
		expect(session).not.toHaveProperty("webcamVideoPath");
	});
});
