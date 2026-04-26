import {
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
} from "mediabunny";
import type { ExportConfig } from "./types";

export class VideoMuxer {
	private output: Output | null = null;
	private videoSource: EncodedVideoPacketSource | null = null;
	private audioSource: EncodedAudioPacketSource | null = null;
	private hasAudio: boolean;
	private target: BufferTarget | null = null;
	private config: ExportConfig;
	private videoChunkCount = 0;
	private audioChunkCount = 0;

	constructor(config: ExportConfig, hasAudio = false) {
		this.config = config;
		this.hasAudio = hasAudio;
		console.log("[Muxer] Created with hasAudio:", hasAudio);
	}

	async initialize(): Promise<void> {
		// Create the buffer target
		this.target = new BufferTarget();

		this.output = new Output({
			format: new Mp4OutputFormat({
				fastStart: "in-memory",
			}),
			target: this.target,
		});

		// Create video source - codec will be deduced from metadata
		this.videoSource = new EncodedVideoPacketSource("avc");
		this.output.addVideoTrack(this.videoSource, {
			frameRate: this.config.frameRate,
		});

		// Create audio source if needed
		if (this.hasAudio) {
			this.audioSource = new EncodedAudioPacketSource("opus");
			this.output.addAudioTrack(this.audioSource);
			console.log("[Muxer] Audio track added (opus)");
		} else {
			console.log("[Muxer] No audio track — video-only export");
		}

		// Start the output to begin accepting media data
		await this.output.start();
		console.log("[Muxer] Output started");
	}

	async addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void> {
		if (!this.videoSource) {
			throw new Error("Muxer not initialized");
		}

		const packet = EncodedPacket.fromEncodedChunk(chunk);
		try {
			await this.videoSource.add(packet, meta);
			this.videoChunkCount++;
		} catch (error) {
			throw new Error(
				`Failed to mux video chunk (ts=${chunk.timestamp}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): Promise<void> {
		if (!this.audioSource) {
			throw new Error("Audio not configured for this muxer");
		}

		const packet = EncodedPacket.fromEncodedChunk(chunk);
		try {
			await this.audioSource.add(packet, meta);
			this.audioChunkCount++;
		} catch (error) {
			throw new Error(
				`Failed to mux audio chunk (ts=${chunk.timestamp}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async finalize(): Promise<Blob> {
		if (!this.output || !this.target) {
			throw new Error("Muxer not initialized");
		}

		console.log("[Muxer] Finalizing:", {
			videoChunks: this.videoChunkCount,
			audioChunks: this.audioChunkCount,
			hasAudio: this.hasAudio,
			audioSourceConfigured: !!this.audioSource,
		});

		if (this.hasAudio && this.audioChunkCount === 0) {
			console.warn("[Muxer] WARNING: Audio track was created but received 0 audio chunks!");
		}

		try {
			await this.output.finalize();
		} catch (error) {
			throw new Error(
				`MP4 finalization failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		const buffer = this.target.buffer;

		if (!buffer) {
			throw new Error("MP4 finalization produced no output data");
		}

		const blob = new Blob([buffer], { type: "video/mp4" });
		console.log("[Muxer] Output blob size:", blob.size, "bytes");
		return blob;
	}
}
