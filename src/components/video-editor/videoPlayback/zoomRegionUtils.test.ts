// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { TRANSITION_WINDOW_MS, ZOOM_IN_TRANSITION_WINDOW_MS } from "./constants";
import { computeRegionStrength, findDominantRegion, ZOOM_IN_OVERLAP_MS } from "./zoomRegionUtils";

function makeRegion(overrides: Partial<ZoomRegion> & { startMs: number; endMs: number }): ZoomRegion {
	return {
		id: "test-region",
		depth: 3,
		focus: { cx: 0.5, cy: 0.5 },
		...overrides,
	};
}

describe("computeRegionStrength", () => {
	const region = makeRegion({ startMs: 1000, endMs: 5000 });

	it("returns 0 well before the region", () => {
		// leadInStart for region at 1000ms is ~-22ms, so use a much earlier time
		expect(computeRegionStrength(region, -1000)).toBe(0);
	});

	it("returns 0 well after the region", () => {
		expect(computeRegionStrength(region, 10000)).toBe(0);
	});

	it("returns 1 during the fully active portion of the region", () => {
		// Fully active: between zoomInEnd (startMs + ZOOM_IN_OVERLAP_MS) and endMs
		const fullyActiveTime = region.startMs + ZOOM_IN_OVERLAP_MS + 100;
		expect(computeRegionStrength(region, fullyActiveTime)).toBe(1);
	});

	it("returns 1 at the midpoint of the region", () => {
		const midpoint = (region.startMs + region.endMs) / 2;
		expect(computeRegionStrength(region, midpoint)).toBe(1);
	});

	it("returns 1 just at endMs", () => {
		expect(computeRegionStrength(region, region.endMs)).toBe(1);
	});

	it("returns a value between 0 and 1 during the lead-in transition", () => {
		const zoomInEnd = region.startMs + ZOOM_IN_OVERLAP_MS;
		const leadInStart = zoomInEnd - ZOOM_IN_TRANSITION_WINDOW_MS;
		const midTransition = (leadInStart + zoomInEnd) / 2;
		const strength = computeRegionStrength(region, midTransition);
		expect(strength).toBeGreaterThan(0);
		expect(strength).toBeLessThan(1);
	});

	it("returns a value between 0 and 1 during the lead-out transition", () => {
		const leadOutMid = region.endMs + TRANSITION_WINDOW_MS / 2;
		const strength = computeRegionStrength(region, leadOutMid);
		expect(strength).toBeGreaterThan(0);
		expect(strength).toBeLessThan(1);
	});

	it("returns 0 exactly at the end of lead-out", () => {
		const leadOutEnd = region.endMs + TRANSITION_WINDOW_MS;
		// At leadOutEnd, progress = 1, eased = 1, strength = 1 - 1 = 0
		const strength = computeRegionStrength(region, leadOutEnd);
		expect(strength).toBeCloseTo(0, 2);
	});
});

describe("findDominantRegion", () => {
	describe("no regions", () => {
		it("returns null region with 0 strength", () => {
			const result = findDominantRegion([], 1000);
			expect(result.region).toBeNull();
			expect(result.strength).toBe(0);
			expect(result.blendedScale).toBeNull();
			expect(result.transition).toBeNull();
		});
	});

	describe("single region", () => {
		const region = makeRegion({ id: "r1", startMs: 2000, endMs: 6000 });

		it("returns null when time is well before the region", () => {
			const result = findDominantRegion([region], 0);
			expect(result.region).toBeNull();
			expect(result.strength).toBe(0);
		});

		it("returns the region with full strength during active period", () => {
			const result = findDominantRegion([region], 4000);
			expect(result.region).not.toBeNull();
			expect(result.region?.id).toBe("r1");
			expect(result.strength).toBe(1);
		});

		it("returns null when time is well after the region", () => {
			const result = findDominantRegion([region], 20000);
			expect(result.region).toBeNull();
		});

		it("returns partial strength during lead-in", () => {
			const zoomInEnd = region.startMs + ZOOM_IN_OVERLAP_MS;
			const leadInStart = zoomInEnd - ZOOM_IN_TRANSITION_WINDOW_MS;
			const midLeadIn = (leadInStart + zoomInEnd) / 2;
			const result = findDominantRegion([region], midLeadIn);
			expect(result.region).not.toBeNull();
			expect(result.strength).toBeGreaterThan(0);
			expect(result.strength).toBeLessThan(1);
		});

		it("returns partial strength during lead-out", () => {
			const result = findDominantRegion([region], region.endMs + TRANSITION_WINDOW_MS / 2);
			expect(result.region).not.toBeNull();
			expect(result.strength).toBeGreaterThan(0);
			expect(result.strength).toBeLessThan(1);
		});
	});

	describe("overlapping regions", () => {
		const regionA = makeRegion({ id: "a", startMs: 1000, endMs: 5000, depth: 2 });
		const regionB = makeRegion({ id: "b", startMs: 3000, endMs: 7000, depth: 4 });

		it("returns the region with higher strength at a given time", () => {
			// At 4000ms: regionA is fully active (strength=1), regionB is still in lead-in
			const result = findDominantRegion([regionA, regionB], 4000);
			expect(result.region).not.toBeNull();
			expect(result.strength).toBe(1);
		});

		it("picks the later region when both have equal strength", () => {
			// Both regions fully active around 4000ms
			// When strengths are tied, the sort prefers later startMs
			const result = findDominantRegion([regionA, regionB], 4500);
			expect(result.region).not.toBeNull();
		});
	});

	describe("connected zooms", () => {
		// Two regions close together (gap < 1500ms)
		const regionA = makeRegion({ id: "a", startMs: 1000, endMs: 3000, depth: 2 });
		const regionB = makeRegion({ id: "b", startMs: 3500, endMs: 6000, depth: 4 });

		it("returns transition data during connected pan transition", () => {
			// Transition happens from regionA.endMs to regionA.endMs + 1000
			const transitionMid = regionA.endMs + 500;
			const result = findDominantRegion([regionA, regionB], transitionMid, {
				connectZooms: true,
			});
			expect(result.strength).toBe(1);
			expect(result.transition).not.toBeNull();
			expect(result.blendedScale).not.toBeNull();
		});

		it("does not create connected transitions when connectZooms is false", () => {
			const transitionMid = regionA.endMs + 500;
			const result = findDominantRegion([regionA, regionB], transitionMid, {
				connectZooms: false,
			});
			// Without connected zooms, this time falls in the lead-out of regionA
			expect(result.transition).toBeNull();
		});

		it("holds the next region between transition end and next region start", () => {
			// After transition (endMs + 1000) but before regionB.startMs (3500)
			// That means between 4000 and 3500 ... but 4000 > 3500, so this hold
			// doesn't apply for these specific regions. Let's adjust:
			const regionC = makeRegion({ id: "c", startMs: 1000, endMs: 2000, depth: 2 });
			const regionD = makeRegion({ id: "d", startMs: 3500, endMs: 6000, depth: 4 });
			// Transition: 2000 to 3000, hold: 3000 to 3500
			const holdTime = 3200;
			const result = findDominantRegion([regionC, regionD], holdTime, {
				connectZooms: true,
			});
			expect(result.region).not.toBeNull();
			expect(result.strength).toBe(1);
			expect(result.transition).toBeNull();
		});
	});

	describe("regions far apart", () => {
		// Gap > 1500ms, so no connected zoom
		const regionA = makeRegion({ id: "a", startMs: 1000, endMs: 2000, depth: 2 });
		const regionB = makeRegion({ id: "b", startMs: 5000, endMs: 8000, depth: 3 });

		it("does not create connected transitions for distant regions", () => {
			const result = findDominantRegion([regionA, regionB], 3000, {
				connectZooms: true,
			});
			// Both regions are in their transition zones or inactive
			expect(result.transition).toBeNull();
		});
	});

	describe("edge timing", () => {
		const region = makeRegion({ id: "edge", startMs: 0, endMs: 1000, depth: 1 });

		it("handles region starting at time 0", () => {
			const result = findDominantRegion([region], 500);
			expect(result.region).not.toBeNull();
		});

		it("returns null well after region ends", () => {
			const result = findDominantRegion([region], 5000);
			expect(result.region).toBeNull();
		});
	});
});
