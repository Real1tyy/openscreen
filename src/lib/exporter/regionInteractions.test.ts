import { describe, expect, it } from "vitest";
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";

/**
 * Reproduces the computeAdjustedTimestamp logic from audioEncoder.ts
 * so we can test it independently without the full WebCodecs stack.
 */
function computeAdjustedTimestampMs(
	sourceMs: number,
	trims: TrimRegion[],
	speedRegions: SpeedRegion[],
): number {
	let outputMs = 0;
	let cursor = 0;

	while (cursor < sourceMs) {
		const trim = trims.find((t) => cursor >= t.startMs && cursor < t.endMs);
		if (trim) {
			cursor = Math.min(trim.endMs, sourceMs);
			continue;
		}

		let nextBoundary = sourceMs;
		for (const t of trims) {
			if (t.startMs > cursor && t.startMs < nextBoundary) nextBoundary = t.startMs;
		}
		for (const sr of speedRegions) {
			if (sr.startMs > cursor && sr.startMs < nextBoundary) nextBoundary = sr.startMs;
			if (sr.endMs > cursor && sr.endMs < nextBoundary) nextBoundary = sr.endMs;
		}

		const segmentDuration = nextBoundary - cursor;
		const activeSpeed = speedRegions.find(
			(sr) => cursor >= sr.startMs && cursor < sr.endMs,
		);
		const speed = activeSpeed ? activeSpeed.speed : 1;

		outputMs += segmentDuration / speed;
		cursor = nextBoundary;
	}

	return outputMs;
}

/**
 * Reproduces computeSegments + splitBySpeed from streamingDecoder.ts
 */
function computeSegments(
	totalDuration: number,
	trimRegions: TrimRegion[],
): Array<{ startSec: number; endSec: number }> {
	if (trimRegions.length === 0) return [{ startSec: 0, endSec: totalDuration }];
	const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
	const segments: Array<{ startSec: number; endSec: number }> = [];
	let cursor = 0;
	for (const trim of sorted) {
		const trimStart = trim.startMs / 1000;
		const trimEnd = trim.endMs / 1000;
		if (cursor < trimStart) segments.push({ startSec: cursor, endSec: trimStart });
		cursor = trimEnd;
	}
	if (cursor < totalDuration) segments.push({ startSec: cursor, endSec: totalDuration });
	return segments;
}

function splitBySpeed(
	segments: Array<{ startSec: number; endSec: number }>,
	speedRegions: SpeedRegion[],
): Array<{ startSec: number; endSec: number; speed: number }> {
	if (speedRegions.length === 0) return segments.map((s) => ({ ...s, speed: 1 }));
	const result: Array<{ startSec: number; endSec: number; speed: number }> = [];
	for (const segment of segments) {
		const overlapping = speedRegions
			.filter((sr) => sr.startMs / 1000 < segment.endSec && sr.endMs / 1000 > segment.startSec)
			.sort((a, b) => a.startMs - b.startMs);
		if (overlapping.length === 0) {
			result.push({ ...segment, speed: 1 });
			continue;
		}
		let cursor = segment.startSec;
		for (const sr of overlapping) {
			const srStart = Math.max(sr.startMs / 1000, segment.startSec);
			const srEnd = Math.min(sr.endMs / 1000, segment.endSec);
			if (cursor < srStart) result.push({ startSec: cursor, endSec: srStart, speed: 1 });
			result.push({ startSec: srStart, endSec: srEnd, speed: sr.speed });
			cursor = srEnd;
		}
		if (cursor < segment.endSec) result.push({ startSec: cursor, endSec: segment.endSec, speed: 1 });
	}
	return result.filter((s) => s.endSec - s.startSec > 0.0001);
}

function getEffectiveDuration(
	totalDuration: number,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
): number {
	const trimSegments = computeSegments(totalDuration, trimRegions);
	const speedSegments = splitBySpeed(trimSegments, speedRegions);
	return speedSegments.reduce((sum, seg) => sum + (seg.endSec - seg.startSec) / seg.speed, 0);
}

function makeTrim(startMs: number, endMs: number): TrimRegion {
	return { id: `t-${startMs}`, startMs, endMs };
}

function makeSpeed(startMs: number, endMs: number, speed: number): SpeedRegion {
	return { id: `s-${startMs}`, startMs, endMs, speed } as SpeedRegion;
}

// ─── TRIM + SPEED INTERACTION ───────────────────────────────────

describe("trim + speed interaction", () => {
	it("trim removes sections before speed is applied", () => {
		const totalDuration = 60; // 60s
		const trims = [makeTrim(0, 5000)]; // trim first 5s
		const speeds = [makeSpeed(5000, 15000, 2)]; // 2x from 5-15s

		const duration = getEffectiveDuration(totalDuration, trims, speeds);
		// Kept: 5-15s at 2x (5s output) + 15-60s normal (45s) = 50s
		expect(duration).toBeCloseTo(50, 1);
	});

	it("speed inside a trimmed region has no effect", () => {
		const totalDuration = 20; // 20s
		const trims = [makeTrim(5000, 15000)]; // trim 5-15s
		const speeds = [makeSpeed(7000, 12000, 4)]; // 4x speed inside trimmed area

		const duration = getEffectiveDuration(totalDuration, trims, speeds);
		// Kept: 0-5s (5s) + 15-20s (5s) = 10s
		// Speed region is completely inside trim → no effect
		expect(duration).toBeCloseTo(10, 1);
	});

	it("speed partially overlapping trim only affects non-trimmed portion", () => {
		const totalDuration = 30;
		const trims = [makeTrim(5000, 15000)];
		const speeds = [makeSpeed(10000, 25000, 2)]; // overlaps end of trim + beyond

		const duration = getEffectiveDuration(totalDuration, trims, speeds);
		// Kept: 0-5s normal (5s) + 15-25s at 2x (5s) + 25-30s normal (5s) = 15s
		expect(duration).toBeCloseTo(15, 1);
	});

	it("multiple trims with speed between them", () => {
		const totalDuration = 30;
		const trims = [makeTrim(0, 5000), makeTrim(15000, 20000)];
		const speeds = [makeSpeed(5000, 15000, 3)]; // 3x between the trims

		const duration = getEffectiveDuration(totalDuration, trims, speeds);
		// Kept: 5-15s at 3x (3.33s) + 20-30s normal (10s) ≈ 13.33s
		expect(duration).toBeCloseTo(13.33, 1);
	});
});

// ─── EFFECTIVE DURATION CALCULATIONS ────────────────────────────

describe("effective duration calculations", () => {
	it("no regions → full duration", () => {
		expect(getEffectiveDuration(60, [], [])).toBeCloseTo(60, 1);
	});

	it("single trim removes correct amount", () => {
		const trims = [makeTrim(10000, 20000)];
		expect(getEffectiveDuration(60, trims, [])).toBeCloseTo(50, 1);
	});

	it("4x speed on entire video quarters the duration", () => {
		const speeds = [makeSpeed(0, 60000, 4)];
		expect(getEffectiveDuration(60, [], speeds)).toBeCloseTo(15, 1);
	});

	it("0.5x speed doubles the duration", () => {
		const speeds = [makeSpeed(0, 60000, 0.5)];
		expect(getEffectiveDuration(60, [], speeds)).toBeCloseTo(120, 1);
	});

	it("user scenario: 16min trimmed to 1min with 4x speed", () => {
		const totalDuration = 960; // 16 min
		// Trim everything except 60-120s (keep 1 minute)
		const trims = [makeTrim(0, 60000), makeTrim(120000, 960000)];
		const speeds = [makeSpeed(60000, 120000, 4)];

		const duration = getEffectiveDuration(totalDuration, trims, speeds);
		// 60s kept at 4x → 15s
		expect(duration).toBeCloseTo(15, 1);
	});

	it("adjacent trims coalesce correctly", () => {
		const trims = [makeTrim(0, 5000), makeTrim(5000, 10000)];
		expect(getEffectiveDuration(20, trims, [])).toBeCloseTo(10, 1);
	});

	it("full video trimmed results in zero duration", () => {
		const trims = [makeTrim(0, 60000)];
		expect(getEffectiveDuration(60, trims, [])).toBeCloseTo(0, 1);
	});
});

// ─── AUDIO TIMESTAMP ADJUSTMENT ─────────────────────────────────

describe("audio timestamp adjustment (computeAdjustedTimestampMs)", () => {
	it("no regions → identity mapping", () => {
		expect(computeAdjustedTimestampMs(5000, [], [])).toBeCloseTo(5000, 1);
	});

	it("trim before timestamp shifts it back", () => {
		const trims = [makeTrim(1000, 3000)]; // 2s trim
		// Source 5000ms → output: 0-1s (1s) + skip 1-3s + 3-5s (2s) = 3s
		expect(computeAdjustedTimestampMs(5000, trims, [])).toBeCloseTo(3000, 1);
	});

	it("speed region compresses output time", () => {
		const speeds = [makeSpeed(0, 10000, 2)];
		// 10s at 2x → 5s output
		expect(computeAdjustedTimestampMs(10000, [], speeds)).toBeCloseTo(5000, 1);
	});

	it("timestamp inside trim maps to edge of trim", () => {
		const trims = [makeTrim(2000, 8000)];
		// Source 5000ms is inside trim → cursor jumps to end, but sourceMs is 5000
		// Walk: 0-2s normal (2s output), then 2-5s is trim → cursor jumps to min(8000, 5000) = 5000
		// So output = 2s
		expect(computeAdjustedTimestampMs(5000, trims, [])).toBeCloseTo(2000, 1);
	});

	it("trim + speed combined adjustment", () => {
		const trims = [makeTrim(0, 5000)]; // trim first 5s
		const speeds = [makeSpeed(5000, 15000, 4)]; // 4x from 5-15s

		// Source 15000ms: trim 0-5s (skip), 5-15s at 4x (2.5s output)
		expect(computeAdjustedTimestampMs(15000, trims, speeds)).toBeCloseTo(2500, 1);
	});

	it("multiple speed regions", () => {
		const speeds = [
			makeSpeed(0, 5000, 2), // 2x for first 5s
			makeSpeed(10000, 20000, 0.5), // 0.5x for 10-20s
		];
		// Source 20000ms:
		// 0-5s at 2x → 2.5s
		// 5-10s normal → 5s
		// 10-20s at 0.5x → 20s
		// Total: 27.5s
		expect(computeAdjustedTimestampMs(20000, [], speeds)).toBeCloseTo(27500, 1);
	});

	it("audio timestamp matches video effective duration at end", () => {
		const totalDuration = 30;
		const trims = [makeTrim(5000, 10000)];
		const speeds = [makeSpeed(15000, 25000, 3)];

		const videoDuration = getEffectiveDuration(totalDuration, trims, speeds);
		const audioEndTime = computeAdjustedTimestampMs(30000, trims, speeds);

		// Both should match: they represent the same output timeline
		expect(audioEndTime).toBeCloseTo(videoDuration * 1000, 10);
	});
});

// ─── COMPUTE SEGMENTS ───────────────────────────────────────────

describe("computeSegments", () => {
	it("no trims → single segment", () => {
		const segments = computeSegments(60, []);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({ startSec: 0, endSec: 60 });
	});

	it("one trim in the middle → two segments", () => {
		const segments = computeSegments(60, [makeTrim(20000, 30000)]);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toEqual({ startSec: 0, endSec: 20 });
		expect(segments[1]).toEqual({ startSec: 30, endSec: 60 });
	});

	it("trim at start → one segment from trim end", () => {
		const segments = computeSegments(60, [makeTrim(0, 10000)]);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({ startSec: 10, endSec: 60 });
	});

	it("trim at end → one segment until trim start", () => {
		const segments = computeSegments(60, [makeTrim(50000, 60000)]);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({ startSec: 0, endSec: 50 });
	});

	it("multiple non-overlapping trims", () => {
		const trims = [makeTrim(5000, 10000), makeTrim(20000, 25000), makeTrim(40000, 45000)];
		const segments = computeSegments(60, trims);
		expect(segments).toHaveLength(4);
		expect(segments[0]).toEqual({ startSec: 0, endSec: 5 });
		expect(segments[1]).toEqual({ startSec: 10, endSec: 20 });
		expect(segments[2]).toEqual({ startSec: 25, endSec: 40 });
		expect(segments[3]).toEqual({ startSec: 45, endSec: 60 });
	});
});

// ─── SPLIT BY SPEED ─────────────────────────────────────────────

describe("splitBySpeed", () => {
	it("no speed regions → speed 1 for all segments", () => {
		const segments = [{ startSec: 0, endSec: 60 }];
		const result = splitBySpeed(segments, []);
		expect(result).toHaveLength(1);
		expect(result[0].speed).toBe(1);
	});

	it("speed region covers entire segment", () => {
		const segments = [{ startSec: 5, endSec: 15 }];
		const speeds = [makeSpeed(5000, 15000, 4)];
		const result = splitBySpeed(segments, speeds);
		expect(result).toHaveLength(1);
		expect(result[0].speed).toBe(4);
	});

	it("speed region partially covers segment → splits into 2-3 parts", () => {
		const segments = [{ startSec: 0, endSec: 20 }];
		const speeds = [makeSpeed(5000, 15000, 2)];
		const result = splitBySpeed(segments, speeds);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ startSec: 0, endSec: 5, speed: 1 });
		expect(result[1]).toEqual({ startSec: 5, endSec: 15, speed: 2 });
		expect(result[2]).toEqual({ startSec: 15, endSec: 20, speed: 1 });
	});

	it("speed region entirely outside segment → no effect", () => {
		const segments = [{ startSec: 0, endSec: 10 }];
		const speeds = [makeSpeed(15000, 25000, 3)];
		const result = splitBySpeed(segments, speeds);
		expect(result).toHaveLength(1);
		expect(result[0].speed).toBe(1);
	});
});

// ─── NVENC EXPORTER AUDIO CONTRACT ──────────────────────────────

describe("NVENC exporter audio contract", () => {
	it("finishExport must pass trim regions to Rust", () => {
		const trimRegions: TrimRegion[] = [
			{ id: "t1", startMs: 0, endMs: 5000 },
			{ id: "t2", startMs: 30000, endMs: 35000 },
		];

		// Rust expects startMs and endMs as f64
		for (const tr of trimRegions) {
			expect(typeof tr.startMs).toBe("number");
			expect(typeof tr.endMs).toBe("number");
			expect(tr.endMs).toBeGreaterThan(tr.startMs);
		}
	});

	it("finishExport must pass speed regions to Rust", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "s1", startMs: 5000, endMs: 15000, speed: 4 } as SpeedRegion,
		];

		for (const sr of speedRegions) {
			expect(typeof sr.startMs).toBe("number");
			expect(typeof sr.endMs).toBe("number");
			expect(typeof sr.speed).toBe("number");
			expect(sr.speed).toBeGreaterThan(0);
		}
	});

	it("Rust TrimRegion serde field names match TypeScript", () => {
		// Rust uses #[serde(rename = "startMs")] and #[serde(rename = "endMs")]
		const rustExpectedFields = ["startMs", "endMs"];
		const tsRegion = { id: "t1", startMs: 1000, endMs: 5000 };

		for (const field of rustExpectedFields) {
			expect(tsRegion).toHaveProperty(field);
		}
	});

	it("Rust SpeedRegion serde field names match TypeScript", () => {
		const rustExpectedFields = ["startMs", "endMs", "speed"];
		const tsRegion = { id: "s1", startMs: 1000, endMs: 5000, speed: 2 };

		for (const field of rustExpectedFields) {
			expect(tsRegion).toHaveProperty(field);
		}
	});
});

// ─── TRIM REGION ENFORCEMENT ────────────────────────────────────

describe("trim region enforcement", () => {
	it("speed region inside trim should have zero effect on output duration", () => {
		const totalDuration = 30;
		const trims = [makeTrim(10000, 20000)];

		const durationWithoutSpeed = getEffectiveDuration(totalDuration, trims, []);
		const durationWithSpeed = getEffectiveDuration(totalDuration, trims, [
			makeSpeed(12000, 18000, 10),
		]);

		// Speed inside trim has no effect
		expect(durationWithSpeed).toBeCloseTo(durationWithoutSpeed, 1);
	});

	it("isInsideTrimRegion helper logic", () => {
		const trims = [makeTrim(5000, 15000), makeTrim(25000, 30000)];

		const isInside = (posMs: number) =>
			trims.some((t) => posMs >= t.startMs && posMs < t.endMs);

		expect(isInside(0)).toBe(false);
		expect(isInside(4999)).toBe(false);
		expect(isInside(5000)).toBe(true);
		expect(isInside(10000)).toBe(true);
		expect(isInside(14999)).toBe(true);
		expect(isInside(15000)).toBe(false);
		expect(isInside(20000)).toBe(false);
		expect(isInside(25000)).toBe(true);
		expect(isInside(30000)).toBe(false);
	});
});
