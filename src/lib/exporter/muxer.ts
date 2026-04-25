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

	constructor(config: ExportConfig, hasAudio = false) {
		this.config = config;
		this.hasAudio = hasAudio;
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
		}

		// Start the output to begin accepting media data
		await this.output.start();
	}

	async addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void> {
		if (!this.videoSource) {
			throw new Error("Muxer not initialized");
		}

		const packet = EncodedPacket.fromEncodedChunk(chunk);
		try {
			await this.videoSource.add(packet, meta);
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

		return new Blob([buffer], { type: "video/mp4" });
	}
}
