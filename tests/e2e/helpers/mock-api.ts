/**
 * Creates a full window.electronAPI mock with sensible defaults.
 * All methods return resolved promises with success responses.
 * Override individual methods per-test by spreading over the result.
 */
export function createMockAPI(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		getPlatform: () => Promise.resolve("linux"),
		getRecordedVideoPath: () =>
			Promise.resolve({ success: false, path: null }),
		getCurrentVideoPath: () =>
			Promise.resolve({ success: false, path: null }),
		getCurrentRecordingSession: () =>
			Promise.resolve({ success: false, session: null }),
		getSelectedSource: () => Promise.resolve(null),
		getShortcuts: () => Promise.resolve(null),
		getCliInputFile: () => Promise.resolve(null),
		getCliEditorConfig: () => Promise.resolve(null),
		getHeadlessExportConfig: () => Promise.resolve(null),
		switchToEditor: () => Promise.resolve(),
		switchToHud: () => Promise.resolve(),
		startNewRecording: () => Promise.resolve({ success: true }),
		openSourceSelector: () => Promise.resolve(),
		selectSource: (s: unknown) => Promise.resolve(s),
		hudOverlayHide: () => {},
		hudOverlayClose: () => {},
		setCurrentVideoPath: () => Promise.resolve({ success: true }),
		clearCurrentVideoPath: () => Promise.resolve({ success: true }),
		setRecordingState: () => Promise.resolve(),
		setHasUnsavedChanges: () => Promise.resolve(),
		setLocale: () => Promise.resolve(),
		requestCameraAccess: () =>
			Promise.resolve({ success: true, granted: true, status: "granted" }),
		getSources: () => Promise.resolve([]),
		saveExportedVideo: (_data: unknown, name: string) =>
			Promise.resolve({ success: true, path: `/tmp/${name}` }),
		openVideoFilePicker: () =>
			Promise.resolve({ success: false, canceled: true }),
		saveProjectFile: (_data: unknown, name: string) =>
			Promise.resolve({ success: true, path: `/tmp/${name}` }),
		loadProjectFile: () =>
			Promise.resolve({ success: false, canceled: true }),
		loadCurrentProjectFile: () => Promise.resolve({ success: false }),
		readBinaryFile: () => Promise.resolve({ success: false }),
		getAssetBasePath: () => Promise.resolve(null),
		getCursorTelemetry: () =>
			Promise.resolve({ success: true, samples: [] }),
		revealInFolder: () => Promise.resolve({ success: true }),
		writeTextFile: () => Promise.resolve({ success: true }),
		storeRecordedVideo: () => Promise.resolve({ success: true }),
		storeRecordedSession: () => Promise.resolve({ success: true }),
		setCurrentRecordingSession: () => Promise.resolve({ success: true }),
		onStopRecordingFromTray: () => () => {},
		onMenuLoadProject: () => () => {},
		onMenuSaveProject: () => () => {},
		onMenuSaveProjectAs: () => () => {},
		onRequestSaveBeforeClose: () => () => {},
		openExternalUrl: () => Promise.resolve({ success: true }),
		saveShortcuts: () => Promise.resolve({ success: true }),
		setMicrophoneExpanded: () => {},
		sendHeadlessExportProgress: () => {},
		sendHeadlessExportDone: () => Promise.resolve(),
		...overrides,
	};
}
