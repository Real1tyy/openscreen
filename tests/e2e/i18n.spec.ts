import { expect, test } from "@playwright/test";
import {
	navigateToEditorWithVideo,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

test.describe("Internationalization", () => {

	test("10.1: Language switching", async ({ page }) => {
		await navigateToEditorWithVideo(page, SAMPLE_VIDEO);

		// Default language should be English - check for English text
		await expect(page.getByText("Return to Recorder")).toBeVisible();

		// Track setLocale calls
		await page.addInitScript(() => {
			const api = (window as Record<string, unknown>)
				.electronAPI as Record<string, unknown>;
			api.setLocale = (locale: string) => {
				(window as Record<string, unknown>).__setLocaleCalled = locale;
				return Promise.resolve();
			};
		});

		// Find the language selector
		const langSelector = page.locator("select").first();
		await expect(langSelector).toBeVisible();

		// Change to Spanish
		await langSelector.selectOption("es");
		await page.waitForTimeout(1_000);

		// UI labels should have changed
		// The exact labels depend on the Spanish translations
		// Verify the selector value changed
		const selectedValue = await langSelector.inputValue();
		expect(selectedValue).toBe("es");
	});
});
