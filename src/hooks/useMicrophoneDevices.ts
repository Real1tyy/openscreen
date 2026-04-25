import { useMediaDevices, type MediaDevice } from "./useMediaDevices";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export function useMicrophoneDevices(enabled: boolean = true) {
	const result = useMediaDevices("audioinput", {
		enabled,
		initialDeviceId: "default",
		labelPrefix: "Microphone",
		requestPermission: true,
		pickDeviceId: (currentId: string, devices: MediaDevice[]) => {
			if (currentId === "default" && devices.length > 0) {
				return devices[0].deviceId;
			}
			return currentId;
		},
	});

	return result;
}
