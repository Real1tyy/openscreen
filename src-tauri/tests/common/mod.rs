use std::path::{Path, PathBuf};

use openscreen::audio_muxer::{SpeedRegion, TrimRegion};
use openscreen::encoder::{EncoderConfig, NvencEncoder};

extern crate ffmpeg_next as ffmpeg;
use ffmpeg::{codec, format, frame, media, Rational};

// ─── RAII temp file (auto-cleanup on drop) ──────────────────────

pub struct TempFile(PathBuf);

impl TempFile {
    pub fn new(name: &str) -> Self {
        Self(std::env::temp_dir().join(name))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        std::fs::remove_file(&self.0).ok();
    }
}

// ─── Region builders ────────────────────────────────────────────

pub fn trim(start_ms: f64, end_ms: f64) -> TrimRegion {
    TrimRegion { start_ms, end_ms }
}

pub fn speed(start_ms: f64, end_ms: f64, speed: f64) -> SpeedRegion {
    SpeedRegion {
        start_ms,
        end_ms,
        speed,
    }
}

// ─── Video-only MP4 builder ─────────────────────────────────────

pub struct VideoOnlyMp4 {
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u64,
    frames: u32,
}

impl Default for VideoOnlyMp4 {
    fn default() -> Self {
        Self {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            frames: 30,
        }
    }
}

impl VideoOnlyMp4 {
    pub fn with_frames(mut self, n: u32) -> Self {
        self.frames = n;
        self
    }

    pub fn with_fps(mut self, fps: u32) -> Self {
        self.fps = fps;
        self
    }

    pub fn with_resolution(mut self, w: u32, h: u32) -> Self {
        self.width = w;
        self.height = h;
        self
    }

    pub fn build(self, output_path: &Path) {
        let config = EncoderConfig {
            width: self.width,
            height: self.height,
            fps: self.fps,
            bitrate: self.bitrate,
            output_path: output_path.to_string_lossy().to_string(),
        };
        let mut enc = NvencEncoder::new(&config).expect("Failed to create encoder");
        let size = (self.width * self.height * 4) as usize;
        let rgba = vec![128u8; size];
        for i in 0..self.frames {
            enc.encode_rgba_frame(&rgba, self.width, self.height, i % 30 == 0)
                .expect("Failed to encode frame");
        }
        enc.finalize().expect("Failed to finalize video-only MP4");
    }

    /// Shortcut: duration in seconds based on frames / fps.
    pub fn duration_secs(&self) -> f64 {
        self.frames as f64 / self.fps as f64
    }
}

// ─── Source MP4 with audio builder ──────────────────────────────

pub struct SourceMp4 {
    width: u32,
    height: u32,
    fps: u32,
    sample_rate: u32,
    duration_secs: f64,
}

impl Default for SourceMp4 {
    fn default() -> Self {
        Self {
            width: 160,
            height: 120,
            fps: 10,
            sample_rate: 44100,
            duration_secs: 3.0,
        }
    }
}

impl SourceMp4 {
    pub fn with_duration(mut self, secs: f64) -> Self {
        self.duration_secs = secs;
        self
    }

    pub fn with_resolution(mut self, w: u32, h: u32) -> Self {
        self.width = w;
        self.height = h;
        self
    }

    pub fn with_fps(mut self, fps: u32) -> Self {
        self.fps = fps;
        self
    }

    /// Create the MP4 file with both video and audio tracks.
    pub fn build(self, path: &Path) {
        ffmpeg::init().expect("FFmpeg init");

        let mut output = format::output(path).expect("Create output");

        // --- video stream ---
        let (vcodec, is_nvenc) = openscreen::encoder::find_best_h264_encoder();
        let mut vstream = output.add_stream(vcodec).expect("Add video stream");
        let video_idx = vstream.index();
        let video_tb = Rational::new(1, self.fps as i32);

        let mut vctx = codec::context::Context::new_with_codec(vcodec)
            .encoder()
            .video()
            .expect("Video encoder ctx");
        vctx.set_width(self.width);
        vctx.set_height(self.height);
        vctx.set_format(ffmpeg::format::Pixel::YUV420P);
        vctx.set_time_base(video_tb);
        vctx.set_frame_rate(Some(Rational::new(self.fps as i32, 1)));
        vctx.set_bit_rate(500_000);
        vctx.set_gop(30);

        let mut vopts = ffmpeg::Dictionary::new();
        if is_nvenc {
            vopts.set("preset", "p1");
        } else {
            vopts.set("preset", "ultrafast");
        }
        let mut venc = vctx.open_as_with(vcodec, vopts).expect("Open video enc");
        vstream.set_parameters(&venc);

        // --- audio stream ---
        let aac = find_aac_encoder();
        let astream = output.add_stream(aac).expect("Add audio stream");
        let audio_idx = astream.index();

        let mut actx = codec::context::Context::new_with_codec(aac)
            .encoder()
            .audio()
            .expect("Audio encoder ctx");
        actx.set_rate(self.sample_rate as i32);
        actx.set_channel_layout(ffmpeg::channel_layout::ChannelLayout::STEREO);
        let audio_fmt = aac
            .audio()
            .ok()
            .and_then(|a| a.formats())
            .and_then(|mut f| f.next())
            .unwrap_or(ffmpeg::format::Sample::F32(
                ffmpeg::format::sample::Type::Planar,
            ));
        actx.set_format(audio_fmt);
        actx.set_bit_rate(128_000);
        actx.set_time_base(Rational::new(1, self.sample_rate as i32));

        let mut aenc = actx.open_as(aac).expect("Open audio enc");
        output
            .stream_mut(audio_idx)
            .unwrap()
            .set_parameters(&aenc);

        output.write_header().expect("Write header");

        let out_video_tb = output.stream(video_idx).unwrap().time_base();
        let out_audio_tb = output.stream(audio_idx).unwrap().time_base();

        // --- encode video ---
        let mut scaler = ffmpeg::software::scaling::Context::get(
            ffmpeg::format::Pixel::RGBA,
            self.width,
            self.height,
            ffmpeg::format::Pixel::YUV420P,
            self.width,
            self.height,
            ffmpeg::software::scaling::Flags::BILINEAR,
        )
        .expect("Scaler");

        let total_vframes = (self.duration_secs * self.fps as f64).ceil() as i64;
        for i in 0..total_vframes {
            let mut rgba = frame::Video::new(ffmpeg::format::Pixel::RGBA, self.width, self.height);
            let stride = rgba.stride(0);
            let data = rgba.data_mut(0);
            let v = ((i * 4) % 256) as u8;
            for y in 0..self.height as usize {
                for x in 0..self.width as usize {
                    let off = y * stride + x * 4;
                    data[off] = v;
                    data[off + 1] = 128;
                    data[off + 2] = 255 - v;
                    data[off + 3] = 255;
                }
            }
            let mut yuv = frame::Video::empty();
            scaler.run(&rgba, &mut yuv).expect("Scale");
            yuv.set_pts(Some(i));
            venc.send_frame(&yuv).expect("Send video frame");
            drain_video_packets(&mut venc, &mut output, video_idx, video_tb, out_video_tb);
        }
        venc.send_eof().ok();
        drain_video_packets(&mut venc, &mut output, video_idx, video_tb, out_video_tb);

        // --- encode audio (silence) ---
        let frame_size = std::cmp::max(aenc.frame_size() as usize, 1024);
        let total_audio_samples = (self.duration_secs * self.sample_rate as f64).ceil() as i64;
        let gen_fmt = ffmpeg::format::Sample::I16(ffmpeg::format::sample::Type::Packed);
        let mut resampler = ffmpeg::software::resampling::Context::get(
            gen_fmt,
            ffmpeg::channel_layout::ChannelLayout::STEREO,
            self.sample_rate,
            audio_fmt,
            ffmpeg::channel_layout::ChannelLayout::STEREO,
            self.sample_rate,
        )
        .expect("Resampler");

        let mut audio_pts: i64 = 0;
        while audio_pts < total_audio_samples {
            let nb = std::cmp::min(frame_size, (total_audio_samples - audio_pts) as usize);
            let mut src = frame::Audio::new(
                gen_fmt,
                nb,
                ffmpeg::channel_layout::ChannelLayout::STEREO,
            );
            src.set_pts(Some(audio_pts));
            src.set_rate(self.sample_rate);
            for b in src.data_mut(0).iter_mut() {
                *b = 0;
            }
            let mut resampled = frame::Audio::empty();
            resampler.run(&src, &mut resampled).expect("Resample");
            resampled.set_pts(Some(audio_pts));
            aenc.send_frame(&resampled).expect("Send audio frame");
            drain_audio_packets(
                &mut aenc,
                &mut output,
                audio_idx,
                self.sample_rate,
                out_audio_tb,
            );
            audio_pts += nb as i64;
        }
        aenc.send_eof().ok();
        drain_audio_packets(
            &mut aenc,
            &mut output,
            audio_idx,
            self.sample_rate,
            out_audio_tb,
        );

        output.write_trailer().expect("Write trailer");
    }
}

// ─── Assertions ─────────────────────────────────────────────────

pub fn assert_has_video(path: &Path) {
    let input = format::input(path).unwrap_or_else(|e| panic!("Cannot open {}: {}", path.display(), e));
    assert!(
        input.streams().best(media::Type::Video).is_some(),
        "Expected video stream in {}",
        path.display()
    );
}

pub fn assert_has_audio(path: &Path) {
    let input = format::input(path).unwrap_or_else(|e| panic!("Cannot open {}: {}", path.display(), e));
    assert!(
        input.streams().best(media::Type::Audio).is_some(),
        "Expected audio stream in {}",
        path.display()
    );
}

pub fn assert_no_audio(path: &Path) {
    let input = format::input(path).unwrap_or_else(|e| panic!("Cannot open {}: {}", path.display(), e));
    assert!(
        input.streams().best(media::Type::Audio).is_none(),
        "Expected NO audio stream in {}",
        path.display()
    );
}

pub fn assert_valid_mp4(path: &Path) {
    let header = std::fs::read(path).unwrap_or_else(|e| panic!("Cannot read {}: {}", path.display(), e));
    assert!(header.len() > 8, "File too small to be MP4: {}", path.display());
    assert_eq!(
        std::str::from_utf8(&header[4..8]).unwrap_or(""),
        "ftyp",
        "Not a valid MP4: {}",
        path.display()
    );
}

pub fn assert_duration_approx(path: &Path, expected_secs: f64, tolerance_secs: f64) {
    let input = format::input(path).unwrap_or_else(|e| panic!("Cannot open {}: {}", path.display(), e));
    let dur = input.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;
    assert!(
        (dur - expected_secs).abs() <= tolerance_secs,
        "Duration {:.2}s not within {:.2}s of expected {:.2}s (file: {})",
        dur,
        tolerance_secs,
        expected_secs,
        path.display()
    );
}

pub fn assert_decodable(path: &Path) {
    let input = format::input(path).expect("Cannot open file");

    if let Some(vs) = input.streams().best(media::Type::Video) {
        let ctx = codec::context::Context::from_parameters(vs.parameters()).expect("Video params");
        assert!(ctx.decoder().video().is_ok(), "Video not decodable");
    }

    if let Some(aus) = input.streams().best(media::Type::Audio) {
        let ctx = codec::context::Context::from_parameters(aus.parameters()).expect("Audio params");
        assert!(ctx.decoder().audio().is_ok(), "Audio not decodable");
    }
}

// ─── Internal helpers ───────────────────────────────────────────

fn find_aac_encoder() -> codec::codec::Codec {
    ffmpeg::encoder::find_by_name("aac")
        .or_else(|| ffmpeg::encoder::find_by_name("libfdk_aac"))
        .or_else(|| ffmpeg::encoder::find(codec::Id::AAC))
        .expect("No AAC encoder")
}

fn drain_video_packets(
    enc: &mut codec::encoder::video::Encoder,
    output: &mut format::context::Output,
    stream_idx: usize,
    enc_tb: Rational,
    out_tb: Rational,
) {
    let mut pkt = ffmpeg::Packet::empty();
    while enc.receive_packet(&mut pkt).is_ok() {
        pkt.set_stream(stream_idx);
        pkt.rescale_ts(enc_tb, out_tb);
        pkt.write_interleaved(output).ok();
    }
}

fn drain_audio_packets(
    enc: &mut codec::encoder::audio::Encoder,
    output: &mut format::context::Output,
    stream_idx: usize,
    sample_rate: u32,
    out_tb: Rational,
) {
    let mut pkt = ffmpeg::Packet::empty();
    while enc.receive_packet(&mut pkt).is_ok() {
        pkt.set_stream(stream_idx);
        pkt.rescale_ts(Rational::new(1, sample_rate as i32), out_tb);
        pkt.write_interleaved(output).ok();
    }
}
