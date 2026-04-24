// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MutableRefObject } from "react";
import type { SpeedRegion, TrimRegion } from "../types";
import { createVideoEventHandlers } from "./videoEventHandlers";

function createMockVideo(): HTMLVideoElement & {
	_listeners: Record<string, Function[]>;
	_simulateFrame: () => void;
} {
	const listeners: Record<string, Function[]> = {};
	const mock = {
		currentTime: 0,
		duration: 60,
		paused: true,
		ended: false,
		playbackRate: 1,
		_listeners: listeners,
		addEventListener: vi.fn((event: string, handler: Function) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(handler);
		}),
		removeEventListener: vi.fn(),
		pause: vi.fn(() => {
			mock.paused = true;
			listeners.pause?.forEach((h) => h());
		}),
		play: vi.fn(() => {
			mock.paused = false;
			listeners.play?.forEach((h) => h());
			return Promise.resolve();
		}),
		_simulateFrame: () => {},
	} as unknown as HTMLVideoElement & {
		_listeners: Record<string, Function[]>;
		_simulateFrame: () => void;
	};
	return mock;
}

function ref<T>(initial: T): MutableRefObject<T> {
	return { current: initial };
}

describe("createVideoEventHandlers", () => {
	let video: ReturnType<typeof createMockVideo>;
	let onPlayStateChange: ReturnType<typeof vi.fn>;
	let onTimeUpdate: ReturnType<typeof vi.fn>;
	let trimRegionsRef: MutableRefObject<TrimRegion[]>;
	let speedRegionsRef: MutableRefObject<SpeedRegion[]>;
	let loopRegionRef: MutableRefObject<{ startMs: number; endMs: number } | null>;
	let previewSpeedRef: MutableRefObject<number>;
	let isPlayingRef: MutableRefObject<boolean>;
	let timeUpdateAnimationRef: MutableRefObject<number | null>;

	beforeEach(() => {
		vi.stubGlobal("requestAnimationFrame", vi.fn((cb: () => void) => {
			video._simulateFrame = cb;
			return 1;
		}));
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		video = createMockVideo();
		onPlayStateChange = vi.fn();
		onTimeUpdate = vi.fn();
		trimRegionsRef = ref<TrimRegion[]>([]);
		speedRegionsRef = ref<SpeedRegion[]>([]);
		loopRegionRef = ref<{ startMs: number; endMs: number } | null>(null);
		previewSpeedRef = ref(1);
		isPlayingRef = ref(false);
		timeUpdateAnimationRef = ref<number | null>(null);
	});

	function createHandlers() {
		return createVideoEventHandlers({
			video,
			isSeekingRef: ref(false),
			isPlayingRef,
			allowPlaybackRef: ref(true),
			currentTimeRef: ref(0),
			timeUpdateAnimationRef,
			onPlayStateChange,
			onTimeUpdate,
			trimRegionsRef,
			speedRegionsRef,
			loopRegionRef,
			previewSpeedRef,
		});
	}

	describe("preview speed", () => {
		it("applies preview speed multiplier to playback rate", () => {
			previewSpeedRef.current = 2;
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 5;
			handlePlay();
			video._simulateFrame();

			expect(video.playbackRate).toBe(2);
		});

		it("multiplies preview speed with speed region", () => {
			previewSpeedRef.current = 2;
			speedRegionsRef.current = [{ id: "s1", startMs: 0, endMs: 10000, speed: 1.5 }];
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 5;
			handlePlay();
			video._simulateFrame();

			expect(video.playbackRate).toBe(3); // 1.5 * 2
		});

		it("defaults to 1x when no speed region active", () => {
			previewSpeedRef.current = 1;
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 5;
			handlePlay();
			video._simulateFrame();

			expect(video.playbackRate).toBe(1);
		});
	});

	describe("loop region", () => {
		it("seeks back to loop start when past loop end", () => {
			loopRegionRef.current = { startMs: 5000, endMs: 15000 };
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 15.5; // 15500ms, past loop end
			handlePlay();
			video._simulateFrame();

			expect(video.currentTime).toBe(5); // 5000ms
		});

		it("skips trim and loops back when trim skip goes past loop end", () => {
			trimRegionsRef.current = [{ id: "t1", startMs: 10000, endMs: 20000 }];
			loopRegionRef.current = { startMs: 5000, endMs: 15000 };
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 10.5; // Inside trim, skip to 20000ms which is past loop end
			handlePlay();
			video._simulateFrame();

			expect(video.currentTime).toBe(5); // Loops back to loop start
		});

		it("does not loop when no loop region set", () => {
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 50;
			handlePlay();
			video._simulateFrame();

			expect(video.currentTime).toBe(50); // Unchanged
		});

		it("still skips trim within loop boundaries", () => {
			trimRegionsRef.current = [{ id: "t1", startMs: 8000, endMs: 10000 }];
			loopRegionRef.current = { startMs: 5000, endMs: 15000 };
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 8.5; // Inside trim at 8500ms
			handlePlay();
			video._simulateFrame();

			expect(video.currentTime).toBe(10); // Skips to trim end (10000ms) which is within loop
		});
	});

	describe("trim region skipping", () => {
		it("skips past a trim region during playback", () => {
			trimRegionsRef.current = [{ id: "t1", startMs: 5000, endMs: 10000 }];
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 6; // 6000ms, inside trim
			handlePlay();
			video._simulateFrame();

			expect(video.currentTime).toBe(10); // Skipped to end
		});

		it("pauses when trim skip would go past video duration", () => {
			trimRegionsRef.current = [{ id: "t1", startMs: 55000, endMs: 70000 }];
			video.duration = 60;
			const { handlePlay } = createHandlers();

			video.paused = false;
			isPlayingRef.current = true;
			video.currentTime = 56; // Inside trim, endMs (70s) > duration (60s)
			handlePlay();
			video._simulateFrame();

			expect(video.pause).toHaveBeenCalled();
		});
	});

	describe("handlePlay", () => {
		it("sets isPlaying and emits state change", () => {
			const { handlePlay } = createHandlers();
			handlePlay();

			expect(isPlayingRef.current).toBe(true);
			expect(onPlayStateChange).toHaveBeenCalledWith(true);
		});
	});

	describe("handlePause", () => {
		it("clears isPlaying and emits state change", () => {
			isPlayingRef.current = true;
			const { handlePause } = createHandlers();
			handlePause();

			expect(isPlayingRef.current).toBe(false);
			expect(onPlayStateChange).toHaveBeenCalledWith(false);
		});
	});
});
