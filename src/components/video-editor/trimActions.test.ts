// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	computeEndFromNow,
	computeLoopRegion,
	computeStartFromNow,
	findAdjacentAfter,
	findAdjacentBefore,
	mergeOverlapping,
	mergeOverlappingSpeeds,
} from "./trimActions";
import type { SpeedRegion, TrimRegion } from "./types";

const trim = (id: string, startMs: number, endMs: number): TrimRegion => ({
	id,
	startMs,
	endMs,
});

describe("computeStartFromNow", () => {
	it("moves start to current playhead", () => {
		expect(computeStartFromNow(trim("t1", 5000, 10000), 7000)).toBe(7000);
	});

	it("clamps to maintain minimum 100ms duration", () => {
		expect(computeStartFromNow(trim("t1", 5000, 10000), 9950)).toBe(9900);
	});

	it("clamps to 0 for negative values", () => {
		expect(computeStartFromNow(trim("t1", 5000, 10000), -1000)).toBe(0);
	});

	it("allows moving start earlier", () => {
		expect(computeStartFromNow(trim("t1", 5000, 10000), 2000)).toBe(2000);
	});
});

describe("computeEndFromNow", () => {
	it("moves end to current playhead", () => {
		expect(computeEndFromNow(trim("t1", 5000, 10000), 8000)).toBe(8000);
	});

	it("clamps to maintain minimum 100ms duration", () => {
		expect(computeEndFromNow(trim("t1", 5000, 10000), 5050)).toBe(5100);
	});

	it("allows moving end later", () => {
		expect(computeEndFromNow(trim("t1", 5000, 10000), 15000)).toBe(15000);
	});
});

describe("findAdjacentBefore", () => {
	it("finds the closest preceding trim", () => {
		const regions = [trim("t1", 1000, 3000), trim("t2", 5000, 8000), trim("t3", 10000, 15000)];
		const result = findAdjacentBefore("t3", regions);
		expect(result?.id).toBe("t2");
	});

	it("returns null when no preceding trim exists", () => {
		const regions = [trim("t1", 1000, 3000), trim("t2", 5000, 8000)];
		const result = findAdjacentBefore("t1", regions);
		expect(result).toBeNull();
	});

	it("returns the nearest preceding trim, not the farthest", () => {
		const regions = [
			trim("t1", 0, 1000),
			trim("t2", 2000, 4000),
			trim("t3", 5000, 6000),
			trim("t4", 10000, 15000),
		];
		const result = findAdjacentBefore("t4", regions);
		expect(result?.id).toBe("t3");
	});

	it("returns null when target trim does not exist", () => {
		const regions = [trim("t1", 1000, 3000)];
		const result = findAdjacentBefore("missing", regions);
		expect(result).toBeNull();
	});

	it("ignores trims that overlap with the target", () => {
		const regions = [
			trim("t1", 1000, 6000), // endMs > t2.startMs, so overlaps
			trim("t2", 5000, 8000),
		];
		const result = findAdjacentBefore("t2", regions);
		expect(result).toBeNull();
	});
});

describe("findAdjacentAfter", () => {
	it("finds the closest following trim", () => {
		const regions = [trim("t1", 1000, 3000), trim("t2", 5000, 8000), trim("t3", 10000, 15000)];
		const result = findAdjacentAfter("t1", regions);
		expect(result?.id).toBe("t2");
	});

	it("returns null when no following trim exists", () => {
		const regions = [trim("t1", 1000, 3000), trim("t2", 5000, 8000)];
		const result = findAdjacentAfter("t2", regions);
		expect(result).toBeNull();
	});

	it("returns the nearest following trim", () => {
		const regions = [
			trim("t1", 0, 1000),
			trim("t2", 3000, 4000),
			trim("t3", 6000, 8000),
			trim("t4", 10000, 15000),
		];
		const result = findAdjacentAfter("t1", regions);
		expect(result?.id).toBe("t2");
	});

	it("returns null when target trim does not exist", () => {
		const regions = [trim("t1", 1000, 3000)];
		const result = findAdjacentAfter("missing", regions);
		expect(result).toBeNull();
	});
});

describe("mergeOverlapping", () => {
	it("merges a fully encompassed trim", () => {
		const _regions = [trim("t1", 30000, 60000), trim("t2", 70000, 90000)];
		// t1 extended to 100000, encompassing t2
		const extended = [trim("t1", 30000, 100000), trim("t2", 70000, 90000)];
		const { merged, absorbedIds } = mergeOverlapping("t1", extended);
		expect(absorbedIds).toEqual(["t2"]);
		expect(merged).toEqual([{ id: "t1", startMs: 30000, endMs: 100000 }]);
	});

	it("merges a partially overlapping trim", () => {
		const regions = [trim("t1", 30000, 80000), trim("t2", 70000, 120000)];
		const { merged, absorbedIds } = mergeOverlapping("t1", regions);
		expect(absorbedIds).toEqual(["t2"]);
		expect(merged).toEqual([{ id: "t1", startMs: 30000, endMs: 120000 }]);
	});

	it("merges multiple overlapping trims", () => {
		const regions = [trim("t1", 30000, 100000), trim("t2", 70000, 90000), trim("t3", 85000, 95000)];
		const { merged, absorbedIds } = mergeOverlapping("t1", regions);
		expect(absorbedIds).toEqual(["t2", "t3"]);
		expect(merged).toEqual([{ id: "t1", startMs: 30000, endMs: 100000 }]);
	});

	it("returns unchanged when no overlaps", () => {
		const regions = [trim("t1", 30000, 60000), trim("t2", 70000, 90000)];
		const { merged, absorbedIds } = mergeOverlapping("t1", regions);
		expect(absorbedIds).toEqual([]);
		expect(merged).toBe(regions);
	});

	it("returns unchanged for missing target", () => {
		const regions = [trim("t1", 30000, 60000)];
		const { merged, absorbedIds } = mergeOverlapping("missing", regions);
		expect(absorbedIds).toEqual([]);
		expect(merged).toBe(regions);
	});

	it("extends target span when absorbed trim reaches further", () => {
		const regions = [trim("t1", 30000, 80000), trim("t2", 60000, 120000)];
		const { merged } = mergeOverlapping("t1", regions);
		expect(merged[0]).toEqual({ id: "t1", startMs: 30000, endMs: 120000 });
	});

	it("extends target start when merging earlier trim", () => {
		const regions = [trim("t1", 20000, 90000), trim("t2", 10000, 50000)];
		const { merged } = mergeOverlapping("t1", regions);
		expect(merged[0]).toEqual({ id: "t1", startMs: 10000, endMs: 90000 });
	});
});

describe("computeLoopRegion", () => {
	it("creates a loop region with 5s padding around trim", () => {
		const result = computeLoopRegion(trim("t1", 10000, 20000), 60000);
		expect(result).toEqual({ startMs: 5000, endMs: 25000 });
	});

	it("clamps start to 0", () => {
		const result = computeLoopRegion(trim("t1", 2000, 8000), 60000);
		expect(result).toEqual({ startMs: 0, endMs: 13000 });
	});

	it("clamps end to total duration", () => {
		const result = computeLoopRegion(trim("t1", 55000, 59000), 60000);
		expect(result).toEqual({ startMs: 50000, endMs: 60000 });
	});

	it("clamps both when trim is at boundaries", () => {
		const result = computeLoopRegion(trim("t1", 1000, 4000), 5000);
		expect(result).toEqual({ startMs: 0, endMs: 5000 });
	});

	it("supports custom padding", () => {
		const result = computeLoopRegion(trim("t1", 10000, 20000), 60000, 3000);
		expect(result).toEqual({ startMs: 7000, endMs: 23000 });
	});
});

const speed = (id: string, startMs: number, endMs: number, s: number): SpeedRegion => ({
	id,
	startMs,
	endMs,
	speed: s,
});

describe("mergeOverlappingSpeeds", () => {
	it("merges overlapping speeds with same value", () => {
		const regions = [speed("s1", 0, 5000, 2), speed("s2", 3000, 8000, 2)];
		const { merged, absorbedIds } = mergeOverlappingSpeeds("s1", regions);
		expect(absorbedIds).toEqual(["s2"]);
		expect(merged).toEqual([{ id: "s1", startMs: 0, endMs: 8000, speed: 2 }]);
	});

	it("does not merge overlapping speeds with different values", () => {
		const regions = [speed("s1", 0, 5000, 2), speed("s2", 3000, 8000, 3)];
		const { merged, absorbedIds } = mergeOverlappingSpeeds("s1", regions);
		expect(absorbedIds).toEqual([]);
		expect(merged).toBe(regions);
	});

	it("merges multiple same-speed regions", () => {
		const regions = [
			speed("s1", 0, 10000, 1.5),
			speed("s2", 5000, 7000, 1.5),
			speed("s3", 8000, 15000, 1.5),
		];
		const { merged, absorbedIds } = mergeOverlappingSpeeds("s1", regions);
		expect(absorbedIds).toEqual(["s2", "s3"]);
		expect(merged).toEqual([{ id: "s1", startMs: 0, endMs: 15000, speed: 1.5 }]);
	});

	it("only merges same-speed among mixed", () => {
		const regions = [
			speed("s1", 0, 6000, 2),
			speed("s2", 4000, 8000, 2),
			speed("s3", 5000, 9000, 3),
		];
		const { merged, absorbedIds } = mergeOverlappingSpeeds("s1", regions);
		expect(absorbedIds).toEqual(["s2"]);
		expect(merged.length).toBe(2);
		expect(merged[0]).toEqual({ id: "s1", startMs: 0, endMs: 8000, speed: 2 });
		expect(merged[1]).toEqual({ id: "s3", startMs: 5000, endMs: 9000, speed: 3 });
	});

	it("returns unchanged when no overlaps", () => {
		const regions = [speed("s1", 0, 3000, 2), speed("s2", 5000, 8000, 2)];
		const { merged, absorbedIds } = mergeOverlappingSpeeds("s1", regions);
		expect(absorbedIds).toEqual([]);
		expect(merged).toBe(regions);
	});
});
