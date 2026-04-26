mod common;

use common::*;
use openscreen::encoder::{EncoderConfig, NvencEncoder};

// ─── Basic encode → valid MP4 ───────────────────────────────────

#[test]
fn encode_30_frames_produces_valid_mp4() {
    let out = TempFile::new("ep_basic.mp4");
    VideoOnlyMp4::default().with_frames(30).build(out.path());

    assert_valid_mp4(out.path());
    assert_has_video(out.path());
    assert_decodable(out.path());
}

// ─── 1080p encode ───────────────────────────────────────────────

#[test]
fn encode_1080p_produces_valid_mp4() {
    let out = TempFile::new("ep_1080p.mp4");
    VideoOnlyMp4::default()
        .with_resolution(1920, 1080)
        .with_frames(5)
        .build(out.path());

    assert_valid_mp4(out.path());
    assert_has_video(out.path());
    let size = std::fs::metadata(out.path()).unwrap().len();
    assert!(size > 1000, "1080p output too small: {} bytes", size);
}

// ─── File-based frame feeding (simulates TS → Rust flow) ────────

#[test]
fn file_based_feeding_round_trip() {
    let out = TempFile::new("ep_file_feed.mp4");

    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    let size = (320 * 240 * 4) as usize;

    for i in 0..10u32 {
        // Simulate: TS writes RGBA to temp file, Rust reads and encodes
        let frame_file = TempFile::new(&format!("ep_frame_{}.raw", i));
        let rgba: Vec<u8> = (0..size).map(|j| ((j + i as usize * 25) % 256) as u8).collect();
        std::fs::write(frame_file.path(), &rgba).unwrap();

        let read_back = std::fs::read(frame_file.path()).unwrap();
        assert_eq!(read_back.len(), size);

        enc.encode_rgba_frame(&read_back, 320, 240, i % 15 == 0).unwrap();
    }

    assert_eq!(enc.frame_count(), 10);
    enc.finalize().unwrap();

    assert_valid_mp4(out.path());
    assert_decodable(out.path());
}

// ─── Wrong frame size rejected ──────────────────────────────────

#[test]
fn rejects_wrong_frame_size() {
    let out = TempFile::new("ep_wrong_size.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };

    let mut enc = NvencEncoder::new(&config).unwrap();
    let bad_data = vec![0u8; 100];

    let result = enc.encode_rgba_frame(&bad_data, 320, 240, true);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("size mismatch"));
}

// ─── High frame count stress test ───────────────────────────────

#[test]
fn high_frame_count_300_frames() {
    let out = TempFile::new("ep_300_frames.mp4");
    VideoOnlyMp4::default()
        .with_fps(60)
        .with_frames(300)
        .build(out.path());

    assert_valid_mp4(out.path());
    assert_has_video(out.path());
    assert_duration_approx(out.path(), 5.0, 1.0);
}

// ─── Sequential sessions to same path ───────────────────────────

#[test]
fn sequential_sessions_overwrite_cleanly() {
    let out = TempFile::new("ep_sequential.mp4");

    for _ in 0..3 {
        VideoOnlyMp4::default().with_frames(5).build(out.path());
    }

    assert_valid_mp4(out.path());
}

// ─── Single frame ───────────────────────────────────────────────

#[test]
fn single_frame_finalizes() {
    let out = TempFile::new("ep_single.mp4");

    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 1,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    enc.encode_rgba_frame(&vec![255u8; 160 * 120 * 4], 160, 120, true).unwrap();
    assert_eq!(enc.frame_count(), 1);
    enc.finalize().unwrap();

    assert!(out.path().exists());
}
