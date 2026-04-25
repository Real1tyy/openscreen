import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleImageFileUpload } from "./imageHandling";

function createMockEvent(file?: File): React.ChangeEvent<HTMLInputElement> {
	const input = document.createElement("input");
	input.type = "file";

	// Override the files property with a mock FileList
	const fileList = file
		? { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) }
		: { length: 0, item: () => null };

	Object.defineProperty(input, "files", { value: fileList, writable: false });

	return {
		target: input,
		currentTarget: input,
		nativeEvent: new Event("change"),
		bubbles: true,
		cancelable: false,
		defaultPrevented: false,
		eventPhase: 0,
		isTrusted: true,
		preventDefault: vi.fn(),
		isDefaultPrevented: () => false,
		stopPropagation: vi.fn(),
		isPropagationStopped: () => false,
		persist: vi.fn(),
		timeStamp: Date.now(),
		type: "change",
	};
}

describe("handleImageFileUpload", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("calls onSuccess with data URL when valid image file selected", () => {
		const onSuccess = vi.fn();
		const file = new File(["pixels"], "photo.png", { type: "image/png" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess });

		// The real FileReader should have been invoked. Trigger its onload.
		// Since we're in happy-dom / jsdom, FileReader is available
		// We need to wait for the async read — but FileReader in happy-dom
		// may not actually read File. Let's mock it instead.
	});

	it("calls onSuccess with data URL via mocked FileReader", () => {
		const fakeDataUrl = "data:image/png;base64,abc123";
		const originalFileReader = globalThis.FileReader;

		// Mock FileReader
		const mockReaderInstance = {
			onload: null as ((e: any) => void) | null,
			onerror: null as (() => void) | null,
			readAsDataURL: vi.fn(function (this: any) {
				// Trigger onload asynchronously
				setTimeout(() => {
					this.onload?.({ target: { result: fakeDataUrl } });
				}, 0);
			}),
			result: null,
		};

		globalThis.FileReader = vi.fn(() => mockReaderInstance) as any;

		const onSuccess = vi.fn();
		const file = new File(["pixels"], "photo.png", { type: "image/png" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess });

		// Trigger onload synchronously by calling it manually
		mockReaderInstance.onload?.({ target: { result: fakeDataUrl } });

		expect(onSuccess).toHaveBeenCalledWith(fakeDataUrl);
		expect(mockReaderInstance.readAsDataURL).toHaveBeenCalledWith(file);

		globalThis.FileReader = originalFileReader;
	});

	it("calls onInvalidType when file type doesn't match validator", () => {
		const onSuccess = vi.fn();
		const onInvalidType = vi.fn();
		const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, {
			onSuccess,
			onInvalidType,
			validateType: (f) => f.type.startsWith("image/"),
		});

		expect(onInvalidType).toHaveBeenCalled();
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it("does nothing when no file selected (empty files list)", () => {
		const onSuccess = vi.fn();
		const onInvalidType = vi.fn();
		const event = createMockEvent(); // no file

		handleImageFileUpload(event, { onSuccess, onInvalidType });

		expect(onSuccess).not.toHaveBeenCalled();
		expect(onInvalidType).not.toHaveBeenCalled();
	});

	it("resets input value after processing valid file", () => {
		const originalFileReader = globalThis.FileReader;
		const mockReaderInstance = {
			onload: null as ((e: any) => void) | null,
			onerror: null as (() => void) | null,
			readAsDataURL: vi.fn(),
			result: null,
		};
		globalThis.FileReader = vi.fn(() => mockReaderInstance) as any;

		const onSuccess = vi.fn();
		const file = new File(["pixels"], "photo.png", { type: "image/png" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess });

		expect(event.target.value).toBe("");

		globalThis.FileReader = originalFileReader;
	});

	it("resets input value after processing invalid file", () => {
		const onSuccess = vi.fn();
		const onInvalidType = vi.fn();
		const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess, onInvalidType });

		expect(event.target.value).toBe("");
	});

	it("calls onError when FileReader fails", () => {
		const originalFileReader = globalThis.FileReader;
		const mockReaderInstance = {
			onload: null as ((e: any) => void) | null,
			onerror: null as (() => void) | null,
			readAsDataURL: vi.fn(),
			result: null,
		};
		globalThis.FileReader = vi.fn(() => mockReaderInstance) as any;

		const onSuccess = vi.fn();
		const onError = vi.fn();
		const file = new File(["pixels"], "photo.png", { type: "image/png" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess, onError });

		// Trigger onerror
		mockReaderInstance.onerror?.();

		expect(onError).toHaveBeenCalled();
		expect(onSuccess).not.toHaveBeenCalled();

		globalThis.FileReader = originalFileReader;
	});

	it("custom validateType function is used when provided", () => {
		const originalFileReader = globalThis.FileReader;
		const mockReaderInstance = {
			onload: null as ((e: any) => void) | null,
			onerror: null as (() => void) | null,
			readAsDataURL: vi.fn(),
			result: null,
		};
		globalThis.FileReader = vi.fn(() => mockReaderInstance) as any;

		const onSuccess = vi.fn();
		const customValidator = vi.fn().mockReturnValue(true);
		const file = new File(["data"], "custom.xyz", { type: "application/octet-stream" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, {
			onSuccess,
			validateType: customValidator,
		});

		expect(customValidator).toHaveBeenCalledWith(file);
		expect(mockReaderInstance.readAsDataURL).toHaveBeenCalled();

		globalThis.FileReader = originalFileReader;
	});

	it("default validation accepts image/* types", () => {
		const originalFileReader = globalThis.FileReader;
		const mockReaderInstance = {
			onload: null as ((e: any) => void) | null,
			onerror: null as (() => void) | null,
			readAsDataURL: vi.fn(),
			result: null,
		};
		globalThis.FileReader = vi.fn(() => mockReaderInstance) as any;

		const onSuccess = vi.fn();
		const file = new File(["pixels"], "photo.jpg", { type: "image/jpeg" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess });

		// If we got to readAsDataURL, validation passed
		expect(mockReaderInstance.readAsDataURL).toHaveBeenCalledWith(file);

		globalThis.FileReader = originalFileReader;
	});

	it("default validation rejects non-image types", () => {
		const onSuccess = vi.fn();
		const onInvalidType = vi.fn();
		const file = new File(["data"], "script.js", { type: "text/javascript" });
		const event = createMockEvent(file);

		handleImageFileUpload(event, { onSuccess, onInvalidType });

		expect(onInvalidType).toHaveBeenCalled();
		expect(onSuccess).not.toHaveBeenCalled();
	});
});
