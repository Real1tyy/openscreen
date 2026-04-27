import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserPreferences, saveUserPreferences } from "./userPreferences";

const PREFS_KEY = "openscreen_user_preferences";

describe("loadUserPreferences", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("returns defaults when nothing is stored", () => {
		const prefs = loadUserPreferences();
		expect(prefs).toEqual({
			padding: 50,
			aspectRatio: "16:9",
			exportQuality: "good",
			exportFormat: "mp4",
			seekSmallSeconds: 10,
			seekLargeSeconds: 60,
			defaultZoomDurationMs: 5000,
			defaultTrimDurationMs: 5000,
			defaultSpeedDurationMs: 5000,
		});
	});

	it("loads valid stored preferences", () => {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({
				padding: 30,
				aspectRatio: "1:1",
				exportQuality: "source",
				exportFormat: "gif",
			}),
		);
		const prefs = loadUserPreferences();
		expect(prefs.padding).toBe(30);
		expect(prefs.aspectRatio).toBe("1:1");
		expect(prefs.exportQuality).toBe("source");
		expect(prefs.exportFormat).toBe("gif");
	});

	it("returns defaults for invalid JSON", () => {
		localStorage.setItem(PREFS_KEY, "not json");
		const prefs = loadUserPreferences();
		expect(prefs.padding).toBe(50);
	});

	it("returns defaults for non-object JSON", () => {
		localStorage.setItem(PREFS_KEY, '"just a string"');
		const prefs = loadUserPreferences();
		expect(prefs.padding).toBe(50);
	});

	it("uses default for invalid padding (negative)", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ padding: -10 }));
		expect(loadUserPreferences().padding).toBe(50);
	});

	it("uses default for invalid padding (>100)", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ padding: 150 }));
		expect(loadUserPreferences().padding).toBe(50);
	});

	it("uses default for non-number padding", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ padding: "hello" }));
		expect(loadUserPreferences().padding).toBe(50);
	});

	it("uses default for NaN padding", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ padding: null }));
		expect(loadUserPreferences().padding).toBe(50);
	});

	it("uses default for invalid aspectRatio", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ aspectRatio: "3:2" }));
		expect(loadUserPreferences().aspectRatio).toBe("16:9");
	});

	it("accepts all valid aspect ratios", () => {
		for (const ar of ["16:9", "9:16", "1:1", "4:3", "4:5", "16:10", "10:16", "native"]) {
			localStorage.setItem(PREFS_KEY, JSON.stringify({ aspectRatio: ar }));
			expect(loadUserPreferences().aspectRatio).toBe(ar);
		}
	});

	it("uses default for invalid exportQuality", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ exportQuality: "ultra" }));
		expect(loadUserPreferences().exportQuality).toBe("good");
	});

	it("accepts valid exportQuality values", () => {
		for (const q of ["medium", "good", "source"]) {
			localStorage.setItem(PREFS_KEY, JSON.stringify({ exportQuality: q }));
			expect(loadUserPreferences().exportQuality).toBe(q);
		}
	});

	it("uses default for invalid exportFormat", () => {
		localStorage.setItem(PREFS_KEY, JSON.stringify({ exportFormat: "webm" }));
		expect(loadUserPreferences().exportFormat).toBe("mp4");
	});

	it("accepts valid exportFormat values", () => {
		for (const f of ["mp4", "gif"]) {
			localStorage.setItem(PREFS_KEY, JSON.stringify({ exportFormat: f }));
			expect(loadUserPreferences().exportFormat).toBe(f);
		}
	});

	it("mixes valid and invalid fields correctly", () => {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({
				padding: 75,
				aspectRatio: "invalid",
				exportQuality: "source",
				exportFormat: "avi",
			}),
		);
		const prefs = loadUserPreferences();
		expect(prefs.padding).toBe(75);
		expect(prefs.aspectRatio).toBe("16:9");
		expect(prefs.exportQuality).toBe("source");
		expect(prefs.exportFormat).toBe("mp4");
	});
});

describe("saveUserPreferences", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("saves a full set of preferences", () => {
		saveUserPreferences({
			padding: 30,
			aspectRatio: "1:1",
			exportQuality: "medium",
			exportFormat: "gif",
		});
		const stored = JSON.parse(localStorage.getItem(PREFS_KEY)!);
		expect(stored.padding).toBe(30);
		expect(stored.aspectRatio).toBe("1:1");
		expect(stored.exportQuality).toBe("medium");
		expect(stored.exportFormat).toBe("gif");
	});

	it("merges partial update with existing preferences", () => {
		saveUserPreferences({ padding: 30 });
		saveUserPreferences({ aspectRatio: "4:3" });
		const stored = JSON.parse(localStorage.getItem(PREFS_KEY)!);
		expect(stored.padding).toBe(30);
		expect(stored.aspectRatio).toBe("4:3");
	});

	it("survives localStorage setItem throwing", () => {
		const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("quota exceeded");
		});
		expect(() => saveUserPreferences({ padding: 80 })).not.toThrow();
		spy.mockRestore();
	});
});
