import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledCallback } from "./useThrottledCallback";

describe("useThrottledCallback", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("calls through immediately when disabled", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useThrottledCallback(fn, 100, false));

		act(() => result.current(1));
		act(() => result.current(2));
		act(() => result.current(3));

		expect(fn).toHaveBeenCalledTimes(3);
		expect(fn).toHaveBeenNthCalledWith(1, 1);
		expect(fn).toHaveBeenNthCalledWith(2, 2);
		expect(fn).toHaveBeenNthCalledWith(3, 3);
	});

	it("throttles calls when enabled", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useThrottledCallback(fn, 100, true));

		act(() => result.current(1));
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith(1);

		act(() => result.current(2));
		act(() => result.current(3));
		expect(fn).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(100));
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith(3);
	});

	it("fires the leading call and flushes latest on timer expiry", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useThrottledCallback(fn, 50, true));

		act(() => {
			result.current(10);
			result.current(20);
			result.current(30);
		});

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith(10);

		act(() => vi.advanceTimersByTime(50));
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith(30);
	});

	it("does not flush if no new calls arrived during throttle window", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useThrottledCallback(fn, 100, true));

		act(() => result.current(1));
		expect(fn).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(100));
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("flushes latest value when enabled switches to false", () => {
		const fn = vi.fn();
		let enabled = true;
		const { result, rerender } = renderHook(() => useThrottledCallback(fn, 100, enabled));

		act(() => {
			result.current(1);
			result.current(2);
			result.current(3);
		});
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith(1);

		enabled = false;
		rerender();

		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith(3);
	});

	it("allows consecutive throttle windows", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useThrottledCallback(fn, 100, true));

		act(() => result.current("a"));
		act(() => result.current("b"));
		expect(fn).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(100));
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith("b");

		act(() => result.current("c"));
		act(() => result.current("d"));
		expect(fn).toHaveBeenCalledTimes(3);
		expect(fn).toHaveBeenLastCalledWith("c");

		act(() => vi.advanceTimersByTime(100));
		expect(fn).toHaveBeenCalledTimes(4);
		expect(fn).toHaveBeenLastCalledWith("d");
	});

	it("clears timer on unmount", () => {
		const fn = vi.fn();
		const { result, unmount } = renderHook(() => useThrottledCallback(fn, 100, true));

		act(() => {
			result.current(1);
			result.current(2);
		});
		expect(fn).toHaveBeenCalledTimes(1);

		unmount();
		act(() => vi.advanceTimersByTime(200));
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("tracks the latest fn without changing callback identity", () => {
		let counter = 0;
		const fn1 = vi.fn(() => counter++);
		const fn2 = vi.fn(() => (counter += 10));

		let fn = fn1;
		const { result, rerender } = renderHook(() => useThrottledCallback(fn, 100, false));

		const ref1 = result.current;
		act(() => result.current(1));
		expect(fn1).toHaveBeenCalledTimes(1);

		fn = fn2;
		rerender();
		act(() => result.current(2));
		expect(fn2).toHaveBeenCalledTimes(1);
		expect(fn1).toHaveBeenCalledTimes(1);

		expect(result.current).toBe(ref1);
	});

	it("passes multiple arguments correctly", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useThrottledCallback(fn, 100, false));

		act(() => result.current("a", 42, true));
		expect(fn).toHaveBeenCalledWith("a", 42, true);
	});
});
