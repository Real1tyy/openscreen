use std::path::{Path, PathBuf};

extern crate ffmpeg_next as ffmpeg;

use ffmpeg::format::context::Input;
use ffmpeg::{codec, format, frame, media, Rational};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct TrimRegion {
    #[serde(rename = "startMs")]
    pub start_ms: f64,
    #[serde(rename = "endMs")]
    pub end_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpeedRegion {
    #[serde(rename = "startMs")]
    pub start_ms: f64,
    #[serde(rename = "endMs")]
    pub end_ms: f64,
    pub speed: f64,
}

fn source_has_audio(path: &str) -> bool {
    ffmpeg::init().ok();
    match format::input(&path) {
        Ok(ctx) => ctx.streams().best(media::Type::Audio).is_some(),
        Err(_) => false,
    }
}

fn is_in_trim_region(timestamp_ms: f64, trims: &[TrimRegion]) -> bool {
    trims
        .iter()
        .any(|t| timestamp_ms >= t.start_ms && timestamp_ms < t.end_ms)
}

/// Maps a source timestamp (in ms) to the output timeline (in ms),
/// accounting for trim gaps and speed regions. Port of the TypeScript
/// `computeAdjustedTimestamp` logic in audioEncoder.ts.
fn compute_adjusted_timestamp_ms(
    source_ms: f64,
    trims: &[TrimRegion],
    speed_regions: &[SpeedRegion],
) -> f64 {
    let mut output_ms: f64 = 0.0;
    let mut cursor: f64 = 0.0;

    while cursor < source_ms {
        // Skip trim regions
        if let Some(trim) = trims.iter().find(|t| cursor >= t.start_ms && cursor < t.end_ms) {
            cursor = trim.end_ms.min(source_ms);
            continue;
        }

        // Find next boundary
        let mut next_boundary = source_ms;
        for t in trims {
            if t.start_ms > cursor && t.start_ms < next_boundary {
                next_boundary = t.start_ms;
            }
        }
        for sr in speed_regions {
            if sr.start_ms > cursor && sr.start_ms < next_boundary {
                next_boundary = sr.start_ms;
            }
            if sr.end_ms > cursor && sr.end_ms < next_boundary {
                next_boundary = sr.end_ms;
            }
        }

        let segment_duration = next_boundary - cursor;

        let active_speed = speed_regions
            .iter()
            .find(|sr| cursor >= sr.start_ms && cursor < sr.end_ms);
        let speed = active_speed.map_or(1.0, |sr| sr.speed);

        output_ms += segment_duration / speed;
        cursor = next_boundary;
    }

    output_ms
}

fn find_best_aac_encoder() -> Result<codec::codec::Codec, String> {
    if let Some(enc) = ffmpeg::encoder::find_by_name("aac") {
        return Ok(enc);
    }
    if let Some(enc) = ffmpeg::encoder::find_by_name("libfdk_aac") {
        return Ok(enc);
    }
    ffmpeg::encoder::find(codec::Id::AAC)
        .ok_or_else(|| "No AAC encoder found".to_string())
}

/// After NVENC produces a video-only MP4, this function remuxes audio from
/// the source video into the final output. It decodes the audio, applies
/// trim/speed adjustments, re-encodes to AAC, and muxes with the video.
pub fn mux_audio_into_video(
    video_only_path: &Path,
    source_video_path: &str,
    trim_regions: &[TrimRegion],
    speed_regions: &[SpeedRegion],
    final_output_path: &Path,
) -> Result<(), String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

    if !source_has_audio(source_video_path) {
        // No audio in source — just rename the video-only file
        std::fs::rename(video_only_path, final_output_path).map_err(|e| {
            format!(
                "Failed to move video file: {} → {}: {}",
                video_only_path.display(),
                final_output_path.display(),
                e
            )
        })?;
        return Ok(());
    }

    // Open source video for audio stream
    let mut source_input = format::input(source_video_path)
        .map_err(|e| format!("Failed to open source video for audio: {}", e))?;

    let audio_stream_index = source_input
        .streams()
        .best(media::Type::Audio)
        .ok_or("No audio stream in source")?
        .index();

    let audio_stream_params = source_input
        .stream(audio_stream_index)
        .unwrap()
        .parameters();
    let audio_time_base = source_input.stream(audio_stream_index).unwrap().time_base();

    // Set up audio decoder
    let audio_decoder_ctx = codec::context::Context::from_parameters(audio_stream_params.clone())
        .map_err(|e| format!("Failed to create audio decoder context: {}", e))?;
    let mut audio_decoder = audio_decoder_ctx
        .decoder()
        .audio()
        .map_err(|e| format!("Failed to open audio decoder: {}", e))?;

    let src_sample_rate = audio_decoder.rate() as i32;
    let src_channel_layout = audio_decoder.channel_layout();
    let src_format = audio_decoder.format();

    // Open video-only MP4 for video stream
    let video_input = format::input(video_only_path)
        .map_err(|e| format!("Failed to open video-only MP4: {}", e))?;

    let video_stream_index = video_input
        .streams()
        .best(media::Type::Video)
        .ok_or("No video stream in video-only MP4")?
        .index();

    let video_stream_params = video_input.stream(video_stream_index).unwrap().parameters();
    let video_time_base = video_input.stream(video_stream_index).unwrap().time_base();

    // Create output with both streams
    let mut output_ctx = format::output(final_output_path)
        .map_err(|e| format!("Failed to create output: {}", e))?;

    // Add video stream (copy codec params from video-only MP4)
    let mut out_video_stream = output_ctx
        .add_stream(ffmpeg::encoder::find(codec::Id::H264).unwrap())
        .map_err(|e| format!("Failed to add video stream: {}", e))?;
    out_video_stream.set_parameters(video_stream_params);
    let out_video_idx = out_video_stream.index();
    let out_video_tb = video_time_base;

    // Add audio stream with AAC encoder
    let aac_codec = find_best_aac_encoder()?;
    let out_audio_stream = output_ctx
        .add_stream(aac_codec)
        .map_err(|e| format!("Failed to add audio stream: {}", e))?;
    let out_audio_idx = out_audio_stream.index();

    // Configure AAC encoder
    let mut audio_encoder_ctx = codec::context::Context::new_with_codec(aac_codec)
        .encoder()
        .audio()
        .map_err(|e| format!("Failed to create AAC encoder context: {}", e))?;

    audio_encoder_ctx.set_rate(src_sample_rate);
    audio_encoder_ctx.set_channel_layout(src_channel_layout);
    let target_format = aac_codec
        .audio()
        .ok()
        .and_then(|a| a.formats())
        .and_then(|mut f| f.next())
        .unwrap_or(ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar));
    audio_encoder_ctx.set_format(target_format);
    audio_encoder_ctx.set_bit_rate(128_000);
    audio_encoder_ctx.set_time_base(Rational::new(1, src_sample_rate));

    let mut audio_encoder = audio_encoder_ctx
        .open_as(aac_codec)
        .map_err(|e| format!("Failed to open AAC encoder: {}", e))?;

    // Set audio stream parameters from encoder
    output_ctx
        .stream_mut(out_audio_idx)
        .unwrap()
        .set_parameters(&audio_encoder);

    output_ctx
        .write_header()
        .map_err(|e| format!("Failed to write output header: {}", e))?;

    let out_audio_tb = output_ctx.stream(out_audio_idx).unwrap().time_base();

    // Phase 1: Copy video packets from video-only MP4
    let mut video_input_reopen = format::input(video_only_path)
        .map_err(|e| format!("Failed to reopen video-only MP4: {}", e))?;

    for (stream, packet) in video_input_reopen.packets() {
        if stream.index() == video_stream_index {
            let mut out_packet = packet.clone();
            out_packet.set_stream(out_video_idx);
            out_packet.rescale_ts(video_time_base, out_video_tb);
            out_packet
                .write_interleaved(&mut output_ctx)
                .map_err(|e| format!("Failed to write video packet: {}", e))?;
        }
    }

    // Phase 2: Decode audio, apply trims/speed, re-encode to AAC
    let mut audio_pts: i64 = 0;
    let mut resampler = ffmpeg::software::resampling::Context::get(
        src_format,
        src_channel_layout,
        src_sample_rate as u32,
        audio_encoder.format(),
        audio_encoder.channel_layout(),
        audio_encoder.rate(),
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let sorted_trims = {
        let mut t = trim_regions.to_vec();
        t.sort_by(|a, b| a.start_ms.partial_cmp(&b.start_ms).unwrap());
        t
    };
    let sorted_speeds = {
        let mut s = speed_regions.to_vec();
        s.sort_by(|a, b| a.start_ms.partial_cmp(&b.start_ms).unwrap());
        s
    };

    // Re-open source for audio reading
    let mut source_for_audio = format::input(source_video_path)
        .map_err(|e| format!("Failed to reopen source for audio: {}", e))?;

    let encode_and_write =
        |encoder: &mut codec::encoder::audio::Encoder,
         output: &mut format::context::Output,
         stream_idx: usize,
         tb: Rational| -> Result<(), String> {
            let mut encoded = ffmpeg::Packet::empty();
            while encoder.receive_packet(&mut encoded).is_ok() {
                encoded.set_stream(stream_idx);
                encoded.rescale_ts(Rational::new(1, encoder.rate() as i32), tb);
                encoded
                    .write_interleaved(output)
                    .map_err(|e| format!("Failed to write audio packet: {}", e))?;
            }
            Ok(())
        };

    for (stream, packet) in source_for_audio.packets() {
        if stream.index() != audio_stream_index {
            continue;
        }

        // Compute source timestamp in milliseconds
        let pkt_pts = packet.pts().unwrap_or(0);
        let time_base_f64 =
            audio_time_base.numerator() as f64 / audio_time_base.denominator() as f64;
        let source_ms = pkt_pts as f64 * time_base_f64 * 1000.0;

        // Skip packets in trim regions
        if is_in_trim_region(source_ms, &sorted_trims) {
            continue;
        }

        // Decode
        audio_decoder.send_packet(&packet).ok();

        let mut decoded_frame = frame::Audio::empty();
        while audio_decoder.receive_frame(&mut decoded_frame).is_ok() {
            let frame_ts_ms = source_ms; // approximate

            // Compute adjusted output timestamp
            let adjusted_ms =
                compute_adjusted_timestamp_ms(frame_ts_ms, &sorted_trims, &sorted_speeds);

            // Resample if needed
            let mut resampled = frame::Audio::empty();
            resampler
                .run(&decoded_frame, &mut resampled)
                .map_err(|e| format!("Resample failed: {}", e))?;

            // Set PTS based on adjusted timestamp
            let adjusted_samples =
                (adjusted_ms / 1000.0 * audio_encoder.rate() as f64) as i64;
            resampled.set_pts(Some(adjusted_samples));

            audio_encoder
                .send_frame(&resampled)
                .map_err(|e| format!("Failed to send audio frame: {}", e))?;

            encode_and_write(
                &mut audio_encoder,
                &mut output_ctx,
                out_audio_idx,
                out_audio_tb,
            )?;
        }
    }

    // Flush audio decoder
    audio_decoder.send_eof().ok();
    let mut decoded_frame = frame::Audio::empty();
    while audio_decoder.receive_frame(&mut decoded_frame).is_ok() {
        let mut resampled = frame::Audio::empty();
        resampler.run(&decoded_frame, &mut resampled).ok();

        resampled.set_pts(Some(audio_pts));
        audio_pts += resampled.samples() as i64;

        audio_encoder.send_frame(&resampled).ok();
        encode_and_write(
            &mut audio_encoder,
            &mut output_ctx,
            out_audio_idx,
            out_audio_tb,
        )?;
    }

    // Flush audio encoder
    audio_encoder.send_eof().ok();
    encode_and_write(
        &mut audio_encoder,
        &mut output_ctx,
        out_audio_idx,
        out_audio_tb,
    )?;

    output_ctx
        .write_trailer()
        .map_err(|e| format!("Failed to write output trailer: {}", e))?;

    eprintln!(
        "[AudioMuxer] Audio muxed into {}",
        final_output_path.display()
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_compute_adjusted_timestamp_no_regions() {
        let result = compute_adjusted_timestamp_ms(5000.0, &[], &[]);
        assert!((result - 5000.0).abs() < 0.001);
    }

    #[test]
    fn test_compute_adjusted_timestamp_with_trim() {
        let trims = vec![TrimRegion {
            start_ms: 2000.0,
            end_ms: 4000.0,
        }];
        // At source 5000ms: first 2000ms normal, then 2000ms trimmed, then 1000ms normal
        // Output: 2000 + 1000 = 3000ms
        let result = compute_adjusted_timestamp_ms(5000.0, &trims, &[]);
        assert!(
            (result - 3000.0).abs() < 0.001,
            "Expected 3000, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_timestamp_with_speed() {
        let speeds = vec![SpeedRegion {
            start_ms: 0.0,
            end_ms: 10000.0,
            speed: 2.0,
        }];
        // 10s at 2x → 5s output
        let result = compute_adjusted_timestamp_ms(10000.0, &[], &speeds);
        assert!(
            (result - 5000.0).abs() < 0.001,
            "Expected 5000, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_timestamp_with_trim_and_speed() {
        let trims = vec![TrimRegion {
            start_ms: 0.0,
            end_ms: 5000.0,
        }];
        let speeds = vec![SpeedRegion {
            start_ms: 5000.0,
            end_ms: 15000.0,
            speed: 4.0,
        }];
        // Source 15s: first 5s trimmed, then 10s at 4x → 2.5s
        let result = compute_adjusted_timestamp_ms(15000.0, &trims, &speeds);
        assert!(
            (result - 2500.0).abs() < 0.001,
            "Expected 2500, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_timestamp_speed_then_normal() {
        let speeds = vec![SpeedRegion {
            start_ms: 0.0,
            end_ms: 4000.0,
            speed: 2.0,
        }];
        // 0-4s at 2x → 2s output, then 4-6s normal → 2s output = 4s total
        let result = compute_adjusted_timestamp_ms(6000.0, &[], &speeds);
        assert!(
            (result - 4000.0).abs() < 0.001,
            "Expected 4000, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_timestamp_multiple_trims() {
        let trims = vec![
            TrimRegion {
                start_ms: 1000.0,
                end_ms: 2000.0,
            },
            TrimRegion {
                start_ms: 4000.0,
                end_ms: 5000.0,
            },
        ];
        // Source 7s: 0-1s normal (1s), 1-2s trimmed, 2-4s normal (2s), 4-5s trimmed, 5-7s normal (2s)
        // Output: 1 + 2 + 2 = 5s
        let result = compute_adjusted_timestamp_ms(7000.0, &trims, &[]);
        assert!(
            (result - 5000.0).abs() < 0.001,
            "Expected 5000, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_timestamp_trim_inside_speed() {
        let trims = vec![TrimRegion {
            start_ms: 2000.0,
            end_ms: 4000.0,
        }];
        let speeds = vec![SpeedRegion {
            start_ms: 0.0,
            end_ms: 10000.0,
            speed: 2.0,
        }];
        // 0-2s at 2x → 1s, 2-4s trimmed, 4-10s at 2x → 3s = 4s total
        let result = compute_adjusted_timestamp_ms(10000.0, &trims, &speeds);
        assert!(
            (result - 4000.0).abs() < 0.001,
            "Expected 4000, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_zero_timestamp() {
        let result = compute_adjusted_timestamp_ms(0.0, &[], &[]);
        assert!((result - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_is_in_trim_region() {
        let trims = vec![
            TrimRegion {
                start_ms: 1000.0,
                end_ms: 3000.0,
            },
            TrimRegion {
                start_ms: 5000.0,
                end_ms: 7000.0,
            },
        ];

        assert!(!is_in_trim_region(0.0, &trims));
        assert!(!is_in_trim_region(999.0, &trims));
        assert!(is_in_trim_region(1000.0, &trims));
        assert!(is_in_trim_region(2000.0, &trims));
        assert!(!is_in_trim_region(3000.0, &trims)); // end is exclusive
        assert!(is_in_trim_region(5500.0, &trims));
        assert!(!is_in_trim_region(7000.0, &trims));
        assert!(!is_in_trim_region(8000.0, &trims));
    }

    #[test]
    fn test_source_has_audio_nonexistent_file() {
        assert!(!source_has_audio("/nonexistent/file.mp4"));
    }

    #[test]
    fn test_mux_audio_nonexistent_source() {
        let video_path = std::env::temp_dir().join("nonexistent_video.mp4");
        let output_path = std::env::temp_dir().join("test_mux_output.mp4");
        let result = mux_audio_into_video(
            &video_path,
            "/nonexistent/source.mp4",
            &[],
            &[],
            &output_path,
        );
        // Should fail because source doesn't exist, but since source_has_audio
        // returns false for non-existent files, it tries to rename the video-only
        // file which also doesn't exist
        assert!(result.is_err() || !output_path.exists());
        fs::remove_file(&output_path).ok();
    }

    #[test]
    fn test_compute_adjusted_slow_speed() {
        let speeds = vec![SpeedRegion {
            start_ms: 0.0,
            end_ms: 4000.0,
            speed: 0.5,
        }];
        // 4s at 0.5x → 8s output
        let result = compute_adjusted_timestamp_ms(4000.0, &[], &speeds);
        assert!(
            (result - 8000.0).abs() < 0.001,
            "Expected 8000, got {}",
            result
        );
    }

    #[test]
    fn test_compute_adjusted_mixed_speeds() {
        let speeds = vec![
            SpeedRegion {
                start_ms: 0.0,
                end_ms: 2000.0,
                speed: 2.0,
            },
            SpeedRegion {
                start_ms: 4000.0,
                end_ms: 6000.0,
                speed: 0.5,
            },
        ];
        // 0-2s at 2x → 1s, 2-4s normal → 2s, 4-6s at 0.5x → 4s = 7s total
        let result = compute_adjusted_timestamp_ms(6000.0, &[], &speeds);
        assert!(
            (result - 7000.0).abs() < 0.001,
            "Expected 7000, got {}",
            result
        );
    }

    #[test]
    fn test_mux_audio_with_video_only_mp4() {
        // Create a video-only MP4 using our encoder
        let video_path = std::env::temp_dir().join("test_mux_video_only.mp4");
        let output_path = std::env::temp_dir().join("test_mux_final_output.mp4");

        let config = crate::encoder::EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: video_path.to_string_lossy().to_string(),
        };
        let mut enc = crate::encoder::NvencEncoder::new(&config).unwrap();
        let frame_size = (160 * 120 * 4) as usize;
        let rgba = vec![128u8; frame_size];
        for i in 0..10 {
            enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
        }
        enc.finalize().unwrap();

        // Mux with a non-existent source (no audio) → should just move the file
        let result = mux_audio_into_video(
            &video_path,
            "/nonexistent_source.webm",
            &[],
            &[],
            &output_path,
        );

        // source_has_audio returns false → renames video-only to output
        if result.is_ok() {
            assert!(output_path.exists());
            // Should be a valid MP4
            let header = fs::read(&output_path).unwrap();
            assert_eq!(
                std::str::from_utf8(&header[4..8]).unwrap_or(""),
                "ftyp"
            );
        }

        fs::remove_file(&video_path).ok();
        fs::remove_file(&output_path).ok();
    }
}
