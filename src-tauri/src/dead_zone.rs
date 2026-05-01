extern crate ffmpeg_next as ffmpeg;

use ffmpeg::{codec, format, frame, media};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::Instant;

const HYSTERESIS_DB: f64 = 2.0;
const FREEZE_SMOOTHING_ALPHA: f64 = 0.3;
const AUDIO_WINDOW_MS: f64 = 100.0;
const ANALYSIS_W: u32 = 160;
const ANALYSIS_H: u32 = 90;

// ── Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeadZone {
    #[serde(rename = "startMs")]
    pub start_ms: f64,
    #[serde(rename = "endMs")]
    pub end_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DetectionConfig {
    #[serde(rename = "silenceThresholdDb")]
    pub silence_threshold_db: f64,
    #[serde(rename = "silenceMinDurationMs")]
    pub silence_min_duration_ms: f64,
    #[serde(rename = "freezeNoiseThreshold")]
    pub freeze_noise_threshold: f64,
    #[serde(rename = "freezeMinDurationMs")]
    pub freeze_min_duration_ms: f64,
    #[serde(rename = "minDeadZoneMs")]
    pub min_dead_zone_ms: f64,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            silence_threshold_db: -30.0,
            silence_min_duration_ms: 500.0,
            freeze_noise_threshold: 0.003,
            freeze_min_duration_ms: 500.0,
            min_dead_zone_ms: 1000.0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectionMetrics {
    #[serde(rename = "silenceIntervalsFound")]
    pub silence_intervals_found: usize,
    #[serde(rename = "freezeIntervalsFound")]
    pub freeze_intervals_found: usize,
    #[serde(rename = "effectiveSilenceThresholdDb")]
    pub effective_silence_threshold_db: f64,
    #[serde(rename = "audioNoiseFloorDb")]
    pub audio_noise_floor_db: Option<f64>,
    #[serde(rename = "analysisDurationMs")]
    pub analysis_duration_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectionResult {
    #[serde(rename = "deadZones")]
    pub dead_zones: Vec<DeadZone>,
    #[serde(rename = "hasAudio")]
    pub has_audio: bool,
    #[serde(rename = "durationMs")]
    pub duration_ms: f64,
    pub metrics: DetectionMetrics,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Interval {
    pub start_ms: f64,
    pub end_ms: f64,
}

struct AudioWindow {
    time_ms: f64,
    rms_db: f64,
}

// ── Interval math ──────────────────────────────────────────────────

pub fn merge_intervals(intervals: &[Interval], gap_tolerance_ms: f64) -> Vec<Interval> {
    if intervals.is_empty() {
        return Vec::new();
    }
    let mut sorted: Vec<_> = intervals.to_vec();
    sorted.sort_by(|a, b| a.start_ms.partial_cmp(&b.start_ms).unwrap());

    let mut merged = vec![sorted[0].clone()];
    for iv in &sorted[1..] {
        let last = merged.last_mut().unwrap();
        if iv.start_ms <= last.end_ms + gap_tolerance_ms {
            last.end_ms = last.end_ms.max(iv.end_ms);
        } else {
            merged.push(iv.clone());
        }
    }
    merged
}

pub fn filter_by_min_duration(intervals: &[Interval], min_duration_ms: f64) -> Vec<Interval> {
    intervals
        .iter()
        .filter(|iv| (iv.end_ms - iv.start_ms) >= min_duration_ms)
        .cloned()
        .collect()
}

pub fn intersect_intervals(a: &[Interval], b: &[Interval]) -> Vec<Interval> {
    let mut result = Vec::new();
    let mut j = 0;
    for iv_a in a {
        while j < b.len() && b[j].end_ms <= iv_a.start_ms {
            j += 1;
        }
        let mut k = j;
        while k < b.len() && b[k].start_ms < iv_a.end_ms {
            let start = iv_a.start_ms.max(b[k].start_ms);
            let end = iv_a.end_ms.min(b[k].end_ms);
            if start < end {
                result.push(Interval {
                    start_ms: start,
                    end_ms: end,
                });
            }
            k += 1;
        }
    }
    result
}

// ── Audio helpers ──────────────────────────────────────────────────

fn rms_to_db(rms: f64) -> f64 {
    if rms <= 0.0 {
        return -100.0;
    }
    20.0 * rms.log10()
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return -100.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn auto_calibrate_threshold(windows: &[AudioWindow], user_threshold: f64) -> (f64, Option<f64>) {
    if windows.is_empty() {
        return (user_threshold, None);
    }
    let mut db_values: Vec<f64> = windows.iter().map(|w| w.rms_db).collect();
    db_values.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let noise_floor = percentile(&db_values, 0.10);
    let effective = user_threshold.max(noise_floor + 3.0);

    (effective, Some(noise_floor))
}

fn classify_with_hysteresis(
    windows: &[AudioWindow],
    threshold_db: f64,
    window_ms: f64,
) -> Vec<Interval> {
    let enter_threshold = threshold_db;
    let exit_threshold = threshold_db + HYSTERESIS_DB;

    let mut in_silence = false;
    let mut silence_start = 0.0;
    let mut intervals = Vec::new();

    for w in windows {
        if !in_silence && w.rms_db < enter_threshold {
            in_silence = true;
            silence_start = w.time_ms;
        } else if in_silence && w.rms_db > exit_threshold {
            intervals.push(Interval {
                start_ms: silence_start,
                end_ms: w.time_ms,
            });
            in_silence = false;
        }
    }

    if in_silence {
        if let Some(last) = windows.last() {
            intervals.push(Interval {
                start_ms: silence_start,
                end_ms: last.time_ms + window_ms,
            });
        }
    }

    intervals
}

fn samples_from_audio_frame(decoded: &frame::Audio) -> Vec<f32> {
    let fmt = decoded.format();
    let channels = decoded.channels() as usize;
    let nb_samples = decoded.samples();
    if nb_samples == 0 || channels == 0 {
        return Vec::new();
    }

    match fmt {
        format::Sample::F32(format::sample::Type::Packed) => {
            let data = decoded.data(0);
            let floats: &[f32] = unsafe {
                std::slice::from_raw_parts(data.as_ptr() as *const f32, nb_samples * channels)
            };
            if channels == 1 {
                floats.to_vec()
            } else {
                (0..nb_samples)
                    .map(|i| {
                        let sum: f32 =
                            (0..channels).map(|ch| floats[i * channels + ch]).sum();
                        sum / channels as f32
                    })
                    .collect()
            }
        }
        format::Sample::F32(format::sample::Type::Planar) => {
            (0..nb_samples)
                .map(|i| {
                    let sum: f32 = (0..channels)
                        .map(|ch| {
                            let plane = decoded.data(ch);
                            let floats: &[f32] = unsafe {
                                std::slice::from_raw_parts(
                                    plane.as_ptr() as *const f32,
                                    nb_samples,
                                )
                            };
                            floats[i]
                        })
                        .sum();
                    sum / channels as f32
                })
                .collect()
        }
        format::Sample::F64(format::sample::Type::Packed) => {
            let data = decoded.data(0);
            let doubles: &[f64] = unsafe {
                std::slice::from_raw_parts(data.as_ptr() as *const f64, nb_samples * channels)
            };
            if channels == 1 {
                doubles.iter().map(|&v| v as f32).collect()
            } else {
                (0..nb_samples)
                    .map(|i| {
                        let sum: f64 =
                            (0..channels).map(|ch| doubles[i * channels + ch]).sum();
                        (sum / channels as f64) as f32
                    })
                    .collect()
            }
        }
        format::Sample::F64(format::sample::Type::Planar) => {
            (0..nb_samples)
                .map(|i| {
                    let sum: f64 = (0..channels)
                        .map(|ch| {
                            let plane = decoded.data(ch);
                            let doubles: &[f64] = unsafe {
                                std::slice::from_raw_parts(
                                    plane.as_ptr() as *const f64,
                                    nb_samples,
                                )
                            };
                            doubles[i]
                        })
                        .sum();
                    (sum / channels as f64) as f32
                })
                .collect()
        }
        format::Sample::I16(format::sample::Type::Packed) => {
            let data = decoded.data(0);
            let shorts: &[i16] = unsafe {
                std::slice::from_raw_parts(data.as_ptr() as *const i16, nb_samples * channels)
            };
            if channels == 1 {
                shorts.iter().map(|&v| v as f32 / 32768.0).collect()
            } else {
                (0..nb_samples)
                    .map(|i| {
                        let sum: f32 = (0..channels)
                            .map(|ch| shorts[i * channels + ch] as f32 / 32768.0)
                            .sum();
                        sum / channels as f32
                    })
                    .collect()
            }
        }
        format::Sample::I16(format::sample::Type::Planar) => {
            (0..nb_samples)
                .map(|i| {
                    let sum: f32 = (0..channels)
                        .map(|ch| {
                            let plane = decoded.data(ch);
                            let shorts: &[i16] = unsafe {
                                std::slice::from_raw_parts(
                                    plane.as_ptr() as *const i16,
                                    nb_samples,
                                )
                            };
                            shorts[i] as f32 / 32768.0
                        })
                        .sum();
                    sum / channels as f32
                })
                .collect()
        }
        _ => {
            vec![0.0; nb_samples]
        }
    }
}

// ── Audio analysis ─────────────────────────────────────────────────

pub fn detect_silence(path: &str, threshold_db: f64, min_duration_ms: f64) -> Result<(Vec<Interval>, f64, Option<f64>), String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

    let mut input = format::input(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let audio_stream = match input.streams().best(media::Type::Audio) {
        Some(s) => s,
        None => return Ok((Vec::new(), threshold_db, None)),
    };

    let stream_index = audio_stream.index();
    let decoder_ctx = codec::context::Context::from_parameters(audio_stream.parameters())
        .map_err(|e| format!("Failed to create audio decoder: {}", e))?;
    let mut decoder = decoder_ctx
        .decoder()
        .audio()
        .map_err(|e| format!("Failed to open audio decoder: {}", e))?;

    let sample_rate = decoder.rate() as f64;
    let window_samples = (sample_rate * AUDIO_WINDOW_MS / 1000.0) as usize;
    if window_samples == 0 {
        return Ok((Vec::new(), threshold_db, None));
    }

    let mut buffer: VecDeque<f32> = VecDeque::with_capacity(window_samples * 4);
    let mut total_samples_processed: u64 = 0;
    let mut windows: Vec<AudioWindow> = Vec::new();

    for (stream, packet) in input.packets() {
        if stream.index() != stream_index {
            continue;
        }

        decoder.send_packet(&packet).ok();

        let mut decoded = frame::Audio::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            let mono_samples = samples_from_audio_frame(&decoded);
            for s in &mono_samples {
                buffer.push_back(*s);
            }

            while buffer.len() >= window_samples {
                let sum_sq: f64 = buffer
                    .iter()
                    .take(window_samples)
                    .map(|&s| (s as f64) * (s as f64))
                    .sum();
                buffer.drain(..window_samples);

                let rms = (sum_sq / window_samples as f64).sqrt();
                let time_ms = (total_samples_processed as f64 / sample_rate) * 1000.0;

                windows.push(AudioWindow {
                    time_ms,
                    rms_db: rms_to_db(rms),
                });
                total_samples_processed += window_samples as u64;
            }
        }
    }

    let (effective_threshold, noise_floor) = auto_calibrate_threshold(&windows, threshold_db);
    let raw_intervals = classify_with_hysteresis(&windows, effective_threshold, AUDIO_WINDOW_MS);
    let merged = merge_intervals(&raw_intervals, AUDIO_WINDOW_MS * 0.5);
    let filtered = filter_by_min_duration(&merged, min_duration_ms);

    Ok((filtered, effective_threshold, noise_floor))
}

// ── Video analysis ─────────────────────────────────────────────────

fn get_stream_fps(stream: &ffmpeg::Stream) -> f64 {
    let rate = stream.avg_frame_rate();
    if rate.denominator() > 0 && rate.numerator() > 0 {
        return rate.numerator() as f64 / rate.denominator() as f64;
    }
    let r_rate = stream.rate();
    if r_rate.denominator() > 0 && r_rate.numerator() > 0 {
        return r_rate.numerator() as f64 / r_rate.denominator() as f64;
    }
    30.0
}

fn extract_gray_pixels(
    gray_frame: &frame::Video,
    width: u32,
    height: u32,
    buf: &mut [u8],
) {
    let data = gray_frame.data(0);
    let stride = gray_frame.stride(0);
    for y in 0..height as usize {
        let src_start = y * stride;
        let dst_start = y * width as usize;
        let row_len = width as usize;
        if src_start + row_len <= data.len() && dst_start + row_len <= buf.len() {
            buf[dst_start..dst_start + row_len]
                .copy_from_slice(&data[src_start..src_start + row_len]);
        }
    }
}

fn compute_mad(a: &[u8], b: &[u8]) -> f64 {
    debug_assert_eq!(a.len(), b.len());
    let total_diff: u64 = a
        .iter()
        .zip(b.iter())
        .map(|(&x, &y)| (x as i32 - y as i32).unsigned_abs() as u64)
        .sum();
    total_diff as f64 / a.len() as f64 / 255.0
}

pub fn detect_freeze(
    path: &str,
    noise_threshold: f64,
    min_duration_ms: f64,
) -> Result<Vec<Interval>, String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

    let mut input = format::input(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let video_stream = input
        .streams()
        .best(media::Type::Video)
        .ok_or("No video stream found")?;

    let stream_index = video_stream.index();
    let time_base = video_stream.time_base();
    let tb_f64 = time_base.numerator() as f64 / time_base.denominator() as f64;
    let fps = get_stream_fps(&video_stream);
    let analysis_interval_ms = (1000.0 / fps * 2.0).clamp(66.0, 200.0);

    let decoder_ctx = codec::context::Context::from_parameters(video_stream.parameters())
        .map_err(|e| format!("Failed to create video decoder: {}", e))?;
    let mut decoder = decoder_ctx
        .decoder()
        .video()
        .map_err(|e| format!("Failed to open video decoder: {}", e))?;

    let src_width = decoder.width();
    let src_height = decoder.height();

    let mut scaler = ffmpeg::software::scaling::Context::get(
        decoder.format(),
        src_width,
        src_height,
        format::Pixel::GRAY8,
        ANALYSIS_W,
        ANALYSIS_H,
        ffmpeg::software::scaling::Flags::BILINEAR,
    )
    .map_err(|e| format!("Failed to create scaler: {}", e))?;

    let pixel_count = (ANALYSIS_W * ANALYSIS_H) as usize;
    let mut buf_a = vec![0u8; pixel_count];
    let mut buf_b = vec![0u8; pixel_count];
    let mut has_prev = false;
    let mut prev_time_ms: f64 = 0.0;
    let mut frozen_windows: Vec<Interval> = Vec::new();
    let mut last_analyzed_ms: f64 = -1000.0;
    let mut smoothed_mad: Option<f64> = None;

    for (stream, packet) in input.packets() {
        if stream.index() != stream_index {
            continue;
        }

        decoder.send_packet(&packet).ok();

        let mut decoded = frame::Video::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            let pts = decoded.pts().unwrap_or(0);
            let time_ms = pts as f64 * tb_f64 * 1000.0;

            if time_ms - last_analyzed_ms < analysis_interval_ms {
                continue;
            }
            last_analyzed_ms = time_ms;

            let mut gray_frame = frame::Video::empty();
            scaler
                .run(&decoded, &mut gray_frame)
                .map_err(|e| format!("Scaler failed: {}", e))?;

            let (current, prev) = if has_prev {
                (&mut buf_b, &buf_a)
            } else {
                (&mut buf_a, &buf_b)
            };

            extract_gray_pixels(&gray_frame, ANALYSIS_W, ANALYSIS_H, current);

            if has_prev {
                let raw_mad = compute_mad(current, prev);
                let smooth = match smoothed_mad {
                    Some(prev_s) => FREEZE_SMOOTHING_ALPHA * raw_mad + (1.0 - FREEZE_SMOOTHING_ALPHA) * prev_s,
                    None => raw_mad,
                };
                smoothed_mad = Some(smooth);

                if smooth < noise_threshold {
                    frozen_windows.push(Interval {
                        start_ms: prev_time_ms,
                        end_ms: time_ms,
                    });
                }
            }

            has_prev = true;
            prev_time_ms = time_ms;
            std::mem::swap(&mut buf_a, &mut buf_b);
        }
    }

    let merged = merge_intervals(&frozen_windows, analysis_interval_ms * 1.5);
    Ok(filter_by_min_duration(&merged, min_duration_ms))
}

// ── Pipeline ───────────────────────────────────────────────────────

pub fn get_duration_ms(path: &str) -> Result<f64, String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;
    let input = format::input(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let duration_ts = input.duration();
    if duration_ts > 0 {
        return Ok(duration_ts as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE) * 1000.0);
    }

    if let Some(stream) = input.streams().best(media::Type::Video) {
        let tb = stream.time_base();
        let dur = stream.duration();
        if dur > 0 {
            return Ok(dur as f64 * tb.numerator() as f64 / tb.denominator() as f64 * 1000.0);
        }
    }

    Err("Could not determine duration".to_string())
}

fn has_audio_stream(path: &str) -> bool {
    ffmpeg::init().ok();
    match format::input(path) {
        Ok(ctx) => ctx.streams().best(media::Type::Audio).is_some(),
        Err(_) => false,
    }
}

pub fn detect(path: &str, config: &DetectionConfig) -> Result<DetectionResult, String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

    let started = Instant::now();
    let duration_ms = get_duration_ms(path)?;
    let has_audio = has_audio_stream(path);

    eprintln!(
        "[DeadZone] Analyzing: {} (duration={:.0}ms, audio={})",
        path, duration_ms, has_audio
    );

    let (silence_result, freeze_result) = std::thread::scope(|s| {
        let audio_handle = if has_audio {
            Some(s.spawn(|| {
                detect_silence(path, config.silence_threshold_db, config.silence_min_duration_ms)
            }))
        } else {
            None
        };

        let freeze = detect_freeze(
            path,
            config.freeze_noise_threshold,
            config.freeze_min_duration_ms,
        );

        let audio = match audio_handle {
            Some(h) => h.join().map_err(|_| "Audio analysis thread panicked".to_string())?,
            None => Ok((Vec::new(), config.silence_threshold_db, None)),
        };

        Ok::<_, String>((audio?, freeze?))
    })?;

    let (silence_intervals, effective_threshold, noise_floor) = silence_result;
    let freeze_intervals = freeze_result;

    eprintln!(
        "[DeadZone] Found {} silence, {} freeze intervals (threshold={:.1}dB, floor={:.1}dB)",
        silence_intervals.len(),
        freeze_intervals.len(),
        effective_threshold,
        noise_floor.unwrap_or(-100.0),
    );

    let dead_zones = if has_audio {
        let intersected = intersect_intervals(&silence_intervals, &freeze_intervals);
        filter_by_min_duration(&intersected, config.min_dead_zone_ms)
    } else {
        filter_by_min_duration(&freeze_intervals, config.min_dead_zone_ms)
    };

    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "[DeadZone] Detected {} dead zones in {:.0}ms",
        dead_zones.len(),
        elapsed
    );

    Ok(DetectionResult {
        dead_zones: dead_zones
            .into_iter()
            .map(|iv| DeadZone {
                start_ms: iv.start_ms,
                end_ms: iv.end_ms,
            })
            .collect(),
        has_audio,
        duration_ms,
        metrics: DetectionMetrics {
            silence_intervals_found: silence_intervals.len(),
            freeze_intervals_found: freeze_intervals.len(),
            effective_silence_threshold_db: effective_threshold,
            audio_noise_floor_db: noise_floor,
            analysis_duration_ms: elapsed,
        },
    })
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Interval math ──────────────────────────────────────────

    #[test]
    fn merge_empty() {
        assert!(merge_intervals(&[], 0.0).is_empty());
    }

    #[test]
    fn merge_single() {
        let intervals = vec![Interval { start_ms: 100.0, end_ms: 200.0 }];
        let merged = merge_intervals(&intervals, 0.0);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_ms, 100.0);
        assert_eq!(merged[0].end_ms, 200.0);
    }

    #[test]
    fn merge_overlapping() {
        let intervals = vec![
            Interval { start_ms: 100.0, end_ms: 300.0 },
            Interval { start_ms: 200.0, end_ms: 500.0 },
        ];
        let merged = merge_intervals(&intervals, 0.0);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_ms, 100.0);
        assert_eq!(merged[0].end_ms, 500.0);
    }

    #[test]
    fn merge_with_gap_tolerance() {
        let intervals = vec![
            Interval { start_ms: 100.0, end_ms: 200.0 },
            Interval { start_ms: 250.0, end_ms: 400.0 },
        ];
        let merged = merge_intervals(&intervals, 60.0);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_ms, 100.0);
        assert_eq!(merged[0].end_ms, 400.0);
    }

    #[test]
    fn merge_disjoint() {
        let intervals = vec![
            Interval { start_ms: 100.0, end_ms: 200.0 },
            Interval { start_ms: 500.0, end_ms: 600.0 },
        ];
        let merged = merge_intervals(&intervals, 0.0);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn merge_unsorted() {
        let intervals = vec![
            Interval { start_ms: 500.0, end_ms: 600.0 },
            Interval { start_ms: 100.0, end_ms: 200.0 },
            Interval { start_ms: 150.0, end_ms: 250.0 },
        ];
        let merged = merge_intervals(&intervals, 0.0);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].start_ms, 100.0);
        assert_eq!(merged[0].end_ms, 250.0);
        assert_eq!(merged[1].start_ms, 500.0);
        assert_eq!(merged[1].end_ms, 600.0);
    }

    #[test]
    fn merge_many_contiguous_windows() {
        let intervals: Vec<Interval> = (0..50)
            .map(|i| Interval {
                start_ms: i as f64 * 100.0,
                end_ms: (i + 1) as f64 * 100.0,
            })
            .collect();
        let merged = merge_intervals(&intervals, 0.0);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_ms, 0.0);
        assert_eq!(merged[0].end_ms, 5000.0);
    }

    #[test]
    fn filter_min_duration() {
        let intervals = vec![
            Interval { start_ms: 0.0, end_ms: 100.0 },
            Interval { start_ms: 200.0, end_ms: 1500.0 },
            Interval { start_ms: 2000.0, end_ms: 2200.0 },
        ];
        let filtered = filter_by_min_duration(&intervals, 500.0);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].start_ms, 200.0);
    }

    #[test]
    fn intersect_empty() {
        let a = vec![Interval { start_ms: 0.0, end_ms: 100.0 }];
        assert!(intersect_intervals(&a, &[]).is_empty());
        assert!(intersect_intervals(&[], &a).is_empty());
    }

    #[test]
    fn intersect_no_overlap() {
        let a = vec![Interval { start_ms: 0.0, end_ms: 100.0 }];
        let b = vec![Interval { start_ms: 200.0, end_ms: 300.0 }];
        assert!(intersect_intervals(&a, &b).is_empty());
    }

    #[test]
    fn intersect_full_overlap() {
        let a = vec![Interval { start_ms: 100.0, end_ms: 500.0 }];
        let b = vec![Interval { start_ms: 100.0, end_ms: 500.0 }];
        let result = intersect_intervals(&a, &b);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].start_ms, 100.0);
        assert_eq!(result[0].end_ms, 500.0);
    }

    #[test]
    fn intersect_partial_overlap() {
        let a = vec![Interval { start_ms: 100.0, end_ms: 400.0 }];
        let b = vec![Interval { start_ms: 300.0, end_ms: 600.0 }];
        let result = intersect_intervals(&a, &b);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].start_ms, 300.0);
        assert_eq!(result[0].end_ms, 400.0);
    }

    #[test]
    fn intersect_contained() {
        let a = vec![Interval { start_ms: 100.0, end_ms: 500.0 }];
        let b = vec![Interval { start_ms: 200.0, end_ms: 300.0 }];
        let result = intersect_intervals(&a, &b);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].start_ms, 200.0);
        assert_eq!(result[0].end_ms, 300.0);
    }

    #[test]
    fn intersect_multiple() {
        let a = vec![
            Interval { start_ms: 0.0, end_ms: 1000.0 },
            Interval { start_ms: 2000.0, end_ms: 3000.0 },
        ];
        let b = vec![
            Interval { start_ms: 500.0, end_ms: 1500.0 },
            Interval { start_ms: 2500.0, end_ms: 4000.0 },
        ];
        let result = intersect_intervals(&a, &b);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].start_ms, 500.0);
        assert_eq!(result[0].end_ms, 1000.0);
        assert_eq!(result[1].start_ms, 2500.0);
        assert_eq!(result[1].end_ms, 3000.0);
    }

    #[test]
    fn intersect_one_spans_multiple() {
        let a = vec![Interval { start_ms: 0.0, end_ms: 10000.0 }];
        let b = vec![
            Interval { start_ms: 1000.0, end_ms: 2000.0 },
            Interval { start_ms: 3000.0, end_ms: 4000.0 },
            Interval { start_ms: 5000.0, end_ms: 6000.0 },
        ];
        let result = intersect_intervals(&a, &b);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn intersect_adjacent_touching() {
        let a = vec![Interval { start_ms: 0.0, end_ms: 100.0 }];
        let b = vec![Interval { start_ms: 100.0, end_ms: 200.0 }];
        assert!(intersect_intervals(&a, &b).is_empty());
    }

    // ── Audio helpers ──────────────────────────────────────────

    #[test]
    fn rms_to_db_values() {
        assert!((rms_to_db(1.0) - 0.0).abs() < 0.001);
        assert!((rms_to_db(0.1) - (-20.0)).abs() < 0.001);
        assert!((rms_to_db(0.01) - (-40.0)).abs() < 0.001);
        assert!(rms_to_db(0.0) < -90.0);
    }

    #[test]
    fn percentile_basic() {
        let vals = vec![-60.0, -50.0, -40.0, -30.0, -20.0, -10.0, 0.0];
        assert!((percentile(&vals, 0.0) - (-60.0)).abs() < 0.001);
        assert!((percentile(&vals, 1.0) - 0.0).abs() < 0.001);
        assert!((percentile(&vals, 0.5) - (-30.0)).abs() < 0.001);
    }

    #[test]
    fn percentile_empty() {
        assert_eq!(percentile(&[], 0.5), -100.0);
    }

    #[test]
    fn auto_calibrate_quiet_recording() {
        let windows: Vec<AudioWindow> = (0..100)
            .map(|_| AudioWindow { time_ms: 0.0, rms_db: -60.0 })
            .collect();
        let (threshold, floor) = auto_calibrate_threshold(&windows, -30.0);
        assert!(threshold >= -30.0, "should not lower threshold");
        assert!(floor.unwrap() < -50.0);
    }

    #[test]
    fn auto_calibrate_noisy_recording() {
        let windows: Vec<AudioWindow> = (0..100)
            .map(|_| AudioWindow { time_ms: 0.0, rms_db: -20.0 })
            .collect();
        let (threshold, floor) = auto_calibrate_threshold(&windows, -30.0);
        assert!(
            threshold > -20.0,
            "should raise threshold above noise floor: got {}",
            threshold
        );
    }

    #[test]
    fn auto_calibrate_empty() {
        let (threshold, floor) = auto_calibrate_threshold(&[], -30.0);
        assert_eq!(threshold, -30.0);
        assert!(floor.is_none());
    }

    // ── Hysteresis ─────────────────────────────────────────────

    #[test]
    fn hysteresis_basic_silence() {
        let windows: Vec<AudioWindow> = (0..20)
            .map(|i| {
                let db = if (5..15).contains(&i) { -40.0 } else { -10.0 };
                AudioWindow { time_ms: i as f64 * 100.0, rms_db: db }
            })
            .collect();
        let intervals = classify_with_hysteresis(&windows, -30.0, 100.0);
        assert_eq!(intervals.len(), 1);
        assert_eq!(intervals[0].start_ms, 500.0);
        assert_eq!(intervals[0].end_ms, 1500.0);
    }

    #[test]
    fn hysteresis_prevents_flicker() {
        let windows = vec![
            AudioWindow { time_ms: 0.0, rms_db: -10.0 },
            AudioWindow { time_ms: 100.0, rms_db: -35.0 },
            AudioWindow { time_ms: 200.0, rms_db: -29.0 },
            AudioWindow { time_ms: 300.0, rms_db: -35.0 },
            AudioWindow { time_ms: 400.0, rms_db: -29.0 },
            AudioWindow { time_ms: 500.0, rms_db: -35.0 },
            AudioWindow { time_ms: 600.0, rms_db: -10.0 },
        ];
        let intervals = classify_with_hysteresis(&windows, -30.0, 100.0);
        assert_eq!(intervals.len(), 1, "hysteresis should merge flickering into one interval");
        assert_eq!(intervals[0].start_ms, 100.0);
        assert_eq!(intervals[0].end_ms, 600.0);
    }

    #[test]
    fn hysteresis_trailing_silence() {
        let windows = vec![
            AudioWindow { time_ms: 0.0, rms_db: -10.0 },
            AudioWindow { time_ms: 100.0, rms_db: -40.0 },
            AudioWindow { time_ms: 200.0, rms_db: -40.0 },
        ];
        let intervals = classify_with_hysteresis(&windows, -30.0, 100.0);
        assert_eq!(intervals.len(), 1);
        assert_eq!(intervals[0].start_ms, 100.0);
        assert_eq!(intervals[0].end_ms, 300.0);
    }

    // ── Video helpers ──────────────────────────────────────────

    #[test]
    fn compute_mad_identical() {
        let a = vec![128u8; 100];
        assert_eq!(compute_mad(&a, &a), 0.0);
    }

    #[test]
    fn compute_mad_opposite() {
        let a = vec![0u8; 100];
        let b = vec![255u8; 100];
        assert!((compute_mad(&a, &b) - 1.0).abs() < 0.001);
    }

    #[test]
    fn compute_mad_small_diff() {
        let a = vec![128u8; 1000];
        let b: Vec<u8> = a.iter().map(|&v| v.wrapping_add(1)).collect();
        let mad = compute_mad(&a, &b);
        assert!(mad < 0.005, "single-step diff should be very small: {}", mad);
    }

    // ── Config ─────────────────────────────────────────────────

    #[test]
    fn config_defaults() {
        let config = DetectionConfig::default();
        assert_eq!(config.silence_threshold_db, -30.0);
        assert_eq!(config.silence_min_duration_ms, 500.0);
        assert_eq!(config.freeze_noise_threshold, 0.003);
        assert_eq!(config.freeze_min_duration_ms, 500.0);
        assert_eq!(config.min_dead_zone_ms, 1000.0);
    }

    #[test]
    fn config_deserialization() {
        let json = r#"{
            "silenceThresholdDb": -25.0,
            "silenceMinDurationMs": 300.0,
            "freezeNoiseThreshold": 0.005,
            "freezeMinDurationMs": 400.0,
            "minDeadZoneMs": 800.0
        }"#;
        let config: DetectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.silence_threshold_db, -25.0);
        assert_eq!(config.silence_min_duration_ms, 300.0);
    }

    // ── Serialization ──────────────────────────────────────────

    #[test]
    fn dead_zone_serialization() {
        let dz = DeadZone { start_ms: 1500.0, end_ms: 3000.0 };
        let json = serde_json::to_string(&dz).unwrap();
        assert!(json.contains("\"startMs\":1500"));
        assert!(json.contains("\"endMs\":3000"));
    }

    #[test]
    fn detection_result_with_metrics_serialization() {
        let result = DetectionResult {
            dead_zones: vec![DeadZone { start_ms: 1000.0, end_ms: 2000.0 }],
            has_audio: true,
            duration_ms: 10000.0,
            metrics: DetectionMetrics {
                silence_intervals_found: 3,
                freeze_intervals_found: 5,
                effective_silence_threshold_db: -28.0,
                audio_noise_floor_db: Some(-55.0),
                analysis_duration_ms: 1234.0,
            },
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"metrics\""));
        assert!(json.contains("\"silenceIntervalsFound\":3"));
        assert!(json.contains("\"effectiveSilenceThresholdDb\":-28"));
        assert!(json.contains("\"audioNoiseFloorDb\":-55"));
    }

    // ── Error paths ────────────────────────────────────────────

    #[test]
    fn detect_silence_nonexistent_file() {
        let result = detect_silence("/nonexistent/file.mp4", -30.0, 500.0);
        assert!(result.is_err());
    }

    #[test]
    fn detect_freeze_nonexistent_file() {
        let result = detect_freeze("/nonexistent/file.mp4", 0.003, 500.0);
        assert!(result.is_err());
    }

    // ── Full pipeline ──────────────────────────────────────────

    #[test]
    fn full_pipeline_logic() {
        let silence = vec![
            Interval { start_ms: 0.0, end_ms: 2000.0 },
            Interval { start_ms: 5000.0, end_ms: 8000.0 },
            Interval { start_ms: 12000.0, end_ms: 15000.0 },
        ];
        let freeze = vec![
            Interval { start_ms: 500.0, end_ms: 1500.0 },
            Interval { start_ms: 6000.0, end_ms: 9000.0 },
        ];
        let intersected = intersect_intervals(&silence, &freeze);
        let filtered = filter_by_min_duration(&intersected, 1000.0);

        assert_eq!(intersected.len(), 2);
        assert_eq!(intersected[0].start_ms, 500.0);
        assert_eq!(intersected[0].end_ms, 1500.0);
        assert_eq!(intersected[1].start_ms, 6000.0);
        assert_eq!(intersected[1].end_ms, 8000.0);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn pre_filter_reduces_noise() {
        let raw_silence = vec![
            Interval { start_ms: 0.0, end_ms: 50.0 },
            Interval { start_ms: 100.0, end_ms: 150.0 },
            Interval { start_ms: 1000.0, end_ms: 3000.0 },
        ];
        let raw_freeze = vec![
            Interval { start_ms: 0.0, end_ms: 60.0 },
            Interval { start_ms: 1000.0, end_ms: 3000.0 },
        ];

        let filtered_s = filter_by_min_duration(&raw_silence, 500.0);
        let filtered_f = filter_by_min_duration(&raw_freeze, 500.0);
        let intersected = intersect_intervals(&filtered_s, &filtered_f);

        assert_eq!(filtered_s.len(), 1);
        assert_eq!(filtered_f.len(), 1);
        assert_eq!(intersected.len(), 1);
        assert_eq!(intersected[0].start_ms, 1000.0);
        assert_eq!(intersected[0].end_ms, 3000.0);
    }
}
