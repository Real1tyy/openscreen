import { expect, test } from "@playwright/test";
import {
	injectMockAPI,
} from "./helpers/fixtures";

const MOCK_SOURCES = [
	{
		id: "screen:0",
		name: "Display 1",
		display_id: "0",
		thumbnail: null,
		appIcon: null,
	},
	{
		id: "screen:1",
		name: "Display 2",
		display_id: "1",
		thumbnail: null,
		appIcon: null,
	},
	{
		id: "window:100",
		name: "Firefox",
		display_id: "",
		thumbnail: null,
		appIcon: null,
	},
];

test.describe("Source Selector", () => {
	test("9.1: Displays screens and windows", async ({ page }) => {
		await injectMockAPI(page, {
			overrides: { getSources: MOCK_SOURCES },
		});
		await page.goto("/?windowType=source-selector");

		await page.waitForTimeout(2_000);

		await expect(page.getByText("Screens (2)")).toBeVisible({
			timeout: 5_000,
		});

		await expect(page.getByText("Windows (1)")).toBeVisible();

		await page.getByText("Windows (1)").click();
		await page.waitForTimeout(300);

		await expect(page.getByText("Firefox")).toBeVisible();
	});
});
