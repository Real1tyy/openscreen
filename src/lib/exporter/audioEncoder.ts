import { WebDemuxer } from "web-demuxer";
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import type { VideoMuxer } from "./muxer";

const AUDIO_BITRATE = 128_000;
const DECODE_BACKPRESSURE_LIMIT = 20;
const MIN_SPEED_REGION_DELTA_MS = 0.0001;

export type AudioCodec = "aac" | "opus";

export interface AudioProcessResult {
	processed: boolean;
	chunksEncoded: number;
	codec?: AudioCodec;
	error?: string;
}

export async function detectBestAudioCodec(): Promise<AudioCodec> {
	const aacCheck = await AudioEncoder.isConfigSupported({
		codec: "mp4a.40.2",
		sampleRate: 48000,
		numberOfChannels: 2,
		bitrate: 128_000,
	});
	if (aacCheck.supported) return "aac";
	return "opus";
}

export class AudioProcessor {
	private cancelled = false;

	async process(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		_videoUrl: string,
		trimRegions?: TrimRegion[],
		speedRegions?: SpeedRegion[],
		readEndSec?: number,
		targetCodec?: AudioCodec,
	): Promise<AudioProcessResult> {
		const sortedTrims = trimRegions ? [...trimRegions].sort((a, b) => a.startMs - b.startMs) : [];
		const sortedSpeedRegions = speedRegions
			? [...speedRegions]
					.filter((region) => region.endMs - region.startMs > MIN_SPEED_REGION_DELTA_MS)
					.sort((a, b) => a.startMs - b.startMs)
			: [];

		return this.processAudio(demuxer, muxer, sortedTrims, sortedSpeedRegions, readEndSec, targetCodec);
	}

	private async processAudio(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		sortedTrims: TrimRegion[],
		sortedSpeedRegions: SpeedRegion[],
		readEndSec?: number,
		targetCodec?: AudioCodec,
	): Promise<AudioProcessResult> {
		console.log("[AudioProcessor] === PHASE 0: Config ===");
		console.log("[AudioProcessor] readEndSec:", readEndSec);
		console.log("[AudioProcessor] trimRegions:", sortedTrims.length, sortedTrims);
		console.log("[AudioProcessor] speedRegions:", sortedSpeedRegions.length, sortedSpeedRegions);

		let audioConfig: AudioDecoderConfig;
		try {
			audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
		} catch (e) {
			throw new Error(
				`Failed to get audio decoder config: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		console.log("[AudioProcessor] Source audio config:", {
			codec: audioConfig.codec,
			sampleRate: audioConfig.sampleRate,
			numberOfChannels: audioConfig.numberOfChannels,
			descriptionSize: audioConfig.description
				? (audioConfig.description as ArrayBuffer).byteLength ?? "unknown"
				: "none",
		});

		const codecCheck = await AudioDecoder.isConfigSupported(audioConfig);
		console.log("[AudioProcessor] AudioDecoder.isConfigSupported:", {
			supported: codecCheck.supported,
			config: codecCheck.config,
		});
		if (!codecCheck.supported) {
			throw new Error(
				`Audio codec "${audioConfig.codec}" is not supported by this browser`,
			);
		}

		// Phase 1: Decode audio from source, skipping trimmed regions
		console.log("[AudioProcessor] === PHASE 1: Decode ===");
		const decodedFrames: AudioData[] = [];
		let totalChunksRead = 0;
		let chunksSkippedByTrim = 0;
		let decodeErrors: string[] = [];

		const decoder = new AudioDecoder({
			output: (data: AudioData) => decodedFrames.push(data),
			error: (e: DOMException) => {
				decodeErrors.push(`${e.name}: ${e.message}`);
				console.error("[AudioProcessor] Decode error:", e);
			},
		});
		decoder.configure(audioConfig);
		console.log("[AudioProcessor] Decoder state after configure:", decoder.state);

		const safeReadEndSec =
			typeof readEndSec === "number" && Number.isFinite(readEndSec)
				? Math.max(0, readEndSec)
				: undefined;
		console.log("[AudioProcessor] Reading audio stream, safeReadEndSec:", safeReadEndSec);
		const audioStream = (
			safeReadEndSec !== undefined
				? demuxer.read("audio", 0, safeReadEndSec)
				: demuxer.read("audio")
		) as ReadableStream<EncodedAudioChunk>;
		const reader = audioStream.getReader();

		try {
			while (!this.cancelled) {
				const { done, value: chunk } = await reader.read();
				if (done || !chunk) break;
				totalChunksRead++;

				const timestampMs = chunk.timestamp / 1000;
				if (this.isInTrimRegion(timestampMs, sortedTrims)) {
					chunksSkippedByTrim++;
					continue;
				}

				decoder.decode(chunk);

				while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				/* reader already closed */
			}
		}

		console.log("[AudioProcessor] Demux read complete:", {
			totalChunksRead,
			chunksSkippedByTrim,
			chunksDecoded: totalChunksRead - chunksSkippedByTrim,
			decoderState: decoder.state,
			decodeErrors: decodeErrors.length > 0 ? decodeErrors : "none",
			cancelled: this.cancelled,
		});

		if (decoder.state === "configured") {
			await decoder.flush();
			decoder.close();
		}

		console.log("[AudioProcessor] After flush:", {
			decodedFrames: decodedFrames.length,
			firstFrameTimestamp: decodedFrames[0]?.timestamp,
			lastFrameTimestamp: decodedFrames[decodedFrames.length - 1]?.timestamp,
			firstFrameFormat: decodedFrames[0]?.format,
			firstFrameSampleRate: decodedFrames[0]?.sampleRate,
			firstFrameChannels: decodedFrames[0]?.numberOfChannels,
		});

		if (this.cancelled) {
			for (const frame of decodedFrames) frame.close();
			return { processed: false, chunksEncoded: 0 };
		}

		if (decodedFrames.length === 0) {
			throw new Error(
				`Audio decoding produced no frames — read ${totalChunksRead} chunks ` +
				`(${chunksSkippedByTrim} trimmed), ${decodeErrors.length} decode errors. ` +
				`The audio track may be corrupt or empty.`,
			);
		}

		// Phase 2: Re-encode with timestamps adjusted for trim gaps and speed regions
		console.log("[AudioProcessor] === PHASE 2: Encode ===");
		const encodedChunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[] = [];
		let encodeErrors: string[] = [];

		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				encodedChunks.push({ chunk, meta });
			},
			error: (e: DOMException) => {
				encodeErrors.push(`${e.name}: ${e.message}`);
				console.error("[AudioProcessor] Encode error:", e);
			},
		});

		const sampleRate = audioConfig.sampleRate || 48000;
		const channels = audioConfig.numberOfChannels || 2;

		const chosenCodec: AudioCodec = targetCodec ?? (await detectBestAudioCodec());
		const webCodecString = chosenCodec === "aac" ? "mp4a.40.2" : "opus";
		const encodeConfig: AudioEncoderConfig = {
			codec: webCodecString,
			sampleRate,
			numberOfChannels: channels,
			bitrate: AUDIO_BITRATE,
		};

		const encodeSupport = await AudioEncoder.isConfigSupported(encodeConfig);
		console.log("[AudioProcessor] Encode support for", chosenCodec, ":", encodeSupport.supported);

		if (!encodeSupport.supported) {
			for (const frame of decodedFrames) frame.close();
			throw new Error(`Audio codec "${chosenCodec}" (${webCodecString}) is not supported for encoding`);
		}

		console.log("[AudioProcessor] Using codec:", chosenCodec, encodeConfig);

		encoder.configure(encodeConfig);
		console.log("[AudioProcessor] Encoder state after configure:", encoder.state);

		let framesEncoded = 0;
		for (const audioData of decodedFrames) {
			if (this.cancelled) {
				audioData.close();
				continue;
			}

			const timestampMs = audioData.timestamp / 1000;
			const adjustedTimestampUs = this.computeAdjustedTimestamp(
				audioData.timestamp,
				timestampMs,
				sortedTrims,
				sortedSpeedRegions,
			);

			const adjusted = this.cloneWithTimestamp(audioData, Math.max(0, adjustedTimestampUs));
			audioData.close();

			encoder.encode(adjusted);
			adjusted.close();
			framesEncoded++;
		}

		console.log("[AudioProcessor] Frames fed to encoder:", framesEncoded);
		console.log("[AudioProcessor] Encoder state before flush:", encoder.state);

		if (encoder.state === "configured") {
			await encoder.flush();
			encoder.close();
		}

		console.log("[AudioProcessor] After encode flush:", {
			encodedChunks: encodedChunks.length,
			encodeErrors: encodeErrors.length > 0 ? encodeErrors : "none",
			firstChunkTimestamp: encodedChunks[0]?.chunk.timestamp,
			lastChunkTimestamp: encodedChunks[encodedChunks.length - 1]?.chunk.timestamp,
		});

		// Phase 3: Flush encoded chunks to muxer
		console.log("[AudioProcessor] === PHASE 3: Mux ===");
		let muxedChunks = 0;
		let muxErrors: string[] = [];
		for (const { chunk, meta } of encodedChunks) {
			if (this.cancelled) break;
			try {
				await muxer.addAudioChunk(chunk, meta);
				muxedChunks++;
			} catch (e) {
				muxErrors.push(`ts=${chunk.timestamp}: ${e instanceof Error ? e.message : String(e)}`);
				console.error("[AudioProcessor] Mux error at chunk", muxedChunks, e);
			}
		}

		console.log("[AudioProcessor] === SUMMARY ===");
		console.log("[AudioProcessor]", {
			totalChunksRead,
			chunksSkippedByTrim,
			decodedFrames: decodedFrames.length,
			decodeErrors: decodeErrors.length,
			framesEncoded,
			encodedChunks: encodedChunks.length,
			encodeErrors: encodeErrors.length,
			muxedChunks,
			muxErrors: muxErrors.length > 0 ? muxErrors : "none",
			cancelled: this.cancelled,
		});

		if (!this.cancelled && muxedChunks === 0) {
			throw new Error(
				`Audio encoding produced no output chunks. ` +
				`Decoded ${decodedFrames.length} frames, ` +
				`encoded ${encodedChunks.length} chunks, ` +
				`${encodeErrors.length} encode errors, ` +
				`${muxErrors.length} mux errors.`,
			);
		}

		return { processed: true, chunksEncoded: muxedChunks, codec: chosenCodec };
	}

	private cloneWithTimestamp(src: AudioData, newTimestamp: number): AudioData {
		const isPlanar = src.format?.includes("planar") ?? false;
		const numPlanes = isPlanar ? src.numberOfChannels : 1;

		let totalSize = 0;
		for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
			totalSize += src.allocationSize({ planeIndex });
		}

		const buffer = new ArrayBuffer(totalSize);
		let offset = 0;
		for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
			const planeSize = src.allocationSize({ planeIndex });
			src.copyTo(new Uint8Array(buffer, offset, planeSize), { planeIndex });
			offset += planeSize;
		}

		return new AudioData({
			format: src.format!,
			sampleRate: src.sampleRate,
			numberOfFrames: src.numberOfFrames,
			numberOfChannels: src.numberOfChannels,
			timestamp: newTimestamp,
			data: buffer,
		});
	}

	private isInTrimRegion(timestampMs: number, trims: TrimRegion[]): boolean {
		return trims.some((trim) => timestampMs >= trim.startMs && timestampMs < trim.endMs);
	}

	/**
	 * Maps a source timestamp to the output timeline, accounting for trims and speed regions.
	 * Walks through the source timeline from 0 to timestampMs, accumulating the output time:
	 * - Trimmed sections are skipped (zero output time)
	 * - Speed sections accumulate at 1/speed rate
	 * - Normal sections accumulate at 1:1
	 */
	private computeAdjustedTimestamp(
		_sourceTimestampUs: number,
		sourceTimestampMs: number,
		trims: TrimRegion[],
		speedRegions: SpeedRegion[],
	): number {
		let outputMs = 0;
		let cursor = 0;

		// Build sorted events from trims and speed regions
		// Walk linearly through the source timeline
		while (cursor < sourceTimestampMs) {
			// Check if cursor is in a trim region
			const trim = trims.find((t) => cursor >= t.startMs && cursor < t.endMs);
			if (trim) {
				// Skip the trim entirely (or up to sourceTimestampMs)
				cursor = Math.min(trim.endMs, sourceTimestampMs);
				continue;
			}

			// Find the next boundary (trim start, speed region boundary, or sourceTimestampMs)
			let nextBoundary = sourceTimestampMs;
			for (const t of trims) {
				if (t.startMs > cursor && t.startMs < nextBoundary) nextBoundary = t.startMs;
			}
			for (const sr of speedRegions) {
				if (sr.startMs > cursor && sr.startMs < nextBoundary) nextBoundary = sr.startMs;
				if (sr.endMs > cursor && sr.endMs < nextBoundary) nextBoundary = sr.endMs;
			}

			const segmentDuration = nextBoundary - cursor;

			// Find the active speed region at cursor
			const activeSpeed = speedRegions.find(
				(sr) => cursor >= sr.startMs && cursor < sr.endMs,
			);
			const speed = activeSpeed ? activeSpeed.speed : 1;

			outputMs += segmentDuration / speed;
			cursor = nextBoundary;
		}

		return outputMs * 1000; // convert ms to microseconds
	}

	cancel(): void {
		this.cancelled = true;
	}
}
