import { invoke } from "@tauri-apps/api/core";
import type { StoreRecordedSessionInput } from "./recordingSession";

export function isTauri(): boolean {
	return "__TAURI_INTERNALS__" in window;
}

type ElectronAPI = Window["electronAPI"];

function buildTauriAPI(): ElectronAPI {
	return {
		hudOverlayHide: () => {
			invoke("hud_overlay_hide");
		},
		hudOverlayClose: () => {
			invoke("hud_overlay_close");
		},
		getSources: async (_opts) => {
			// In Tauri, screen capture uses getDisplayMedia (browser API).
			// This returns an empty list; the source selector uses getDisplayMedia directly.
			return [];
		},
		switchToEditor: () => invoke("switch_to_editor"),
		switchToHud: () => invoke("switch_to_hud"),
		startNewRecording: () => invoke("start_new_recording"),
		openSourceSelector: () => invoke("open_source_selector"),
		selectSource: (source) => invoke("select_source", { source }),
		getSelectedSource: () => invoke("get_selected_source"),
		requestCameraAccess: () => invoke("request_camera_access"),
		storeRecordedVideo: async (videoData, fileName) => {
			const data = Array.from(new Uint8Array(videoData));
			return invoke("store_recorded_session", {
				payload: {
					screen: { fileName, videoData: data },
					createdAt: Date.now(),
				},
			});
		},
		storeRecordedSession: async (payload: StoreRecordedSessionInput) => {
			const screenData = Array.from(new Uint8Array(payload.screen.videoData));
			const tauriPayload: Record<string, unknown> = {
				screen: { fileName: payload.screen.fileName, videoData: screenData },
				createdAt: payload.createdAt ?? Date.now(),
			};
			if (payload.webcam) {
				const webcamData = Array.from(new Uint8Array(payload.webcam.videoData));
				tauriPayload.webcam = {
					fileName: payload.webcam.fileName,
					videoData: webcamData,
				};
			}
			return invoke("store_recorded_session", { payload: tauriPayload });
		},
		getRecordedVideoPath: () => invoke("get_recorded_video_path"),
		getAssetBasePath: () => invoke("get_asset_base_path"),
		setRecordingState: (_recording) => {
			// Cursor telemetry capture is handled differently in Tauri (Rust-side).
			// For Phase 1, this is a no-op. Phase 3 implements Rust cursor capture.
			return Promise.resolve();
		},
		getCursorTelemetry: (videoPath) =>
			invoke("get_cursor_telemetry", { videoPath: videoPath ?? null }),
		onStopRecordingFromTray: (_callback) => {
			// Tauri tray events are handled via Rust-side event listeners.
			// Phase 2 wires this up via tauri event system.
			return () => {};
		},
		openExternalUrl: (url) => invoke("open_external_url", { url }),
		saveExportedVideo: async (videoData, fileName) => {
			const data = Array.from(new Uint8Array(videoData));
			return invoke("save_exported_video", { videoData: data, fileName });
		},
		openVideoFilePicker: () => invoke("open_video_file_picker"),
		setCurrentVideoPath: (path) => invoke("set_current_video_path", { path }),
		setCurrentRecordingSession: (session) =>
			invoke("set_current_recording_session", { session }),
		getCurrentVideoPath: () => invoke("get_current_video_path"),
		getCurrentRecordingSession: () => invoke("get_current_recording_session"),
		clearCurrentVideoPath: () => invoke("clear_current_video_path"),
		readBinaryFile: async (filePath) => {
			const result: { success: boolean; data?: number[]; path?: string; message?: string } =
				await invoke("read_binary_file", { filePath });
			if (result.success && result.data) {
				const uint8 = new Uint8Array(result.data);
				return {
					success: true,
					data: uint8.buffer.slice(
						uint8.byteOffset,
						uint8.byteOffset + uint8.byteLength,
					) as ArrayBuffer,
					path: result.path,
				};
			}
			return result;
		},
		saveProjectFile: (projectData, suggestedName, existingProjectPath) =>
			invoke("save_project_file", {
				projectData,
				suggestedName: suggestedName ?? null,
				existingProjectPath: existingProjectPath ?? null,
			}),
		loadProjectFile: () => invoke("load_project_file"),
		loadCurrentProjectFile: () => invoke("load_current_project_file"),
		onMenuLoadProject: (_callback) => {
			// Phase 2: wire via Tauri menu events
			return () => {};
		},
		onMenuSaveProject: (_callback) => {
			return () => {};
		},
		onMenuSaveProjectAs: (_callback) => {
			return () => {};
		},
		getPlatform: () => invoke("get_platform"),
		revealInFolder: (filePath) => invoke("reveal_in_folder", { filePath }),
		getShortcuts: () => invoke("get_shortcuts"),
		saveShortcuts: (shortcuts) => invoke("save_shortcuts", { shortcuts }),
		setLocale: (locale) => invoke("set_locale", { locale }),
		setMicrophoneExpanded: (_expanded) => {
			// HUD-specific, handled differently in Tauri multi-window
		},
		setHasUnsavedChanges: (hasChanges) =>
			invoke("set_has_unsaved_changes", { hasChanges }),
		onRequestSaveBeforeClose: (_callback) => {
			// Phase 2: wire via Tauri window close-requested event
			return () => {};
		},
		writeTextFile: (filePath: string, content: string) =>
			invoke("write_text_file", { filePath, content }),
		getCliInputFile: () => invoke("get_cli_input_file").catch(() => null),
		getCliEditorConfig: () => invoke("get_cli_editor_config").catch(() => null),
		getHeadlessExportConfig: () =>
			invoke("get_headless_export_config").catch(() => null),
		sendHeadlessExportProgress: (_percentage) => {
			// Headless export progress — Phase 2
		},
		sendHeadlessExportDone: (_result) => {
			// Headless export done — Phase 2
			return Promise.resolve();
		},
	} as ElectronAPI;
}

let cachedAPI: ElectronAPI | null = null;

export function getAPI(): ElectronAPI {
	if (cachedAPI) return cachedAPI;

	if (isTauri()) {
		cachedAPI = buildTauriAPI();
	} else {
		cachedAPI = window.electronAPI;
	}

	return cachedAPI;
}
