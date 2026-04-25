import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		react(),
		// Electron plugin only loaded when NOT running under Tauri
		...(!isTauri
			? [
					(await import("vite-plugin-electron/simple")).default({
						main: {
							entry: "electron/main.ts",
							vite: { build: {} },
						},
						preload: {
							input: path.join(__dirname, "electron/preload.ts"),
						},
						renderer: process.env.NODE_ENV === "test" ? undefined : {},
					}),
				]
			: []),
	],

	clearScreen: false,

	server: {
		port: 5199,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},

	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},

	envPrefix: ["VITE_", "TAURI_ENV_*"],

	build: {
		target: isTauri
			? process.env.TAURI_ENV_PLATFORM === "windows"
				? "chrome105"
				: "safari13"
			: "esnext",
		minify: isTauri ? (!process.env.TAURI_ENV_DEBUG ? "esbuild" : false) : "esbuild",
		sourcemap: isTauri ? !!process.env.TAURI_ENV_DEBUG : false,
		rollupOptions: {
			output: {
				manualChunks: {
					pixi: ["pixi.js"],
					"react-vendor": ["react", "react-dom"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
});
