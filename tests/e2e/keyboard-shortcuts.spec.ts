import { expect, test } from "@playwright/test";
import {
	navigateToEditorWithVideo,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

async function scrubTo(
	page: import("@playwright/test").Page,
	fraction: number,
) {
	const scrubber = page.locator('input[type="range"]').first();
	const box = await scrubber.boundingBox();
	if (!box) throw new Error("Scrubber not found");
	await page.mouse.click(
		box.x + box.width * fraction,
		box.y + box.height / 2,
	);
	await page.locator("canvas").first().click({ force: true });
	await page.waitForTimeout(200);
}

test.describe("Keyboard Shortcuts", () => {
	test.beforeEach(async ({ page }) => {
		await navigateToEditorWithVideo(page, SAMPLE_VIDEO);
	});

	test("3.1: Play/pause with Space", async ({ page }) => {
		await expect(
			page.getByRole("button", { name: "Play" }),
		).toBeVisible();

		await page.keyboard.press("Space");
		await expect(
			page.getByRole("button", { name: "Pause" }),
		).toBeVisible({ timeout: 3_000 });

		await page.keyboard.press("Space");
		await expect(
			page.getByRole("button", { name: "Play" }),
		).toBeVisible({ timeout: 3_000 });
	});

	test("3.3: Quick trim with I/O marks", async ({ page }) => {
		await scrubTo(page, 0.25);
		await page.keyboard.press("i");

		await expect(page.getByText(/Trim start:/)).toBeVisible({
			timeout: 5_000,
		});

		await scrubTo(page, 0.75);
		await page.keyboard.press("o");

		await expect(page.getByText("Delete Trim Region")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("3.4: Chapter markers and navigation", async ({ page }) => {
		await scrubTo(page, 0.1);
		await page.keyboard.press("c");
		await page.waitForTimeout(200);

		await scrubTo(page, 0.5);
		await page.keyboard.press("c");
		await page.waitForTimeout(200);

		await page.keyboard.press("[");
		await page.waitForTimeout(300);
		await page.keyboard.press("]");
		await page.waitForTimeout(300);
	});

	test("3.5: Delete selected zoom region", async ({ page }) => {
		await page.keyboard.press("z");
		await expect(page.getByText("Delete Zoom")).toBeVisible({
			timeout: 5_000,
		});

		await page.keyboard.press("Delete");
		await expect(page.getByText("Delete Zoom")).not.toBeVisible({
			timeout: 5_000,
		});
	});
});
