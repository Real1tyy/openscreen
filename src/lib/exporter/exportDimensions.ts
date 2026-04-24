import type { ExportQuality } from "./types";

interface ExportDimensions {
	width: number;
	height: number;
	bitrate: number;
}

function findEvenDimensionsForLandscape(
	baseWidth: number,
	aspectRatioValue: number,
): { width: number; height: number } | null {
	for (let w = baseWidth; w >= 100; w -= 2) {
		const h = Math.round(w / aspectRatioValue);
		if (h % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
			return { width: w, height: h };
		}
	}
	return null;
}

function findEvenDimensionsForPortrait(
	baseHeight: number,
	aspectRatioValue: number,
): { width: number; height: number } | null {
	for (let h = baseHeight; h >= 100; h -= 2) {
		const w = Math.round(h * aspectRatioValue);
		if (w % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
			return { width: w, height: h };
		}
	}
	return null;
}

function bitrateForPixelCount(totalPixels: number): number {
	if (totalPixels > 2560 * 1440) return 80_000_000;
	if (totalPixels > 1920 * 1080) return 50_000_000;
	return 30_000_000;
}

function bitrateForQuality(totalPixels: number): number {
	if (totalPixels <= 1280 * 720) return 10_000_000;
	if (totalPixels <= 1920 * 1080) return 20_000_000;
	return 30_000_000;
}

export function computeExportDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatioValue: number,
	quality: ExportQuality,
): ExportDimensions {
	if (quality === "source") {
		return computeSourceQualityDimensions(sourceWidth, sourceHeight, aspectRatioValue);
	}
	return computeTargetQualityDimensions(aspectRatioValue, quality);
}

function computeSourceQualityDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatioValue: number,
): ExportDimensions {
	let exportWidth: number;
	let exportHeight: number;

	if (aspectRatioValue === 1) {
		const baseDimension = Math.floor(Math.min(sourceWidth, sourceHeight) / 2) * 2;
		exportWidth = baseDimension;
		exportHeight = baseDimension;
	} else if (aspectRatioValue > 1) {
		const baseWidth = Math.floor(sourceWidth / 2) * 2;
		const found = findEvenDimensionsForLandscape(baseWidth, aspectRatioValue);
		if (found) {
			exportWidth = found.width;
			exportHeight = found.height;
		} else {
			exportWidth = baseWidth;
			exportHeight = Math.floor(baseWidth / aspectRatioValue / 2) * 2;
		}
	} else {
		const baseHeight = Math.floor(sourceHeight / 2) * 2;
		const found = findEvenDimensionsForPortrait(baseHeight, aspectRatioValue);
		if (found) {
			exportWidth = found.width;
			exportHeight = found.height;
		} else {
			exportHeight = baseHeight;
			exportWidth = Math.floor((baseHeight * aspectRatioValue) / 2) * 2;
		}
	}

	return {
		width: exportWidth,
		height: exportHeight,
		bitrate: bitrateForPixelCount(exportWidth * exportHeight),
	};
}

function computeTargetQualityDimensions(
	aspectRatioValue: number,
	quality: "medium" | "good",
): ExportDimensions {
	const targetHeight = quality === "medium" ? 720 : 1080;
	const exportHeight = Math.floor(targetHeight / 2) * 2;
	const exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

	return {
		width: exportWidth,
		height: exportHeight,
		bitrate: bitrateForQuality(exportWidth * exportHeight),
	};
}
