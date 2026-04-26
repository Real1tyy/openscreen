import { expect, test } from "@playwright/test";
import {
	navigateToEditorWithVideo,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

test.describe("Settings Panel", () => {
	test.beforeEach(async ({ page }) => {
		await navigateToEditorWithVideo(page, SAMPLE_VIDEO);
	});

	test("6.1: Background section visible", async ({ page }) => {
		const bgSection = page.getByText("Background");
		await expect(bgSection.first()).toBeVisible();
		await bgSection.first().click();
		await page.waitForTimeout(300);

		const wallpaperOptions = page.locator(
			'[class*="rounded"], [class*="cursor-pointer"]',
		);
		const count = await wallpaperOptions.count();
		expect(count).toBeGreaterThan(0);
	});
});
