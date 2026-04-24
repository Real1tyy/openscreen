// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createDeleteHandler, createSpanChangeHandler, deriveNextIdFromList } from "./regionReducers";

describe("createSpanChangeHandler", () => {
	it("updates the matching region's start/end from span", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "trimRegions");
		handler("t1", { start: 1500.7, end: 3200.3 });

		expect(pushState).toHaveBeenCalledOnce();
		const updater = pushState.mock.calls[0][0] as Function;
		const result = updater({
			trimRegions: [
				{ id: "t1", startMs: 1000, endMs: 2000 },
				{ id: "t2", startMs: 5000, endMs: 6000 },
			],
		});
		expect(result.trimRegions).toEqual([
			{ id: "t1", startMs: 1501, endMs: 3200 },
			{ id: "t2", startMs: 5000, endMs: 6000 },
		]);
	});

	it("rounds fractional milliseconds", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "zoomRegions");
		handler("z1", { start: 99.5, end: 200.4 });

		const updater = pushState.mock.calls[0][0] as Function;
		const result = updater({
			zoomRegions: [{ id: "z1", startMs: 0, endMs: 100, depth: 1, focus: { cx: 0.5, cy: 0.5 } }],
		});
		expect(result.zoomRegions[0].startMs).toBe(100);
		expect(result.zoomRegions[0].endMs).toBe(200);
	});

	it("preserves extra fields on the region", () => {
		const pushState = vi.fn();
		const handler = createSpanChangeHandler(pushState, "speedRegions");
		handler("s1", { start: 0, end: 5000 });

		const updater = pushState.mock.calls[0][0] as Function;
		const result = updater({
			speedRegions: [{ id: "s1", startMs: 1000, endMs: 2000, speed: 1.5 }],
		});
		expect(result.speedRegions[0].speed).toBe(1.5);
	});
});

describe("createDeleteHandler", () => {
	it("removes the matching region", () => {
		const pushState = vi.fn();
		const clearSel = vi.fn();
		const handler = createDeleteHandler(pushState, "trimRegions", "t1", clearSel);
		handler("t1");

		const updater = pushState.mock.calls[0][0] as Function;
		const result = updater({
			trimRegions: [
				{ id: "t1", startMs: 0, endMs: 1000 },
				{ id: "t2", startMs: 2000, endMs: 3000 },
			],
		});
		expect(result.trimRegions).toEqual([{ id: "t2", startMs: 2000, endMs: 3000 }]);
	});

	it("clears selection when deleted id matches selectedId", () => {
		const pushState = vi.fn();
		const clearSel = vi.fn();
		const handler = createDeleteHandler(pushState, "trimRegions", "t1", clearSel);
		handler("t1");
		expect(clearSel).toHaveBeenCalled();
	});

	it("does not clear selection when ids differ", () => {
		const pushState = vi.fn();
		const clearSel = vi.fn();
		const handler = createDeleteHandler(pushState, "trimRegions", "t2", clearSel);
		handler("t1");
		expect(clearSel).not.toHaveBeenCalled();
	});
});

describe("deriveNextIdFromList", () => {
	it("returns 1 for empty list", () => {
		expect(deriveNextIdFromList("zoom", [])).toBe(1);
	});

	it("returns max + 1 for sequential ids", () => {
		expect(deriveNextIdFromList("zoom", ["zoom-1", "zoom-2", "zoom-3"])).toBe(4);
	});

	it("handles gaps in numbering", () => {
		expect(deriveNextIdFromList("trim", ["trim-1", "trim-5"])).toBe(6);
	});

	it("ignores ids with wrong prefix", () => {
		expect(deriveNextIdFromList("zoom", ["trim-10", "zoom-2"])).toBe(3);
	});

	it("ignores non-numeric suffixes", () => {
		expect(deriveNextIdFromList("zoom", ["zoom-abc", "zoom-3"])).toBe(4);
	});
});
