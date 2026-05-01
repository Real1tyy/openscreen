import { useCallback, useEffect, useRef } from "react";

// biome-ignore lint/suspicious/noExplicitAny: generic callback constraint requires any[] for contravariance
export function useThrottledCallback<T extends (...args: any[]) => void>(
	fn: T,
	ms: number,
	enabled: boolean,
): T {
	const fnRef = useRef(fn);
	fnRef.current = fn;
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestArgsRef = useRef<Parameters<T> | null>(null);

	useEffect(() => {
		if (!enabled && timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
			if (latestArgsRef.current !== null) {
				fnRef.current(...latestArgsRef.current);
				latestArgsRef.current = null;
			}
		}
	}, [enabled]);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	return useCallback(
		((...args: Parameters<T>) => {
			latestArgsRef.current = args;
			if (!enabled) {
				fnRef.current(...args);
				return;
			}
			if (timerRef.current !== null) return;
			fnRef.current(...args);
			latestArgsRef.current = null;
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				if (latestArgsRef.current !== null) {
					fnRef.current(...latestArgsRef.current);
					latestArgsRef.current = null;
				}
			}, ms);
		}) as T,
		[ms, enabled],
	);
}
