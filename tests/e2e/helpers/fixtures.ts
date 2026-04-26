import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../../fixtures");

export const SAMPLE_VIDEO = path.join(FIXTURES_DIR, "sample.webm");
export const SAMPLE_LONG_VIDEO = path.join(FIXTURES_DIR, "sample-long.webm");

/**
 * Video fixtures are served from `public/test-fixtures/` via the Vite dev server.
 * The app converts paths through `toFileUrl()` producing `file://` URLs which
 * browsers cannot load. We intercept the HTMLMediaElement.src setter to rewrite
 * `file:///test-fixtures/...` back to `/test-fixtures/...` (relative HTTP URL).
 */
const VIDEO_FIXTURE_URLS: Record<string, string> = {
	sample: "/test-fixtures/sample.webm",
	"sample-long": "/test-fixtures/sample-long.webm",
};

function fixtureNameFromPath(fixturePath: string): string {
	return path.basename(fixturePath, path.extname(fixturePath));
}

/**
 * Injects the mock electronAPI into the page before the app loads.
 * Optionally points the mock to a video fixture served via Vite.
 *
 * The `videoFixture` parameter accepts a filesystem path (used to
 * derive the fixture name) — the actual video data is served from
 * `public/test-fixtures/` by the Vite dev server.
 */
export async function injectMockAPI(
	page: Page,
	options: {
		overrides?: Record<string, unknown>;
		videoFixture?: string;
	} = {},
): Promise<void> {
	const { overrides = {}, videoFixture } = options;

	const videoUrl = videoFixture
		? VIDEO_FIXTURE_URLS[fixtureNameFromPath(videoFixture)] ?? null
		: null;

	const mockOverrides = { ...overrides };

	await page.addInitScript(
		({ mockOverridesJSON, videoPath }) => {
			const overridesFromTest = JSON.parse(mockOverridesJSON);

			// Intercept file:// URLs on <video>/<audio> elements and rewrite
			// them to relative HTTP URLs that the Vite dev server can serve.
			// This is necessary because the app's toFileUrl() converts paths
			// to file:// URLs, which browsers block in HTTP contexts.
			//
			// React uses setAttribute('src', ...) on built-in elements, not
			// the property setter, so we must intercept setAttribute.
			const origSetAttribute = Element.prototype.setAttribute;
			Element.prototype.setAttribute = function (
				name: string,
				value: string,
			) {
				if (
					this instanceof HTMLMediaElement &&
					name === "src" &&
					typeof value === "string" &&
					value.startsWith("file:///test-fixtures/")
				) {
					value = value.replace("file://", "");
				}
				return origSetAttribute.call(this, name, value);
			};

			// Also intercept the src property setter for direct assignments
			const originalSrcDescriptor = Object.getOwnPropertyDescriptor(
				HTMLMediaElement.prototype,
				"src",
			);
			if (originalSrcDescriptor?.set) {
				const origSet = originalSrcDescriptor.set;
				Object.defineProperty(HTMLMediaElement.prototype, "src", {
					set(value: string) {
						if (
							typeof value === "string" &&
							value.startsWith("file:///test-fixtures/")
						) {
							value = value.replace("file://", "");
						}
						origSet.call(this, value);
					},
					get: originalSrcDescriptor.get,
					configurable: true,
					enumerable: originalSrcDescriptor.enumerable,
				});
			}

			const baseMock: Record<string, unknown> = {
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
				setHasUnsavedChanges: () => {},
				setLocale: () => Promise.resolve(),
				requestCameraAccess: () =>
					Promise.resolve({
						success: true,
						granted: true,
						status: "granted",
					}),
				getSources: () => Promise.resolve([]),
				saveExportedVideo: (_data: unknown, name: string) =>
					Promise.resolve({ success: true, path: `/tmp/${name}` }),
				openVideoFilePicker: () =>
					Promise.resolve({ success: false, canceled: true }),
				saveProjectFile: (_data: unknown, name: string) =>
					Promise.resolve({ success: true, path: `/tmp/${name}` }),
				loadProjectFile: () =>
					Promise.resolve({ success: false, canceled: true }),
				loadCurrentProjectFile: () =>
					Promise.resolve({ success: false }),
				readBinaryFile: () => Promise.resolve({ success: false }),
				getAssetBasePath: () => Promise.resolve(null),
				getCursorTelemetry: () =>
					Promise.resolve({ success: true, samples: [] }),
				revealInFolder: () => Promise.resolve({ success: true }),
				writeTextFile: () => Promise.resolve({ success: true }),
				storeRecordedVideo: () => Promise.resolve({ success: true }),
				storeRecordedSession: () => Promise.resolve({ success: true }),
				setCurrentRecordingSession: () =>
					Promise.resolve({ success: true }),
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
			};

			if (videoPath) {
				baseMock.getCurrentRecordingSession = () =>
					Promise.resolve({
						success: true,
						session: {
							screenVideoPath: videoPath,
							createdAt: Date.now(),
						},
					});
			}

			// Apply JSON-serializable overrides (for simple return values)
			for (const [key, value] of Object.entries(overridesFromTest)) {
				if (typeof value === "string" && value.startsWith("__fn:")) {
					continue;
				}
				const returnValue = value;
				baseMock[key] = () =>
					returnValue instanceof Object &&
					returnValue !== null &&
					!Array.isArray(returnValue)
						? Promise.resolve(returnValue)
						: Promise.resolve(returnValue);
			}

			try {
				localStorage.clear();
			} catch {
				// may not be available yet
			}

			(window as Record<string, unknown>).electronAPI = baseMock;
		},
		{
			mockOverridesJSON: JSON.stringify(mockOverrides),
			videoPath: videoUrl,
		},
	);
}

export async function navigateToEditorWithVideo(
	page: Page,
	videoFixture: string = SAMPLE_VIDEO,
): Promise<void> {
	await injectMockAPI(page, { videoFixture });
	await page.goto("/?windowType=editor");
	await page.waitForSelector("text=Loading video...", {
		state: "hidden",
		timeout: 15_000,
	});
}

export async function navigateToEditorEmpty(page: Page): Promise<void> {
	await injectMockAPI(page);
	await page.goto("/?windowType=editor");
}

export async function navigateToHud(
	page: Page,
	overrides: Record<string, unknown> = {},
): Promise<void> {
	await injectMockAPI(page, { overrides });
	await page.goto("/?windowType=hud-overlay");
}

export async function navigateToSourceSelector(
	page: Page,
	overrides: Record<string, unknown> = {},
): Promise<void> {
	await injectMockAPI(page, { overrides });
	await page.goto("/?windowType=source-selector");
}

export async function clearStorage(page: Page): Promise<void> {
	await page.addInitScript(() => {
		try {
			localStorage.clear();
		} catch {
			// may not be available yet
		}
	});
}
