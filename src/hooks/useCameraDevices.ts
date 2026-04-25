import { useMediaDevices } from "./useMediaDevices";

export interface CameraDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export function useCameraDevices(enabled: boolean = false) {
	return useMediaDevices("videoinput", {
		enabled,
		initialDeviceId: "",
		labelPrefix: "Camera",
	});
}
