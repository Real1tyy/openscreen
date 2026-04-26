import { expect, test } from "@playwright/test";
import {
	navigateToHud,
	injectMockAPI,
} from "./helpers/fixtures";

test.describe("HUD Overlay", () => {
	test("8.1: HUD renders with controls", async ({ page }) => {
		await navigateToHud(page);
		await page.waitForTimeout(1_000);

		await expect(page.getByText("Screen").first()).toBeVisible({
			timeout: 5_000,
		});

		await expect(page.locator('[title="Hide HUD"]')).toBeVisible();
		await expect(page.locator('[title="Close App"]')).toBeVisible();
	});

	test("8.2: Source displayed in HUD", async ({ page }) => {
		await injectMockAPI(page, {
			overrides: {
				getSources: [
					{
						id: "screen:0",
						name: "Display 1",
						display_id: "0",
						thumbnail: null,
						appIcon: null,
					},
				],
				getSelectedSource: {
					id: "screen:0",
					name: "Display 1",
					display_id: "0",
					thumbnail: null,
					appIcon: null,
				},
			},
		});

		await page.goto("/?windowType=hud-overlay");
		await page.waitForTimeout(1_000);

		await expect(page.getByText("Display 1")).toBeVisible({
			timeout: 5_000,
		});
	});
});
