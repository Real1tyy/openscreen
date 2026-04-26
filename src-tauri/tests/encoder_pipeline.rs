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

// ─── Cancel mid-encoding (drop without finalize) ────────────────

#[test]
fn cancel_mid_encoding_no_panic() {
    let out = TempFile::new("ep_cancel.mp4");
    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 10,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    let rgba = vec![128u8; 160 * 120 * 4];
    for i in 0..5 {
        enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
    }
    assert_eq!(enc.frame_count(), 5);
    drop(enc); // drop without finalize — must not panic
}

// ─── Concurrent sessions ────────────────────────────────────────

#[test]
fn concurrent_sessions_independent() {
    let out_a = TempFile::new("ep_concurrent_a.mp4");
    let out_b = TempFile::new("ep_concurrent_b.mp4");

    let config_a = EncoderConfig {
        width: 160,
        height: 120,
        fps: 10,
        bitrate: 500_000,
        output_path: out_a.path().to_string_lossy().to_string(),
    };
    let config_b = EncoderConfig {
        width: 320,
        height: 240,
        fps: 15,
        bitrate: 1_000_000,
        output_path: out_b.path().to_string_lossy().to_string(),
    };

    let mut enc_a = NvencEncoder::new(&config_a).unwrap();
    let mut enc_b = NvencEncoder::new(&config_b).unwrap();

    let rgba_a = vec![100u8; 160 * 120 * 4];
    let rgba_b = vec![200u8; 320 * 240 * 4];

    // Interleave feeding
    for i in 0..10 {
        enc_a.encode_rgba_frame(&rgba_a, 160, 120, i == 0).unwrap();
        enc_b.encode_rgba_frame(&rgba_b, 320, 240, i == 0).unwrap();
    }

    assert_eq!(enc_a.frame_count(), 10);
    assert_eq!(enc_b.frame_count(), 10);

    enc_a.finalize().unwrap();
    enc_b.finalize().unwrap();

    assert_valid_mp4(out_a.path());
    assert_valid_mp4(out_b.path());
    assert_decodable(out_a.path());
    assert_decodable(out_b.path());
}

// ─── Rapid alternating frames (stress encoder) ──────────────────

#[test]
fn rapid_color_alternation() {
    let out = TempFile::new("ep_rapid.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 60,
        bitrate: 4_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    let size = (320 * 240 * 4) as usize;

    for i in 0..60 {
        let val = if i % 2 == 0 { 0u8 } else { 255u8 };
        let mut rgba = vec![0u8; size];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = val;
            pixel[1] = 255 - val;
            pixel[2] = val;
            pixel[3] = 255;
        }
        enc.encode_rgba_frame(&rgba, 320, 240, i % 30 == 0).unwrap();
    }

    enc.finalize().unwrap();
    assert_valid_mp4(out.path());
    let size = std::fs::metadata(out.path()).unwrap().len();
    assert!(size > 100, "Output too small: {} bytes", size);
}

// ─── All-black frames (edge case compression) ──────────────────

#[test]
fn all_black_frames() {
    let out = TempFile::new("ep_black.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    let mut rgba = vec![0u8; 320 * 240 * 4];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    for i in 0..30 {
        enc.encode_rgba_frame(&rgba, 320, 240, i == 0).unwrap();
    }
    enc.finalize().unwrap();
    assert_valid_mp4(out.path());
}

// ─── All-white frames ──────────────────────────────────────────

#[test]
fn all_white_frames() {
    let out = TempFile::new("ep_white.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    let rgba = vec![255u8; 320 * 240 * 4];
    for i in 0..30 {
        enc.encode_rgba_frame(&rgba, 320, 240, i == 0).unwrap();
    }
    enc.finalize().unwrap();
    assert_valid_mp4(out.path());
}

// ─── Even but unusual dimensions ────────────────────────────────

#[test]
fn unusual_dimensions_322x242() {
    let out = TempFile::new("ep_unusual_dim.mp4");
    VideoOnlyMp4::default()
        .with_resolution(322, 242)
        .with_frames(5)
        .build(out.path());

    assert_valid_mp4(out.path());
    assert_has_video(out.path());
}

// ─── Every frame is a keyframe ──────────────────────────────────

#[test]
fn all_keyframes() {
    let out = TempFile::new("ep_allkeys.mp4");
    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 30,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    let rgba = vec![128u8; 160 * 120 * 4];
    for _ in 0..10 {
        enc.encode_rgba_frame(&rgba, 160, 120, true).unwrap();
    }
    enc.finalize().unwrap();
    assert_valid_mp4(out.path());
    assert!(std::fs::metadata(out.path()).unwrap().len() > 0);
}

// ─── Frame count matches what was fed ───────────────────────────

#[test]
fn frame_count_accurate() {
    let out = TempFile::new("ep_count.mp4");
    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 10,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let mut enc = NvencEncoder::new(&config).unwrap();
    assert_eq!(enc.frame_count(), 0);

    let rgba = vec![128u8; 160 * 120 * 4];
    for i in 0..42 {
        enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
    }
    assert_eq!(enc.frame_count(), 42);
    enc.finalize().unwrap();
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
