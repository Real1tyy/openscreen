mod common;

use common::*;
use openscreen::encoder::EncoderConfig;
use openscreen::pipeline::PipelinedEncoder;
use std::time::Instant;

fn make_rgba(w: u32, h: u32, seed: u8) -> Vec<u8> {
    let size = (w * h * 4) as usize;
    let mut rgba = vec![0u8; size];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[0] = seed;
        pixel[1] = 128;
        pixel[2] = 255u8.wrapping_sub(seed);
        pixel[3] = 255;
    }
    rgba
}

fn gradient_rgba(w: u32, h: u32, frame: u32) -> Vec<u8> {
    let size = (w * h * 4) as usize;
    let mut rgba = vec![0u8; size];
    for y in 0..h {
        for x in 0..w {
            let idx = ((y * w + x) * 4) as usize;
            rgba[idx] = ((x + frame * 10) % 256) as u8;
            rgba[idx + 1] = ((y + frame * 5) % 256) as u8;
            rgba[idx + 2] = 128;
            rgba[idx + 3] = 255;
        }
    }
    rgba
}

// ─── Pipeline produces valid MP4 ────────────────────────────────

#[test]
fn pipeline_produces_valid_mp4() {
    let out = TempFile::new("pi_valid.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    for i in 0..30u8 {
        pipeline
            .send_frame(make_rgba(320, 240, i.wrapping_mul(8)), 320, 240, i % 15 == 0)
            .unwrap();
    }

    pipeline.finalize().unwrap();
    assert_valid_mp4(out.path());
    assert_has_video(out.path());
    assert_decodable(out.path());
}

// ─── Pipeline 1080p produces valid output ───────────────────────

#[test]
fn pipeline_1080p_valid() {
    let out = TempFile::new("pi_1080p.mp4");
    let config = EncoderConfig {
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: 8_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    for i in 0..5u8 {
        pipeline
            .send_frame(make_rgba(1920, 1080, i.wrapping_mul(50)), 1920, 1080, i == 0)
            .unwrap();
    }

    pipeline.finalize().unwrap();
    assert_valid_mp4(out.path());
    assert_has_video(out.path());
    let size = std::fs::metadata(out.path()).unwrap().len();
    assert!(size > 1000, "1080p output too small: {} bytes", size);
}

// ─── Pipeline file-based feeding (simulates TS→Rust flow) ──────

#[test]
fn pipeline_file_based_feeding() {
    let out = TempFile::new("pi_file_feed.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    for i in 0..10u32 {
        // Simulate: TS writes RGBA to temp file, Rust reads and feeds pipeline
        let frame_file = TempFile::new(&format!("pi_frame_{}.raw", i));
        let rgba = gradient_rgba(320, 240, i);
        std::fs::write(frame_file.path(), &rgba).unwrap();

        let read_back = std::fs::read(frame_file.path()).unwrap();
        assert_eq!(read_back.len(), (320 * 240 * 4) as usize);

        pipeline
            .send_frame(read_back, 320, 240, i % 15 == 0)
            .unwrap();
    }

    pipeline.finalize().unwrap();
    assert_valid_mp4(out.path());
    assert_decodable(out.path());
}

// ─── Pipeline rejects wrong frame size ──────────────────────────

#[test]
fn pipeline_rejects_wrong_size() {
    let out = TempFile::new("pi_wrong_size.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    pipeline
        .send_frame(vec![0u8; 100], 320, 240, true)
        .ok();

    // Error surfaces asynchronously
    std::thread::sleep(std::time::Duration::from_millis(50));
    let result = pipeline.send_frame(vec![0u8; 100], 320, 240, false);
    if result.is_ok() {
        let fin = pipeline.finalize();
        assert!(fin.is_err());
    } else {
        assert!(result.unwrap_err().contains("size mismatch"));
    }
}

// ─── Pipeline 300 frames stress test ────────────────────────────

#[test]
fn pipeline_high_frame_count() {
    let out = TempFile::new("pi_300.mp4");
    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 60,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    for i in 0..300u16 {
        pipeline
            .send_frame(make_rgba(160, 120, (i % 256) as u8), 160, 120, i % 60 == 0)
            .unwrap();
    }

    pipeline.finalize().unwrap();
    assert_valid_mp4(out.path());
    assert_has_video(out.path());
    assert_duration_approx(out.path(), 5.0, 1.0);
}

// ─── Pipeline cancel (drop) doesn't panic ───────────────────────

#[test]
fn pipeline_cancel_no_panic() {
    let out = TempFile::new("pi_cancel.mp4");
    let config = EncoderConfig {
        width: 160,
        height: 120,
        fps: 10,
        bitrate: 500_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    let rgba = make_rgba(160, 120, 128);
    for i in 0..5 {
        pipeline.send_frame(rgba.clone(), 160, 120, i == 0).unwrap();
    }

    drop(pipeline); // cancel without finalize
}

// ─── Multiple concurrent pipelines ──────────────────────────────

#[test]
fn concurrent_pipelines() {
    let outs: Vec<TempFile> = (0..3)
        .map(|i| TempFile::new(&format!("pi_concurrent_{}.mp4", i)))
        .collect();

    let pipelines: Vec<PipelinedEncoder> = outs
        .iter()
        .map(|out| {
            let config = EncoderConfig {
                width: 160,
                height: 120,
                fps: 10,
                bitrate: 500_000,
                output_path: out.path().to_string_lossy().to_string(),
            };
            PipelinedEncoder::new(config).unwrap()
        })
        .collect();

    let rgba = make_rgba(160, 120, 128);
    for pipeline in &pipelines {
        for i in 0..10 {
            pipeline
                .send_frame(rgba.clone(), 160, 120, i == 0)
                .unwrap();
        }
    }

    for pipeline in pipelines {
        let result = pipeline.finalize().unwrap();
        assert!(result.exists());
        assert_valid_mp4(&result);
    }
}

// ─── Pipeline output is FFmpeg-playable ─────────────────────────

#[test]
fn pipeline_output_playable() {
    let out = TempFile::new("pi_playable.mp4");
    let config = EncoderConfig {
        width: 640,
        height: 480,
        fps: 24,
        bitrate: 2_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    for i in 0..24u32 {
        pipeline
            .send_frame(gradient_rgba(640, 480, i), 640, 480, i % 12 == 0)
            .unwrap();
    }

    pipeline.finalize().unwrap();
    assert_decodable(out.path());
}

// ─── Pipeline throughput test (non-blocking send) ───────────────

#[test]
fn pipeline_send_is_nonblocking_within_buffer() {
    let out = TempFile::new("pi_nonblock.mp4");
    let config = EncoderConfig {
        width: 320,
        height: 240,
        fps: 30,
        bitrate: 1_000_000,
        output_path: out.path().to_string_lossy().to_string(),
    };
    let pipeline = PipelinedEncoder::new(config).unwrap();

    // The pipeline buffer is 4 frames — first 4 sends should be near-instant
    let start = Instant::now();
    for i in 0..4u8 {
        pipeline
            .send_frame(make_rgba(320, 240, i), 320, 240, i == 0)
            .unwrap();
    }
    let elapsed = start.elapsed();

    // 4 sends should take less than 100ms (just memory copies)
    assert!(
        elapsed.as_millis() < 100,
        "First 4 sends took {}ms — expected < 100ms",
        elapsed.as_millis()
    );

    // Feed a few more and finalize
    for i in 4..30u8 {
        pipeline
            .send_frame(make_rgba(320, 240, i), 320, 240, i % 15 == 0)
            .unwrap();
    }
    pipeline.finalize().unwrap();
    assert_valid_mp4(out.path());
}

// ─── Sequential pipelines to same path ──────────────────────────

#[test]
fn sequential_pipelines_overwrite() {
    let out = TempFile::new("pi_sequential.mp4");
    let rgba = make_rgba(160, 120, 100);

    for _ in 0..3 {
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: out.path().to_string_lossy().to_string(),
        };
        let pipeline = PipelinedEncoder::new(config).unwrap();
        for i in 0..5 {
            pipeline.send_frame(rgba.clone(), 160, 120, i == 0).unwrap();
        }
        pipeline.finalize().unwrap();
    }

    assert_valid_mp4(out.path());
}
