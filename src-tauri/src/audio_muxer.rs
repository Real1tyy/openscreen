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

fn compute_adjusted_timestamp_ms(
    source_ms: f64,
    trims: &[TrimRegion],
    speed_regions: &[SpeedRegion],
) -> f64 {
    let mut output_ms: f64 = 0.0;
    let mut cursor: f64 = 0.0;

    while cursor < source_ms {
        if let Some(trim) = trims.iter().find(|t| cursor >= t.start_ms && cursor < t.end_ms) {
            cursor = trim.end_ms.min(source_ms);
            continue;
        }

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

pub fn mux_audio_into_video(
    video_only_path: &Path,
    source_video_path: &str,
    trim_regions: &[TrimRegion],
    speed_regions: &[SpeedRegion],
    final_output_path: &Path,
) -> Result<(), String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

    if !source_has_audio(source_video_path) {
        std::fs::rename(video_only_path, final_output_path).map_err(|e| {
            format!("Failed to move video file: {}", e)
        })?;
        return Ok(());
    }

    let source_input = format::input(source_video_path)
        .map_err(|e| format!("Failed to open source video for audio: {}", e))?;

    let audio_stream_index = source_input
        .streams()
        .best(media::Type::Audio)
        .ok_or("No audio stream in source")?
        .index();

    let audio_stream_params = source_input.stream(audio_stream_index).unwrap().parameters();
    let audio_time_base = source_input.stream(audio_stream_index).unwrap().time_base();

    let audio_decoder_ctx = codec::context::Context::from_parameters(audio_stream_params.clone())
        .map_err(|e| format!("Failed to create audio decoder context: {}", e))?;
    let mut audio_decoder = audio_decoder_ctx
        .decoder()
        .audio()
        .map_err(|e| format!("Failed to open audio decoder: {}", e))?;

    let src_sample_rate = audio_decoder.rate() as i32;
    let src_channel_layout = audio_decoder.channel_layout();
    let src_format = audio_decoder.format();

    let video_input = format::input(video_only_path)
        .map_err(|e| format!("Failed to open video-only MP4: {}", e))?;

    let video_stream_index = video_input
        .streams()
        .best(media::Type::Video)
        .ok_or("No video stream in video-only MP4")?
        .index();

    let video_stream_params = video_input.stream(video_stream_index).unwrap().parameters();
    let video_time_base = video_input.stream(video_stream_index).unwrap().time_base();

    let mut output_ctx = format::output(final_output_path)
        .map_err(|e| format!("Failed to create output: {}", e))?;

    let mut out_video_stream = output_ctx
        .add_stream(ffmpeg::encoder::find(codec::Id::H264).unwrap())
        .map_err(|e| format!("Failed to add video stream: {}", e))?;
    out_video_stream.set_parameters(video_stream_params);
    let out_video_idx = out_video_stream.index();
    let out_video_tb = video_time_base;

    let aac_codec = find_best_aac_encoder()?;
    let out_audio_stream = output_ctx
        .add_stream(aac_codec)
        .map_err(|e| format!("Failed to add audio stream: {}", e))?;
    let out_audio_idx = out_audio_stream.index();

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

    output_ctx
        .stream_mut(out_audio_idx)
        .unwrap()
        .set_parameters(&audio_encoder);

    output_ctx
        .write_header()
        .map_err(|e| format!("Failed to write output header: {}", e))?;

    let out_audio_tb = output_ctx.stream(out_audio_idx).unwrap().time_base();

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

        let pkt_pts = packet.pts().unwrap_or(0);
        let time_base_f64 =
            audio_time_base.numerator() as f64 / audio_time_base.denominator() as f64;
        let source_ms = pkt_pts as f64 * time_base_f64 * 1000.0;

        if is_in_trim_region(source_ms, &sorted_trims) {
            continue;
        }

        audio_decoder.send_packet(&packet).ok();

        let mut decoded_frame = frame::Audio::empty();
        while audio_decoder.receive_frame(&mut decoded_frame).is_ok() {
            let frame_ts_ms = source_ms;
            let adjusted_ms =
                compute_adjusted_timestamp_ms(frame_ts_ms, &sorted_trims, &sorted_speeds);

            let mut resampled = frame::Audio::empty();
            resampler
                .run(&decoded_frame, &mut resampled)
                .map_err(|e| format!("Resample failed: {}", e))?;

            let adjusted_samples =
                (adjusted_ms / 1000.0 * audio_encoder.rate() as f64) as i64;
            resampled.set_pts(Some(adjusted_samples));

            audio_encoder
                .send_frame(&resampled)
                .map_err(|e| format!("Failed to send audio frame: {}", e))?;

            encode_and_write(&mut audio_encoder, &mut output_ctx, out_audio_idx, out_audio_tb)?;
        }
    }

    audio_decoder.send_eof().ok();
    let mut decoded_frame = frame::Audio::empty();
    while audio_decoder.receive_frame(&mut decoded_frame).is_ok() {
        let mut resampled = frame::Audio::empty();
        resampler.run(&decoded_frame, &mut resampled).ok();
        resampled.set_pts(Some(audio_pts));
        audio_pts += resampled.samples() as i64;
        audio_encoder.send_frame(&resampled).ok();
        encode_and_write(&mut audio_encoder, &mut output_ctx, out_audio_idx, out_audio_tb)?;
    }

    audio_encoder.send_eof().ok();
    encode_and_write(&mut audio_encoder, &mut output_ctx, out_audio_idx, out_audio_tb)?;

    output_ctx
        .write_trailer()
        .map_err(|e| format!("Failed to write output trailer: {}", e))?;

    eprintln!("[AudioMuxer] Audio muxed into {}", final_output_path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjusted_timestamp_identity() {
        assert!((compute_adjusted_timestamp_ms(5000.0, &[], &[]) - 5000.0).abs() < 0.001);
    }

    #[test]
    fn adjusted_timestamp_with_trim() {
        let trims = vec![TrimRegion { start_ms: 2000.0, end_ms: 4000.0 }];
        let r = compute_adjusted_timestamp_ms(5000.0, &trims, &[]);
        assert!((r - 3000.0).abs() < 0.001, "expected 3000, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_with_speed() {
        let speeds = vec![SpeedRegion { start_ms: 0.0, end_ms: 10000.0, speed: 2.0 }];
        let r = compute_adjusted_timestamp_ms(10000.0, &[], &speeds);
        assert!((r - 5000.0).abs() < 0.001, "expected 5000, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_trim_and_speed() {
        let trims = vec![TrimRegion { start_ms: 0.0, end_ms: 5000.0 }];
        let speeds = vec![SpeedRegion { start_ms: 5000.0, end_ms: 15000.0, speed: 4.0 }];
        let r = compute_adjusted_timestamp_ms(15000.0, &trims, &speeds);
        assert!((r - 2500.0).abs() < 0.001, "expected 2500, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_speed_then_normal() {
        let speeds = vec![SpeedRegion { start_ms: 0.0, end_ms: 4000.0, speed: 2.0 }];
        let r = compute_adjusted_timestamp_ms(6000.0, &[], &speeds);
        assert!((r - 4000.0).abs() < 0.001, "expected 4000, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_multiple_trims() {
        let trims = vec![
            TrimRegion { start_ms: 1000.0, end_ms: 2000.0 },
            TrimRegion { start_ms: 4000.0, end_ms: 5000.0 },
        ];
        let r = compute_adjusted_timestamp_ms(7000.0, &trims, &[]);
        assert!((r - 5000.0).abs() < 0.001, "expected 5000, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_trim_inside_speed() {
        let trims = vec![TrimRegion { start_ms: 2000.0, end_ms: 4000.0 }];
        let speeds = vec![SpeedRegion { start_ms: 0.0, end_ms: 10000.0, speed: 2.0 }];
        let r = compute_adjusted_timestamp_ms(10000.0, &trims, &speeds);
        assert!((r - 4000.0).abs() < 0.001, "expected 4000, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_zero() {
        assert!(compute_adjusted_timestamp_ms(0.0, &[], &[]).abs() < 0.001);
    }

    #[test]
    fn adjusted_timestamp_slow_speed() {
        let speeds = vec![SpeedRegion { start_ms: 0.0, end_ms: 4000.0, speed: 0.5 }];
        let r = compute_adjusted_timestamp_ms(4000.0, &[], &speeds);
        assert!((r - 8000.0).abs() < 0.001, "expected 8000, got {}", r);
    }

    #[test]
    fn adjusted_timestamp_mixed_speeds() {
        let speeds = vec![
            SpeedRegion { start_ms: 0.0, end_ms: 2000.0, speed: 2.0 },
            SpeedRegion { start_ms: 4000.0, end_ms: 6000.0, speed: 0.5 },
        ];
        let r = compute_adjusted_timestamp_ms(6000.0, &[], &speeds);
        assert!((r - 7000.0).abs() < 0.001, "expected 7000, got {}", r);
    }

    #[test]
    fn trim_region_boundary_check() {
        let trims = vec![
            TrimRegion { start_ms: 1000.0, end_ms: 3000.0 },
            TrimRegion { start_ms: 5000.0, end_ms: 7000.0 },
        ];
        assert!(!is_in_trim_region(0.0, &trims));
        assert!(!is_in_trim_region(999.0, &trims));
        assert!(is_in_trim_region(1000.0, &trims));
        assert!(is_in_trim_region(2000.0, &trims));
        assert!(!is_in_trim_region(3000.0, &trims));
        assert!(is_in_trim_region(5500.0, &trims));
        assert!(!is_in_trim_region(7000.0, &trims));
    }

    #[test]
    fn nonexistent_file_has_no_audio() {
        assert!(!source_has_audio("/nonexistent/file.mp4"));
    }
}
