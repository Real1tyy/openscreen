import { expect, test } from "@playwright/test";
import {
	navigateToEditorWithVideo,
	navigateToEditorEmpty,
	injectMockAPI,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

test.describe("Editor Video Loading", () => {
	test("1.1: Editor renders with no video", async ({ page }) => {
		await navigateToEditorEmpty(page);

		await page.waitForSelector("text=Loading video...", {
			state: "hidden",
			timeout: 15_000,
		});

		await expect(
			page.getByText("No video to load"),
		).toBeVisible({ timeout: 5_000 });

		await expect(page.getByText("Load Project File")).toBeVisible();
	});

	test("1.2: Editor loads video from current session", async ({ page }) => {
		await navigateToEditorWithVideo(page, SAMPLE_VIDEO);

		// The hidden <video> element should have a blob: src
		const video = page.locator("video").first();
		await expect(video).toBeAttached({ timeout: 10_000 });
		const src = await video.getAttribute("src");
		expect(src).toBeTruthy();

		// Playback controls visible
		await expect(
			page.getByRole("button", { name: /Play|Pause/ }),
		).toBeVisible();

		// Export button visible (proves settings panel rendered)
		await expect(page.getByTestId("testId-export-button")).toBeVisible();

		// Pixi canvas should be rendering
		const canvas = page.locator("canvas").first();
		await expect(canvas).toBeVisible({ timeout: 10_000 });
	});

	test("1.3: Editor with no session shows error state", async ({ page }) => {
		await injectMockAPI(page);

		await page.goto("/?windowType=editor");

		await page.waitForSelector("text=Loading video...", {
			state: "hidden",
			timeout: 15_000,
		});

		await expect(
			page.getByText("No video to load"),
		).toBeVisible({ timeout: 5_000 });
	});
});
