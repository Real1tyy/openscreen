export type CameraAccessResult = {
	success: boolean;
	granted: boolean;
	status: string;
	error?: string;
};

function getDeniedStatus(error: unknown) {
	if (error instanceof DOMException) {
		return error.name;
	}

	return "unknown";
}

export async function requestCameraAccess(): Promise<CameraAccessResult> {
	const api = (await import("@/lib/tauriBridge")).getAPI();
	if (api?.requestCameraAccess) {
		try {
			const nativeResult = await api.requestCameraAccess();
			if (!nativeResult.success || !nativeResult.granted) {
				return nativeResult;
			}
		} catch (error) {
			return {
				success: false,
				granted: false,
				status: "error",
				error: String(error),
			};
		}
	}

	if (!navigator.mediaDevices?.getUserMedia) {
		return {
			success: false,
			granted: false,
			status: "unsupported",
			error: "Camera access is not supported in this runtime.",
		};
	}

	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: true,
		});
		stream.getTracks().forEach((track) => track.stop());
		return { success: true, granted: true, status: "granted" };
	} catch (error) {
		return {
			success: true,
			granted: false,
			status: getDeniedStatus(error),
			error: String(error),
		};
	}
}
