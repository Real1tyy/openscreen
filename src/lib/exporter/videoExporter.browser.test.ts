import { describe, expect, it } from "vitest";
import sampleVideoUrl from "../../../tests/fixtures/sample.webm?url";
import sampleWithAudioUrl from "../../../tests/fixtures/sample-with-audio.webm?url";
import type { ExportProgress } from "./types";
import { VideoExporter } from "./videoExporter";

function isValidMp4(bytes: Uint8Array): boolean {
	return new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
}

function mp4HasAudioTrack(bytes: Uint8Array): boolean {
	const text = new TextDecoder("ascii", { fatal: false }).decode(bytes);
	return text.includes("mp4a") || text.includes("Opus") || text.includes("opus") || text.includes("esds");
}

describe("VideoExporter (real browser)", () => {
	it("exports a valid MP4 blob from a video-only source", async () => {
		const progressEvents: ExportProgress[] = [];

		const exporter = new VideoExporter({
			videoUrl: sampleVideoUrl,
			width: 320,
			height: 180,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "#1a1a2e",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			onProgress: (p) => progressEvents.push(p),
		});

		const result = await exporter.export();

		expect(result.success, result.error).toBe(true);
		expect(result.blob).toBeInstanceOf(Blob);

		const buf = await result.blob!.arrayBuffer();
		const bytes = new Uint8Array(buf);
		expect(isValidMp4(bytes)).toBe(true);

		expect(result.blob!.size).toBeGreaterThan(1024);

		expect(progressEvents.length).toBeGreaterThan(0);

		const finalizing = progressEvents.filter((p) => p.phase === "finalizing");
		expect(finalizing.length).toBeGreaterThan(0);
		expect(finalizing.at(-1)!.percentage).toBe(100);
	});

	it("exports MP4 with audio when source has an audio track", async () => {
		const exporter = new VideoExporter({
			videoUrl: sampleWithAudioUrl,
			width: 320,
			height: 240,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "#1a1a2e",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});

		const result = await exporter.export();

		expect(result.success, result.error).toBe(true);
		expect(result.blob).toBeInstanceOf(Blob);

		const buf = await result.blob!.arrayBuffer();
		const bytes = new Uint8Array(buf);
		expect(isValidMp4(bytes)).toBe(true);
		expect(result.blob!.size).toBeGreaterThan(1024);

		expect(mp4HasAudioTrack(bytes)).toBe(true);
	});

	it("exports MP4 with audio after trimming", async () => {
		const exporter = new VideoExporter({
			videoUrl: sampleWithAudioUrl,
			width: 320,
			height: 240,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "#1a1a2e",
			zoomRegions: [],
			trimRegions: [{ id: "t1", startMs: 0, endMs: 500 }],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});

		const result = await exporter.export();

		expect(result.success, result.error).toBe(true);
		expect(result.blob).toBeInstanceOf(Blob);

		const bytes = new Uint8Array(await result.blob!.arrayBuffer());
		expect(isValidMp4(bytes)).toBe(true);
		expect(mp4HasAudioTrack(bytes)).toBe(true);
	});

	it("exports MP4 with audio after speed adjustment", async () => {
		const exporter = new VideoExporter({
			videoUrl: sampleWithAudioUrl,
			width: 320,
			height: 240,
			frameRate: 15,
			bitrate: 1_000_000,
			wallpaper: "#1a1a2e",
			zoomRegions: [],
			speedRegions: [{ id: "s1", startMs: 0, endMs: 2000, speed: 2 } as import("@/components/video-editor/types").SpeedRegion],
			showShadow: false,
			shadowIntensity: 0,
			showBlur: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		});

		const result = await exporter.export();

		expect(result.success, result.error).toBe(true);
		expect(result.blob).toBeInstanceOf(Blob);

		const bytes = new Uint8Array(await result.blob!.arrayBuffer());
		expect(isValidMp4(bytes)).toBe(true);
		expect(mp4HasAudioTrack(bytes)).toBe(true);
	});
});
