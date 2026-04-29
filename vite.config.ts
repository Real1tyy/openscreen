import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],

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
		minify: isTauri ? (!process.env.TAURI_ENV_DEBUG ? true : false) : true,
		sourcemap: isTauri ? !!process.env.TAURI_ENV_DEBUG : false,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules/pixi.js") || id.includes("node_modules/pixi-filters")) {
						return "pixi";
					}
					if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
						return "react-vendor";
					}
					if (
						id.includes("node_modules/mediabunny") ||
						id.includes("node_modules/mp4box") ||
						id.includes("node_modules/@fix-webm-duration")
					) {
						return "video-processing";
					}
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
});
