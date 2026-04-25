/**
 * Reads an image file from an <input type="file"> change event and returns
 * the result as a data URL via a callback.
 *
 * The input element's value is always reset after processing so the same
 * file can be selected again.
 */
export function handleImageFileUpload(
	event: React.ChangeEvent<HTMLInputElement>,
	options: {
		/** Called when the image validates but *before* reading starts. Return `false` to abort. */
		validateType?: (file: File) => boolean;
		onSuccess: (dataUrl: string) => void;
		onInvalidType?: () => void;
		onError?: () => void;
	},
): void {
	const file = event.target.files?.[0];
	if (!file) return;

	const validate = options.validateType ?? ((f: File) => f.type.startsWith("image/"));
	if (!validate(file)) {
		options.onInvalidType?.();
		event.target.value = "";
		return;
	}

	const reader = new FileReader();

	reader.onload = (e) => {
		const dataUrl = (e.target?.result ?? reader.result) as string;
		if (dataUrl) {
			options.onSuccess(dataUrl);
		}
	};

	reader.onerror = () => {
		options.onError?.();
	};

	reader.readAsDataURL(file);
	event.target.value = "";
}
