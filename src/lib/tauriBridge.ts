import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StoreRecordedSessionInput } from "./recordingSession";

export function isTauri(): boolean {
	return "__TAURI_INTERNALS__" in window;
}

export function toAssetUrl(filePath: string): string {
	if (!isTauri()) {
		return filePath;
	}
	return convertFileSrc(filePath);
}

export async function readFileAsBlobUrl(filePath: string): Promise<string> {
	const { readFile } = await import("@tauri-apps/plugin-fs");
	const data = await readFile(filePath);
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "mp4";
	const mimeMap: Record<string, string> = {
		mp4: "video/mp4",
		webm: "video/webm",
		mov: "video/quicktime",
		avi: "video/x-msvideo",
		mkv: "video/x-matroska",
	};
	const blob = new Blob([data], { type: mimeMap[ext] ?? "video/mp4" });
	return URL.createObjectURL(blob);
}

type ElectronAPI = Window["electronAPI"];

let tempCounter = 0;
function nextTempName(ext: string): string {
	return `openscreen-transfer-${Date.now()}-${tempCounter++}.${ext}`;
}

async function writeToTempFile(data: ArrayBuffer, ext: string): Promise<string> {
	const { writeFile } = await import("@tauri-apps/plugin-fs");
	const { tempDir } = await import("@tauri-apps/api/path");
	let dir = await tempDir();
	if (!dir.endsWith("/")) dir += "/";
	const name = nextTempName(ext);
	const path = `${dir}${name}`;
	await writeFile(path, new Uint8Array(data));
	return path;
}

async function readFromPath(filePath: string): Promise<ArrayBuffer> {
	const { readFile } = await import("@tauri-apps/plugin-fs");
	const data = await readFile(filePath);
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function cleanupTempFile(path: string): Promise<void> {
	try {
		const { remove } = await import("@tauri-apps/plugin-fs");
		await remove(path);
	} catch {
		// Best-effort cleanup
	}
}

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
			const screenTempPath = await writeToTempFile(videoData, "webm");
			return invoke("store_recorded_session_from_files", {
				payload: {
					screen: { fileName, tempPath: screenTempPath },
					createdAt: Date.now(),
				},
			});
		},

		storeRecordedSession: async (payload: StoreRecordedSessionInput) => {
			const screenTempPath = await writeToTempFile(payload.screen.videoData, "webm");
			const tauriPayload: Record<string, unknown> = {
				screen: { fileName: payload.screen.fileName, tempPath: screenTempPath },
				createdAt: payload.createdAt ?? Date.now(),
			};
			if (payload.webcam) {
				const webcamTempPath = await writeToTempFile(payload.webcam.videoData, "webm");
				tauriPayload.webcam = {
					fileName: payload.webcam.fileName,
					tempPath: webcamTempPath,
				};
			}
			return invoke("store_recorded_session_from_files", { payload: tauriPayload });
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
			const tempPath = await writeToTempFile(
				videoData,
				fileName.toLowerCase().endsWith(".gif") ? "gif" : "mp4",
			);
			const result: {
				success: boolean;
				path?: string;
				message?: string;
				canceled?: boolean;
			} = await invoke("save_exported_video_from_file", { tempPath, fileName });
			if (!result.success && !result.canceled) {
				await cleanupTempFile(tempPath);
			}
			return result;
		},

		openVideoFilePicker: () => invoke("open_video_file_picker"),
		setCurrentVideoPath: (path) => invoke("set_current_video_path", { path }),
		setCurrentRecordingSession: (session) =>
			invoke("set_current_recording_session", { session }),
		getCurrentVideoPath: () => invoke("get_current_video_path"),
		getCurrentRecordingSession: () => invoke("get_current_recording_session"),
		clearCurrentVideoPath: () => invoke("clear_current_video_path"),

		readBinaryFile: async (filePath) => {
			const result: { success: boolean; path?: string; message?: string } = await invoke(
				"read_binary_file_to_temp",
				{ filePath },
			);
			if (!result.success) {
				return result;
			}
			const approvedPath = result.path!;
			const data = await readFromPath(approvedPath);
			return {
				success: true,
				data,
				path: approvedPath,
			};
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

// NVENC export API — only available in Tauri
export interface NvencExportAPI {
	checkNvencAvailable: () => Promise<boolean>;
	startNvencExport: (config: {
		width: number;
		height: number;
		fps: number;
		bitrate: number;
		outputPath: string;
	}) => Promise<{
		success: boolean;
		sessionId: string;
		usingNvenc: boolean;
		error?: string;
	}>;
	feedFrame: (
		sessionId: string,
		framePath: string,
		width: number,
		height: number,
		isKeyframe: boolean,
	) => Promise<{ success: boolean; frameCount: number; error?: string }>;
	finishExport: (
		sessionId: string,
		trimRegions?: Array<{ id: string; startMs: number; endMs: number }>,
		speedRegions?: Array<{ id: string; startMs: number; endMs: number; speed: number }>,
	) => Promise<{
		success: boolean;
		path?: string;
		error?: string;
		totalFrames: number;
	}>;
	cancelExport: (sessionId: string) => Promise<void>;
	getFrameTempDir: () => Promise<string>;
}

export function getNvencAPI(): NvencExportAPI | null {
	if (!isTauri()) return null;
	return {
		checkNvencAvailable: () => invoke("check_nvenc_available"),
		startNvencExport: (config) => invoke("start_nvenc_export", { config }),
		feedFrame: (sessionId, framePath, width, height, isKeyframe) =>
			invoke("feed_frame", { sessionId, framePath, width, height, isKeyframe }),
		finishExport: (sessionId, trimRegions, speedRegions) =>
			invoke("finish_export", { sessionId, trimRegions: trimRegions ?? null, speedRegions: speedRegions ?? null }),
		cancelExport: (sessionId) => invoke("cancel_export", { sessionId }),
		getFrameTempDir: () => invoke("get_frame_temp_dir"),
	};
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
