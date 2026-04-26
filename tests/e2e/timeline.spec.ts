import { expect, test } from "@playwright/test";
import {
	navigateToEditorWithVideo,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

test.describe("Timeline Regions", () => {
	test.beforeEach(async ({ page }) => {
		await navigateToEditorWithVideo(page, SAMPLE_VIDEO);
	});

	test("4.1: Create zoom region via Z key", async ({ page }) => {
		await page.keyboard.press("z");

		await expect(page.getByText("Delete Zoom")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("4.2: Create trim region via T key", async ({ page }) => {
		await page.keyboard.press("t");

		await expect(page.getByText("Delete Trim Region")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("4.3: Create speed region via S key", async ({ page }) => {
		await page.keyboard.press("s");

		await expect(page.getByText("Delete Speed Region")).toBeVisible({
			timeout: 5_000,
		});
	});
});
