import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 120_000,
	retries: 0,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: "http://localhost:5199",
		launchOptions: {
			args: ["--enable-unsafe-swiftshader"],
		},
	},
	webServer: {
		command: "npm run dev:frontend",
		port: 5199,
		reuseExistingServer: true,
	},
});
