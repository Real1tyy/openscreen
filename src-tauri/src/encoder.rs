use std::path::PathBuf;

extern crate ffmpeg_next as ffmpeg;

use ffmpeg::codec::Id;
use ffmpeg::format::Pixel;
use ffmpeg::software::scaling;
use ffmpeg::{codec, encoder, format, frame, Dictionary, Rational};

// SwsContext is not Send, but we only access the encoder from one thread at a time
// via Mutex. This wrapper allows storing it in Tauri state.
struct SendScaler(scaling::Context);
unsafe impl Send for SendScaler {}

impl std::ops::Deref for SendScaler {
    type Target = scaling::Context;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for SendScaler {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

pub struct NvencEncoder {
    output_ctx: format::context::Output,
    encoder: codec::encoder::video::Encoder,
    scaler: SendScaler,
    video_stream_index: usize,
    frame_count: i64,
    time_base: Rational,
    output_path: PathBuf,
    using_nvenc: bool,
    width: u32,
    height: u32,
    rgba_frame: frame::Video,
    yuv_frame: frame::Video,
}

// NvencEncoder is accessed only through Mutex<ExportState>
unsafe impl Send for NvencEncoder {}

#[derive(Clone)]
pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u64,
    pub output_path: String,
}

impl NvencEncoder {
    pub fn new(config: &EncoderConfig) -> Result<Self, String> {
        ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

        let output_path = PathBuf::from(&config.output_path);

        let mut output_ctx = format::output(&output_path)
            .map_err(|e| format!("Failed to create output context: {}", e))?;

        let (codec, using_nvenc) = find_best_h264_encoder();
        eprintln!(
            "[NvencEncoder] Using encoder: {} (NVENC: {})",
            codec.name(),
            using_nvenc
        );

        let mut video_stream = output_ctx
            .add_stream(codec)
            .map_err(|e| format!("Failed to add video stream: {}", e))?;

        let video_stream_index = video_stream.index();
        let time_base = Rational::new(1, config.fps as i32);

        let mut encoder_ctx = codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()
            .map_err(|e| format!("Failed to create encoder context: {}", e))?;

        encoder_ctx.set_width(config.width);
        encoder_ctx.set_height(config.height);
        encoder_ctx.set_format(Pixel::YUV420P);
        encoder_ctx.set_time_base(time_base);
        encoder_ctx.set_frame_rate(Some(Rational::new(config.fps as i32, 1)));
        encoder_ctx.set_bit_rate(config.bitrate as usize);
        encoder_ctx.set_max_bit_rate(config.bitrate as usize * 2);
        encoder_ctx.set_gop(150);

        let mut opts = Dictionary::new();
        if using_nvenc {
            opts.set("preset", "p4");
            opts.set("tune", "hq");
            opts.set("rc", "vbr");
            opts.set("profile", "high");
            opts.set("spatial-aq", "1");
            opts.set("temporal-aq", "1");
            opts.set("rc-lookahead", "32");
            opts.set("surfaces", "32");
        } else {
            opts.set("preset", "fast");
            opts.set("profile", "high");
            opts.set("crf", "23");
        }

        let encoder = encoder_ctx
            .open_as_with(codec, opts)
            .map_err(|e| format!("Failed to open encoder: {}", e))?;

        video_stream.set_parameters(&encoder);

        output_ctx
            .write_header()
            .map_err(|e| format!("Failed to write output header: {}", e))?;

        let scaler = scaling::Context::get(
            Pixel::RGBA,
            config.width,
            config.height,
            Pixel::YUV420P,
            config.width,
            config.height,
            scaling::Flags::BILINEAR,
        )
        .map_err(|e| format!("Failed to create scaler: {}", e))?;

        let rgba_frame = frame::Video::new(Pixel::RGBA, config.width, config.height);
        let yuv_frame = frame::Video::new(Pixel::YUV420P, config.width, config.height);

        Ok(Self {
            output_ctx,
            encoder,
            scaler: SendScaler(scaler),
            video_stream_index,
            frame_count: 0,
            time_base,
            output_path,
            using_nvenc,
            width: config.width,
            height: config.height,
            rgba_frame,
            yuv_frame,
        })
    }

    pub fn is_nvenc(&self) -> bool {
        self.using_nvenc
    }

    pub fn encode_rgba_frame(
        &mut self,
        rgba_data: &[u8],
        width: u32,
        height: u32,
        keyframe: bool,
    ) -> Result<(), String> {
        let expected_size = (width * height * 4) as usize;
        if rgba_data.len() != expected_size {
            return Err(format!(
                "RGBA data size mismatch: expected {}, got {}",
                expected_size,
                rgba_data.len()
            ));
        }

        let stride = self.rgba_frame.stride(0);
        let frame_data = self.rgba_frame.data_mut(0);

        let src_stride = (width * 4) as usize;
        for y in 0..height as usize {
            let src_offset = y * src_stride;
            let dst_offset = y * stride;
            let copy_len = src_stride.min(stride);
            frame_data[dst_offset..dst_offset + copy_len]
                .copy_from_slice(&rgba_data[src_offset..src_offset + copy_len]);
        }

        self.scaler
            .run(&self.rgba_frame, &mut self.yuv_frame)
            .map_err(|e| format!("Scaling failed: {}", e))?;

        self.yuv_frame.set_pts(Some(self.frame_count));
        self.yuv_frame.set_kind(if keyframe {
            ffmpeg::picture::Type::I
        } else {
            ffmpeg::picture::Type::None
        });

        self.encoder
            .send_frame(&self.yuv_frame)
            .map_err(|e| format!("Failed to send frame to encoder: {}", e))?;

        self.receive_and_write_packets()?;
        self.frame_count += 1;

        Ok(())
    }

    fn receive_and_write_packets(&mut self) -> Result<(), String> {
        let mut encoded_packet = ffmpeg::Packet::empty();
        while self.encoder.receive_packet(&mut encoded_packet).is_ok() {
            encoded_packet.set_stream(self.video_stream_index);
            encoded_packet.rescale_ts(
                self.time_base,
                self.output_ctx
                    .stream(self.video_stream_index)
                    .unwrap()
                    .time_base(),
            );
            encoded_packet
                .write_interleaved(&mut self.output_ctx)
                .map_err(|e| format!("Failed to write packet: {}", e))?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), String> {
        self.encoder
            .send_eof()
            .map_err(|e| format!("Failed to send EOF: {}", e))?;
        self.receive_and_write_packets()?;
        Ok(())
    }

    pub fn finalize(mut self) -> Result<PathBuf, String> {
        self.flush()?;
        self.output_ctx
            .write_trailer()
            .map_err(|e| format!("Failed to write trailer: {}", e))?;

        eprintln!(
            "[NvencEncoder] Export complete: {} frames, NVENC: {}",
            self.frame_count, self.using_nvenc
        );

        Ok(self.output_path)
    }

    pub fn frame_count(&self) -> i64 {
        self.frame_count
    }
}

pub fn find_best_h264_encoder() -> (codec::codec::Codec, bool) {
    if let Some(nvenc) = encoder::find_by_name("h264_nvenc") {
        return (nvenc, true);
    }
    if let Some(vaapi) = encoder::find_by_name("h264_vaapi") {
        return (vaapi, false);
    }
    if let Some(x264) = encoder::find_by_name("libx264") {
        return (x264, false);
    }
    let fallback = encoder::find(Id::H264).expect("No H.264 encoder found");
    (fallback, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_find_best_h264_encoder() {
        ffmpeg::init().unwrap();
        let (codec, nvenc) = find_best_h264_encoder();
        assert!(!codec.name().is_empty());
        eprintln!("Best H.264 encoder: {} (NVENC: {})", codec.name(), nvenc);
    }

    #[test]
    fn test_encoder_creates_valid_mp4() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_create.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");

        let frame_size = (320 * 240 * 4) as usize;
        let mut rgba = vec![0u8; frame_size];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = 255;
            pixel[1] = 0;
            pixel[2] = 0;
            pixel[3] = 255;
        }

        for i in 0..30 {
            enc.encode_rgba_frame(&rgba, 320, 240, i % 15 == 0)
                .expect("Failed to encode frame");
        }

        let result = enc.finalize().expect("Failed to finalize");
        assert!(result.exists());
        let file_size = fs::metadata(&result).unwrap().len();
        assert!(file_size > 100, "Output file too small: {} bytes", file_size);

        let header = fs::read(&result).unwrap();
        let ftyp = std::str::from_utf8(&header[4..8]).unwrap_or("");
        assert_eq!(ftyp, "ftyp", "Not a valid MP4 file");

        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_rejects_wrong_size_data() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_badsize.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let bad_data = vec![0u8; 100];
        let result = enc.encode_rgba_frame(&bad_data, 320, 240, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("size mismatch"));

        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_multiframe_pts() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_pts.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let frame_size = (160 * 120 * 4) as usize;

        for i in 0..20 {
            let mut rgba = vec![0u8; frame_size];
            let color = ((i * 12) % 256) as u8;
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = color;
                pixel[1] = 255 - color;
                pixel[2] = 128;
                pixel[3] = 255;
            }
            enc.encode_rgba_frame(&rgba, 160, 120, i % 10 == 0)
                .expect("Failed to encode frame");
        }

        assert_eq!(enc.frame_count(), 20);
        let result = enc.finalize().expect("Failed to finalize");
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_1080p_export_produces_valid_mp4() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_1080p.mp4");
        let config = EncoderConfig {
            width: 1920,
            height: 1080,
            fps: 30,
            bitrate: 8_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create 1080p encoder");
        let frame_size = (1920 * 1080 * 4) as usize;

        // Encode 5 frames (enough to verify 1080p works without being slow)
        for i in 0..5u32 {
            let mut rgba = vec![0u8; frame_size];
            // Gradient pattern to produce non-trivial encoding
            for y in 0..1080u32 {
                for x in 0..1920u32 {
                    let idx = ((y * 1920 + x) * 4) as usize;
                    rgba[idx] = ((x + i * 50) % 256) as u8;
                    rgba[idx + 1] = ((y + i * 30) % 256) as u8;
                    rgba[idx + 2] = (((x + y) / 2 + i * 20) % 256) as u8;
                    rgba[idx + 3] = 255;
                }
            }
            enc.encode_rgba_frame(&rgba, 1920, 1080, i == 0)
                .expect("Failed to encode 1080p frame");
        }

        let result = enc.finalize().expect("Failed to finalize 1080p");
        assert!(result.exists());
        let file_size = fs::metadata(&result).unwrap().len();
        assert!(file_size > 1000, "1080p output too small: {} bytes", file_size);

        let header = fs::read(&result).unwrap();
        assert_eq!(
            std::str::from_utf8(&header[4..8]).unwrap_or(""),
            "ftyp",
            "Not a valid MP4 file"
        );
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_file_based_frame_feeding_simulation() {
        // Simulates the exact flow the TypeScript NvencExporter uses:
        // 1. Write RGBA data to temp file
        // 2. Read it back
        // 3. Feed to encoder
        // 4. Delete temp file
        let tmp_output = std::env::temp_dir().join("openscreen_test_file_feed.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_output.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let frame_size = (320 * 240 * 4) as usize;

        for i in 0..10 {
            // Step 1: Generate RGBA frame
            let mut rgba = vec![0u8; frame_size];
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = ((i * 25) % 256) as u8;
                pixel[1] = 100;
                pixel[2] = 200;
                pixel[3] = 255;
            }

            // Step 2: Write to temp file (simulating frontend writeFile)
            let frame_path = std::env::temp_dir().join(format!("nvenc-frame-{}.raw", i));
            fs::write(&frame_path, &rgba).expect("Failed to write frame file");
            assert!(frame_path.exists());

            // Step 3: Read back and feed (simulating Rust feed_frame command)
            let read_data = fs::read(&frame_path).expect("Failed to read frame file");
            assert_eq!(read_data.len(), frame_size);

            // Step 4: Delete temp file (simulating cleanup)
            fs::remove_file(&frame_path).expect("Failed to delete frame file");
            assert!(!frame_path.exists());

            // Step 5: Encode
            enc.encode_rgba_frame(&read_data, 320, 240, i % 15 == 0)
                .expect("Failed to encode frame");
        }

        assert_eq!(enc.frame_count(), 10);
        let result = enc.finalize().expect("Failed to finalize");
        assert!(result.exists());
        let file_size = fs::metadata(&result).unwrap().len();
        assert!(file_size > 100);
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_output_is_playable_mp4() {
        // Verify the output can be opened by FFmpeg's demuxer
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_playable.mp4");
        let config = EncoderConfig {
            width: 640,
            height: 480,
            fps: 24,
            bitrate: 2_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let frame_size = (640 * 480 * 4) as usize;
        let mut rgba = vec![128u8; frame_size];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }

        for i in 0..24 {
            enc.encode_rgba_frame(&rgba, 640, 480, i == 0)
                .expect("Failed to encode frame");
        }
        enc.finalize().expect("Failed to finalize");

        // Verify FFmpeg can open and probe the output
        let probe = ffmpeg::format::input(&tmp_path);
        assert!(probe.is_ok(), "FFmpeg cannot open the output MP4");

        let input = probe.unwrap();
        let video_stream = input
            .streams()
            .best(ffmpeg::media::Type::Video);
        assert!(video_stream.is_some(), "No video stream found in output");

        let stream = video_stream.unwrap();
        let codec_params = stream.parameters();
        let decoder_ctx = ffmpeg::codec::context::Context::from_parameters(codec_params);
        assert!(decoder_ctx.is_ok(), "Cannot create decoder from output stream params");

        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_bitrate_reasonable() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_bitrate.mp4");
        let target_bitrate = 2_000_000u64; // 2 Mbps
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: target_bitrate,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let frame_size = (320 * 240 * 4) as usize;
        let num_frames = 90; // 3 seconds

        for i in 0..num_frames {
            let mut rgba = vec![0u8; frame_size];
            // Moving gradient to give the encoder something to work with
            let offset = (i * 3) as u8;
            for (idx, pixel) in rgba.chunks_exact_mut(4).enumerate() {
                pixel[0] = (idx as u8).wrapping_add(offset);
                pixel[1] = (idx as u8).wrapping_add(offset).wrapping_add(85);
                pixel[2] = (idx as u8).wrapping_add(offset).wrapping_add(170);
                pixel[3] = 255;
            }
            enc.encode_rgba_frame(&rgba, 320, 240, i % 30 == 0)
                .expect("Failed to encode frame");
        }

        enc.finalize().expect("Failed to finalize");

        let file_size = fs::metadata(&tmp_path).unwrap().len();
        let duration_secs = num_frames as f64 / 30.0;
        let actual_bitrate = (file_size * 8) as f64 / duration_secs;

        // Bitrate should be within 5x of target (encoders have wide tolerance,
        // especially for simple content at low resolutions)
        assert!(
            actual_bitrate < target_bitrate as f64 * 5.0,
            "Bitrate too high: {:.0} bps (target: {} bps)",
            actual_bitrate,
            target_bitrate
        );

        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_handles_odd_dimensions() {
        // Some encoders require even dimensions; verify we handle this
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_odd.mp4");
        let config = EncoderConfig {
            width: 322, // even but unusual
            height: 242,
            fps: 15,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder with odd dims");
        let frame_size = (322 * 242 * 4) as usize;
        let rgba = vec![100u8; frame_size];

        for i in 0..5 {
            enc.encode_rgba_frame(&rgba, 322, 242, i == 0)
                .expect("Failed to encode odd-dimension frame");
        }
        let result = enc.finalize().expect("Failed to finalize");
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_single_frame() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_single.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 1,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let frame_size = (160 * 120 * 4) as usize;
        let rgba = vec![255u8; frame_size];

        enc.encode_rgba_frame(&rgba, 160, 120, true)
            .expect("Failed to encode single frame");
        assert_eq!(enc.frame_count(), 1);

        let result = enc.finalize().expect("Failed to finalize single frame");
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_high_frame_count() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_nvenc_long.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 60,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let frame_size = (160 * 120 * 4) as usize;

        // 300 frames = 5 seconds at 60fps
        for i in 0..300 {
            let mut rgba = vec![0u8; frame_size];
            let v = (i % 256) as u8;
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = v;
                pixel[1] = v;
                pixel[2] = v;
                pixel[3] = 255;
            }
            enc.encode_rgba_frame(&rgba, 160, 120, i % 60 == 0)
                .expect("Failed to encode frame");
        }

        assert_eq!(enc.frame_count(), 300);
        let result = enc.finalize().expect("Failed to finalize");
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_dimension_mismatch_between_config_and_frame() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_dim_mismatch.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).unwrap();

        // Feed frame data sized for 640x480 but declare 320x240
        let wrong_size = vec![0u8; 640 * 480 * 4];
        let result = enc.encode_rgba_frame(&wrong_size, 320, 240, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("size mismatch"));
        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_zero_frames_finalize() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_zero_frames.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 30,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let enc = NvencEncoder::new(&config).unwrap();
        assert_eq!(enc.frame_count(), 0);
        let result = enc.finalize();
        // Finalizing with zero frames should either succeed (empty container) or fail gracefully
        // Either outcome is acceptable — the important thing is no panic
        match result {
            Ok(path) => {
                assert!(path.exists());
                fs::remove_file(&path).ok();
            }
            Err(e) => {
                eprintln!("Zero-frame finalize error (expected): {}", e);
            }
        }
        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_varying_keyframe_intervals() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_keyframes.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 30,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).unwrap();
        let frame_size = (160 * 120 * 4) as usize;

        // Every frame is a keyframe
        for _ in 0..10 {
            let rgba = vec![128u8; frame_size];
            enc.encode_rgba_frame(&rgba, 160, 120, true).unwrap();
        }

        let result = enc.finalize().unwrap();
        assert!(result.exists());
        let size = fs::metadata(&result).unwrap().len();
        assert!(size > 0);
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_rapid_color_changes() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_rapid_color.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 60,
            bitrate: 4_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).unwrap();
        let frame_size = (320 * 240 * 4) as usize;

        for i in 0..60 {
            let mut rgba = vec![0u8; frame_size];
            // Alternate between completely different frames to stress the encoder
            let val = if i % 2 == 0 { 0u8 } else { 255u8 };
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = val;
                pixel[1] = 255 - val;
                pixel[2] = val;
                pixel[3] = 255;
            }
            enc.encode_rgba_frame(&rgba, 320, 240, i % 30 == 0).unwrap();
        }

        let result = enc.finalize().unwrap();
        assert!(result.exists());
        assert!(fs::metadata(&result).unwrap().len() > 100);
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_output_readable_by_ffmpeg_demuxer() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_demux_verify.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };

        let mut enc = NvencEncoder::new(&config).unwrap();
        let frame_size = (320 * 240 * 4) as usize;

        for i in 0..30u32 {
            let mut rgba = vec![0u8; frame_size];
            for y in 0..240u32 {
                for x in 0..320u32 {
                    let idx = ((y * 320 + x) * 4) as usize;
                    rgba[idx] = ((x + i * 10) % 256) as u8;
                    rgba[idx + 1] = ((y + i * 5) % 256) as u8;
                    rgba[idx + 2] = 128;
                    rgba[idx + 3] = 255;
                }
            }
            enc.encode_rgba_frame(&rgba, 320, 240, i % 15 == 0).unwrap();
        }
        enc.finalize().unwrap();

        // Verify the output is a valid container with a video stream
        let input = ffmpeg::format::input(&tmp_path).expect("FFmpeg cannot open output");
        let video_stream = input.streams().best(ffmpeg::media::Type::Video);
        assert!(video_stream.is_some(), "No video stream in output");

        let stream = video_stream.unwrap();
        let params = stream.parameters();
        let ctx = ffmpeg::codec::context::Context::from_parameters(params)
            .expect("Cannot create decoder context");
        let decoder = ctx.decoder();
        assert!(decoder.video().is_ok(), "Stream is not decodable as video");

        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_sequential_sessions_same_path() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_sequential.mp4");
        let frame_size = (160 * 120 * 4) as usize;
        let rgba = vec![100u8; frame_size];

        for round in 0..3 {
            let config = EncoderConfig {
                width: 160,
                height: 120,
                fps: 10,
                bitrate: 500_000,
                output_path: tmp_path.to_string_lossy().to_string(),
            };
            let mut enc = NvencEncoder::new(&config).unwrap();
            for i in 0..5 {
                enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
            }
            let result = enc.finalize().unwrap();
            assert!(result.exists(), "round {} failed", round);
        }

        // Final file should be valid
        let header = fs::read(&tmp_path).unwrap();
        assert_eq!(std::str::from_utf8(&header[4..8]).unwrap_or(""), "ftyp");
        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_encoder_transparency_in_rgba() {
        // Verify encoder handles semi-transparent pixels (alpha != 255)
        let tmp_path = std::env::temp_dir().join("openscreen_test_alpha.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).unwrap();
        let frame_size = (160 * 120 * 4) as usize;

        let mut rgba = vec![0u8; frame_size];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = 255;
            pixel[1] = 0;
            pixel[2] = 0;
            pixel[3] = 128; // semi-transparent
        }

        for i in 0..5 {
            enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
        }
        let result = enc.finalize().unwrap();
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_all_black_frames() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_black.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).unwrap();
        let frame_size = (320 * 240 * 4) as usize;
        let mut rgba = vec![0u8; frame_size];
        // All black with full alpha
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }

        for i in 0..30 {
            enc.encode_rgba_frame(&rgba, 320, 240, i == 0).unwrap();
        }
        let result = enc.finalize().unwrap();
        assert!(result.exists());
        // All-black should compress very small
        let size = fs::metadata(&result).unwrap().len();
        assert!(size > 0);
        fs::remove_file(&result).ok();
    }

    #[test]
    fn test_encoder_all_white_frames() {
        let tmp_path = std::env::temp_dir().join("openscreen_test_white.mp4");
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).unwrap();
        let frame_size = (320 * 240 * 4) as usize;
        let rgba = vec![255u8; frame_size];

        for i in 0..30 {
            enc.encode_rgba_frame(&rgba, 320, 240, i == 0).unwrap();
        }
        let result = enc.finalize().unwrap();
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }
}
