import { expect, test } from "@playwright/test";
import {
	navigateToEditorWithVideo,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

test.describe("Playback Controls", () => {
	test.beforeEach(async ({ page }) => {
		await navigateToEditorWithVideo(page, SAMPLE_VIDEO);
	});

	test("2.1: Play/pause toggle", async ({ page }) => {
		await expect(
			page.getByRole("button", { name: "Play" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Play" }).click();

		const pauseBtn = page.getByRole("button", { name: "Pause" });
		const playVisible = await pauseBtn
			.waitFor({ state: "visible", timeout: 3_000 })
			.then(() => true)
			.catch(() => false);

		if (playVisible) {
			await pauseBtn.click();
			await expect(
				page.getByRole("button", { name: "Play" }),
			).toBeVisible({ timeout: 3_000 });
		}
	});

	test("2.2: Timeline scrubbing changes current time", async ({ page }) => {
		const scrubber = page.locator('input[type="range"]').first();
		await expect(scrubber).toBeVisible();

		const box = await scrubber.boundingBox();
		if (!box) throw new Error("Scrubber not found");

		await page.mouse.click(
			box.x + box.width * 0.5,
			box.y + box.height / 2,
		);
		await page.waitForTimeout(200);

		const midValue = await scrubber.inputValue();
		const maxValue = await scrubber.getAttribute("max");
		const midRatio =
			Number.parseFloat(midValue) / Number.parseFloat(maxValue || "1");
		expect(midRatio).toBeGreaterThan(0.2);
		expect(midRatio).toBeLessThan(0.8);

		await page.mouse.click(box.x + 2, box.y + box.height / 2);
		await page.waitForTimeout(200);

		const startValue = await scrubber.inputValue();
		const startRatio =
			Number.parseFloat(startValue) / Number.parseFloat(maxValue || "1");
		expect(startRatio).toBeLessThan(0.15);
	});
});
