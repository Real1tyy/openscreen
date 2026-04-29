/// <reference types="vite/client" />

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}

interface HeadlessExportConfig {
	inputFile: string;
	outputFile: string;
	fps: number;
	bitrate: number | null;
	resolution: { width: number; height: number } | null;
	shadow: boolean;
	shadowIntensity: number;
	blur: boolean;
	motionBlur: number;
	roundness: number;
	padding: number;
	background: string;
}

interface Window {
	electronAPI: {
		getAssetBasePath: () => Promise<string | null>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		saveExportedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
		}>;
		openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		readBinaryFile: (filePath: string) => Promise<{
			success: boolean;
			data?: ArrayBuffer;
			path?: string;
			message?: string;
			error?: string;
		}>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		onMenuOpenVideo: (callback: () => void) => () => void;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		onMenuPreferences: (callback: () => void) => () => void;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => () => void;
		setLocale: (locale: string) => Promise<void>;
		getPlatform: () => Promise<string>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; message?: string; error?: string }>;
		getShortcuts: () => Promise<unknown>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		writeTextFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
		getCliInputFile: () => Promise<string | null>;
		getCliEditorConfig: () => Promise<{
			shadowIntensity: number;
			showBlur: boolean;
			motionBlurAmount: number;
			borderRadius: number;
			padding: number;
			wallpaper: string;
		} | null>;
		getHeadlessExportConfig: () => Promise<HeadlessExportConfig | null>;
		sendHeadlessExportProgress: (percentage: number) => void;
		sendHeadlessExportDone: (result: {
			success: boolean;
			data?: ArrayBuffer;
			error?: string;
		}) => Promise<void>;
	};
}
