import { useEffect, useRef, useState } from "react";

export interface MediaDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

/**
 * Shared hook for enumerating media devices by kind.
 *
 * @param kind - The device kind to filter for ("audioinput" or "videoinput").
 * @param options - Configuration for behaviour differences between camera / mic hooks.
 */
export function useMediaDevices(
	kind: "audioinput" | "videoinput",
	options: {
		/** Whether device enumeration is active. */
		enabled: boolean;
		/** Initial value for selectedDeviceId. */
		initialDeviceId: string;
		/** Prefix used when the device label is empty (e.g. "Camera", "Microphone"). */
		labelPrefix: string;
		/** When true, request a getUserMedia stream first to get labels. */
		requestPermission?: boolean;
		/**
		 * Custom function to decide whether to reset `selectedDeviceId` after
		 * a device list refresh.  Receives the current selected ID and the
		 * newly-discovered device list; should return the ID to use.
		 */
		pickDeviceId?: (
			currentId: string,
			devices: MediaDevice[],
		) => string;
	},
) {
	const {
		enabled,
		initialDeviceId,
		labelPrefix,
		requestPermission = false,
		pickDeviceId,
	} = options;

	const [devices, setDevices] = useState<MediaDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] =
		useState<string>(initialDeviceId);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selectedDeviceIdRef = useRef(selectedDeviceId);
	selectedDeviceIdRef.current = selectedDeviceId;

	useEffect(() => {
		if (!enabled) return;
		let mounted = true;

		const loadDevices = async () => {
			try {
				setIsLoading(true);
				setError(null);

				let permissionStream: MediaStream | null = null;
				if (requestPermission) {
					const constraints =
						kind === "audioinput" ? { audio: true } : { video: true };
					permissionStream =
						await navigator.mediaDevices.getUserMedia(constraints);
				}

				const allDevices = await navigator.mediaDevices.enumerateDevices();
				const filtered = allDevices
					.filter((device) => device.kind === kind)
					.map((device) => ({
						deviceId: device.deviceId,
						label:
							device.label ||
							`${labelPrefix} ${device.deviceId.slice(0, 8)}`,
						groupId: device.groupId,
					}));

				if (permissionStream) {
					permissionStream.getTracks().forEach((track) => track.stop());
				}

				if (mounted) {
					setDevices(filtered);

					if (pickDeviceId) {
						const nextId = pickDeviceId(
							selectedDeviceIdRef.current,
							filtered,
						);
						if (nextId !== selectedDeviceIdRef.current) {
							setSelectedDeviceId(nextId);
						}
					} else {
						// Default: fall back to first device when current selection is
						// empty or no longer available.
						const currentId = selectedDeviceIdRef.current;
						const stillAvailable = filtered.some(
							(d) => d.deviceId === currentId,
						);
						if (!currentId || !stillAvailable) {
							setSelectedDeviceId(filtered[0]?.deviceId ?? "");
						}
					}

					setIsLoading(false);
				}
			} catch (err) {
				if (mounted) {
					setError(
						err instanceof Error
							? err.message
							: `Failed to load ${kind} devices`,
					);
					setIsLoading(false);
				}
			}
		};

		loadDevices();

		navigator.mediaDevices.addEventListener("devicechange", loadDevices);
		return () => {
			mounted = false;
			navigator.mediaDevices.removeEventListener(
				"devicechange",
				loadDevices,
			);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled]);

	return { devices, selectedDeviceId, setSelectedDeviceId, isLoading, error };
}
