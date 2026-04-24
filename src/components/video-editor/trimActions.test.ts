import { describe, expect, it } from "vitest";
import type { TrimRegion } from "./types";
import {
	computeEndFromNow,
	computeLoopRegion,
	computeStartFromNow,
	findAdjacentAfter,
	findAdjacentBefore,
} from "./trimActions";

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
		const regions = [
			trim("t1", 1000, 3000),
			trim("t2", 5000, 8000),
			trim("t3", 10000, 15000),
		];
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
		const regions = [
			trim("t1", 1000, 3000),
			trim("t2", 5000, 8000),
			trim("t3", 10000, 15000),
		];
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
