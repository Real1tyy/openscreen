import { describe, it, expect } from "vitest";
import { getAssetPath } from "./assetPath";

describe("getAssetPath", () => {
	it("returns a root-relative path for simple filenames", async () => {
		expect(await getAssetPath("wallpapers/wallpaper1.jpg")).toBe("/wallpapers/wallpaper1.jpg");
	});

	it("strips leading slashes from input", async () => {
		expect(await getAssetPath("/wallpapers/wallpaper1.jpg")).toBe("/wallpapers/wallpaper1.jpg");
	});

	it("strips multiple leading slashes", async () => {
		expect(await getAssetPath("///wallpapers/wallpaper1.jpg")).toBe("/wallpapers/wallpaper1.jpg");
	});

	it("encodes special characters in path segments", async () => {
		expect(await getAssetPath("wallpapers/my image.jpg")).toBe("/wallpapers/my%20image.jpg");
	});

	it("handles nested paths", async () => {
		expect(await getAssetPath("wasm/ffmpeg/ffmpeg-core.wasm")).toBe("/wasm/ffmpeg/ffmpeg-core.wasm");
	});

	it("handles single filename", async () => {
		expect(await getAssetPath("favicon.ico")).toBe("/favicon.ico");
	});

	it("never returns asset:// URLs", async () => {
		const result = await getAssetPath("wallpapers/wallpaper1.jpg");
		expect(result).not.toContain("asset://");
	});

	it("never returns convertFileSrc-style paths", async () => {
		const result = await getAssetPath("wallpapers/wallpaper1.jpg");
		expect(result).not.toContain("_up_");
	});

	it("always starts with /", async () => {
		const result = await getAssetPath("wallpapers/wallpaper1.jpg");
		expect(result.startsWith("/")).toBe(true);
	});
});
