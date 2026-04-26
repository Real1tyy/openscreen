import { expect, test } from "@playwright/test";
import {
	injectMockAPI,
	SAMPLE_VIDEO,
} from "./helpers/fixtures";

test.describe("Project Persistence", () => {
	test("7.1: Save project captures editor state", async ({ page }) => {
		await injectMockAPI(page, { videoFixture: SAMPLE_VIDEO });

		await page.addInitScript(() => {
			const api = (window as Record<string, unknown>)
				.electronAPI as Record<string, unknown>;
			api.saveProjectFile = (data: unknown) => {
				(window as Record<string, unknown>).__savedProject = data;
				return Promise.resolve({
					success: true,
					path: "/tmp/test-project.openscreen",
				});
			};
		});

		await page.goto("/?windowType=editor");
		await page.waitForSelector("text=Loading video...", {
			state: "hidden",
			timeout: 15_000,
		});

		await page.keyboard.press("z");
		await page.waitForTimeout(300);
		await page.keyboard.press("t");
		await page.waitForTimeout(300);

		const saveBtn = page.getByText("Save Project").first();
		await saveBtn.click();
		await page.waitForTimeout(500);

		const savedProjectData = await page.evaluate(
			() => (window as Record<string, unknown>).__savedProject,
		);
		expect(savedProjectData).not.toBeNull();
		expect(savedProjectData).toHaveProperty("media");
	});
});
