import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	generateFontId,
	getCustomFonts,
	isValidGoogleFontsUrl,
	parseFontFamilyFromImport,
	removeCustomFont,
	saveCustomFonts,
	type CustomFont,
} from "./customFonts";

describe("generateFontId", () => {
	it("lowercases and replaces spaces with hyphens", () => {
		const id = generateFontId("Open Sans");
		expect(id).toMatch(/^open-sans-\d+$/);
	});

	it("collapses multiple spaces", () => {
		const id = generateFontId("Noto  Sans  JP");
		expect(id).toMatch(/^noto-sans-jp-\d+$/);
	});

	it("appends a timestamp for uniqueness", () => {
		const a = generateFontId("Roboto");
		const b = generateFontId("Roboto");
		expect(a).toMatch(/^roboto-\d+$/);
		expect(b).toMatch(/^roboto-\d+$/);
	});
});

describe("parseFontFamilyFromImport", () => {
	it("extracts family name from a standard Google Fonts URL", () => {
		expect(
			parseFontFamilyFromImport(
				"https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap",
			),
		).toBe("Roboto");
	});

	it("replaces + with spaces", () => {
		expect(
			parseFontFamilyFromImport(
				"https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
			),
		).toBe("Open Sans");
	});

	it("strips weight/style specifiers", () => {
		expect(
			parseFontFamilyFromImport(
				"https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;1,700",
			),
		).toBe("Lato");
	});

	it("returns null for URL without family param", () => {
		expect(parseFontFamilyFromImport("https://fonts.googleapis.com/css2?display=swap")).toBeNull();
	});

	it("returns null for invalid URL", () => {
		expect(parseFontFamilyFromImport("not-a-url")).toBeNull();
	});
});

describe("isValidGoogleFontsUrl", () => {
	it("accepts valid Google Fonts URL", () => {
		expect(
			isValidGoogleFontsUrl(
				"https://fonts.googleapis.com/css2?family=Roboto&display=swap",
			),
		).toBe(true);
	});

	it("rejects URL without family param", () => {
		expect(
			isValidGoogleFontsUrl("https://fonts.googleapis.com/css2?display=swap"),
		).toBe(false);
	});

	it("rejects non-Google Fonts host", () => {
		expect(isValidGoogleFontsUrl("https://example.com/css2?family=Roboto")).toBe(false);
	});

	it("rejects invalid URL strings", () => {
		expect(isValidGoogleFontsUrl("not-a-url")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(isValidGoogleFontsUrl("")).toBe(false);
	});
});

describe("getCustomFonts / saveCustomFonts", () => {
	let store: Record<string, string>;

	beforeEach(() => {
		store = {};
		vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => store[key] ?? null);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, val) => {
			store[key] = val;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns empty array when nothing stored", () => {
		expect(getCustomFonts()).toEqual([]);
	});

	it("returns saved fonts", () => {
		const fonts: CustomFont[] = [
			{ id: "roboto-1", name: "Roboto", fontFamily: "Roboto", importUrl: "https://fonts.googleapis.com/css2?family=Roboto" },
		];
		saveCustomFonts(fonts);
		expect(getCustomFonts()).toEqual(fonts);
	});

	it("returns empty array on parse error", () => {
		store.openscreen_custom_fonts = "not-json";
		expect(getCustomFonts()).toEqual([]);
	});
});

describe("removeCustomFont", () => {
	let store: Record<string, string>;

	beforeEach(() => {
		store = {};
		vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => store[key] ?? null);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, val) => {
			store[key] = val;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes the font by id and returns remaining", () => {
		const fonts: CustomFont[] = [
			{ id: "a", name: "A", fontFamily: "A", importUrl: "url-a" },
			{ id: "b", name: "B", fontFamily: "B", importUrl: "url-b" },
		];
		saveCustomFonts(fonts);
		const remaining = removeCustomFont("a");
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe("b");
	});

	it("handles removing non-existent font gracefully", () => {
		const fonts: CustomFont[] = [
			{ id: "a", name: "A", fontFamily: "A", importUrl: "url-a" },
		];
		saveCustomFonts(fonts);
		const remaining = removeCustomFont("nonexistent");
		expect(remaining).toHaveLength(1);
	});
});
