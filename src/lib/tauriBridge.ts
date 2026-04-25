import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
		setRecordingState: (recording) => invoke("set_recording_state", { recording }),
		getCursorTelemetry: (videoPath) =>
			invoke("get_cursor_telemetry", { videoPath: videoPath ?? null }),
		onStopRecordingFromTray: (callback) => {
			let unlisten: (() => void) | null = null;
			listen("stop-recording-from-tray", () => callback()).then((fn_) => {
				unlisten = fn_;
			});
			return () => {
				unlisten?.();
			};
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
		onMenuLoadProject: (callback) => {
			let unlisten: (() => void) | null = null;
			listen("menu-load-project", () => callback()).then((fn_) => {
				unlisten = fn_;
			});
			return () => {
				unlisten?.();
			};
		},
		onMenuSaveProject: (callback) => {
			let unlisten: (() => void) | null = null;
			listen("menu-save-project", () => callback()).then((fn_) => {
				unlisten = fn_;
			});
			return () => {
				unlisten?.();
			};
		},
		onMenuSaveProjectAs: (callback) => {
			let unlisten: (() => void) | null = null;
			listen("menu-save-project-as", () => callback()).then((fn_) => {
				unlisten = fn_;
			});
			return () => {
				unlisten?.();
			};
		},
		getPlatform: () => invoke("get_platform"),
		revealInFolder: (filePath) => invoke("reveal_in_folder", { filePath }),
		getShortcuts: () => invoke("get_shortcuts"),
		saveShortcuts: (shortcuts) => invoke("save_shortcuts", { shortcuts }),
		setLocale: (locale) => invoke("set_locale", { locale }),
		setMicrophoneExpanded: (_expanded) => {},
		setHasUnsavedChanges: (hasChanges) =>
			invoke("set_has_unsaved_changes", { hasChanges }),
		onRequestSaveBeforeClose: (callback) => {
			let unlisten: (() => void) | null = null;
			listen("request-save-before-close", async () => {
				await callback();
			}).then((fn_) => {
				unlisten = fn_;
			});
			return () => {
				unlisten?.();
			};
		},
		writeTextFile: (filePath: string, content: string) =>
			invoke("write_text_file", { filePath, content }),
		getCliInputFile: () => invoke("get_cli_input_file").catch(() => null),
		getCliEditorConfig: () => invoke("get_cli_editor_config").catch(() => null),
		getHeadlessExportConfig: () =>
			invoke("get_headless_export_config").catch(() => null),
		sendHeadlessExportProgress: (_percentage) => {},
		sendHeadlessExportDone: (_result) => Promise.resolve(),
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
