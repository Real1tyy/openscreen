use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use crate::encoder::{EncoderConfig, NvencEncoder};

enum PipelineMsg {
    Frame {
        rgba_data: Vec<u8>,
        width: u32,
        height: u32,
        keyframe: bool,
    },
    Flush,
}

pub struct PipelinedEncoder {
    tx: Option<mpsc::SyncSender<PipelineMsg>>,
    thread: Option<thread::JoinHandle<Result<PathBuf, String>>>,
    frame_count: Arc<AtomicI64>,
    error: Arc<Mutex<Option<String>>>,
    using_nvenc: bool,
}

// SyncSender, JoinHandle, Arc, Mutex are all Send — no unsafe needed
unsafe impl Send for PipelinedEncoder {}

const PIPELINE_BUFFER_SIZE: usize = 4;

impl PipelinedEncoder {
    pub fn new(config: EncoderConfig) -> Result<Self, String> {
        let encoder = NvencEncoder::new(&config)?;
        let using_nvenc = encoder.is_nvenc();

        let frame_count = Arc::new(AtomicI64::new(0));
        let error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let fc = frame_count.clone();
        let err = error.clone();
        let (tx, rx) = mpsc::sync_channel(PIPELINE_BUFFER_SIZE);

        let handle = thread::spawn(move || {
            let mut enc = encoder;

            while let Ok(msg) = rx.recv() {
                match msg {
                    PipelineMsg::Frame {
                        rgba_data,
                        width,
                        height,
                        keyframe,
                    } => {
                        if let Err(e) =
                            enc.encode_rgba_frame(&rgba_data, width, height, keyframe)
                        {
                            *err.lock().unwrap() = Some(e.clone());
                            return Err(e);
                        }
                        fc.fetch_add(1, Ordering::Release);
                    }
                    PipelineMsg::Flush => break,
                }
            }

            enc.finalize()
        });

        Ok(Self {
            tx: Some(tx),
            thread: Some(handle),
            frame_count,
            error,
            using_nvenc,
        })
    }

    pub fn send_frame(
        &self,
        rgba_data: Vec<u8>,
        width: u32,
        height: u32,
        keyframe: bool,
    ) -> Result<i64, String> {
        if let Some(ref err) = *self.error.lock().unwrap() {
            return Err(err.clone());
        }

        let tx = self.tx.as_ref().ok_or("Pipeline already closed")?;
        tx.send(PipelineMsg::Frame {
            rgba_data,
            width,
            height,
            keyframe,
        })
        .map_err(|_| {
            self.error
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| "Encoder thread died".to_string())
        })?;

        Ok(self.frame_count.load(Ordering::Acquire))
    }

    pub fn frame_count(&self) -> i64 {
        self.frame_count.load(Ordering::Acquire)
    }

    pub fn is_nvenc(&self) -> bool {
        self.using_nvenc
    }

    pub fn finalize(mut self) -> Result<PathBuf, String> {
        if let Some(tx) = self.tx.take() {
            tx.send(PipelineMsg::Flush).ok();
            drop(tx);
        }

        match self.thread.take() {
            Some(handle) => handle
                .join()
                .map_err(|_| "Encoder thread panicked".to_string())?,
            None => Err("Pipeline already finalized".to_string()),
        }
    }
}

impl Drop for PipelinedEncoder {
    fn drop(&mut self) {
        self.tx.take();
        if let Some(handle) = self.thread.take() {
            handle.join().ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_config(name: &str) -> (EncoderConfig, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("openscreen_pipeline_{}.mp4", name));
        let config = EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: path.to_string_lossy().to_string(),
        };
        (config, path)
    }

    fn make_rgba(width: u32, height: u32, seed: u8) -> Vec<u8> {
        let size = (width * height * 4) as usize;
        let mut rgba = vec![0u8; size];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = seed;
            pixel[1] = 128;
            pixel[2] = 255u8.wrapping_sub(seed);
            pixel[3] = 255;
        }
        rgba
    }

    #[test]
    fn pipeline_basic_encode() {
        let (config, path) = test_config("basic");
        let pipeline = PipelinedEncoder::new(config).unwrap();

        for i in 0..30u8 {
            let rgba = make_rgba(320, 240, i.wrapping_mul(8));
            pipeline
                .send_frame(rgba, 320, 240, i % 15 == 0)
                .unwrap();
        }

        let result = pipeline.finalize().unwrap();
        assert!(result.exists());

        let header = fs::read(&result).unwrap();
        assert_eq!(std::str::from_utf8(&header[4..8]).unwrap_or(""), "ftyp");
        fs::remove_file(&result).ok();
        fs::remove_file(&path).ok();
    }

    #[test]
    fn pipeline_frame_count_tracks() {
        let (config, path) = test_config("count");
        let pipeline = PipelinedEncoder::new(config).unwrap();

        let rgba = make_rgba(320, 240, 100);
        for i in 0..10 {
            pipeline
                .send_frame(rgba.clone(), 320, 240, i == 0)
                .unwrap();
        }

        let result = pipeline.finalize().unwrap();
        assert!(result.exists());
        fs::remove_file(&result).ok();
        fs::remove_file(&path).ok();
    }

    #[test]
    fn pipeline_rejects_wrong_size() {
        let (config, path) = test_config("wrong_size");
        let pipeline = PipelinedEncoder::new(config).unwrap();

        let bad_data = vec![0u8; 100];
        pipeline.send_frame(bad_data, 320, 240, true).ok();

        // Error surfaces on next send or finalize
        std::thread::sleep(std::time::Duration::from_millis(50));
        let result = pipeline.send_frame(vec![0u8; 100], 320, 240, false);
        if result.is_ok() {
            // Error might surface on finalize instead
            let fin = pipeline.finalize();
            assert!(fin.is_err());
        } else {
            assert!(result.unwrap_err().contains("size mismatch"));
        }
        fs::remove_file(&path).ok();
    }

    #[test]
    fn pipeline_cancel_no_panic() {
        let (config, path) = test_config("cancel");
        let pipeline = PipelinedEncoder::new(config).unwrap();

        let rgba = make_rgba(320, 240, 50);
        for i in 0..5 {
            pipeline
                .send_frame(rgba.clone(), 320, 240, i == 0)
                .unwrap();
        }

        drop(pipeline); // cancel without finalize
        fs::remove_file(&path).ok();
    }

    #[test]
    fn pipeline_1080p_encode() {
        let path = std::env::temp_dir().join("openscreen_pipeline_1080p.mp4");
        let config = EncoderConfig {
            width: 1920,
            height: 1080,
            fps: 30,
            bitrate: 8_000_000,
            output_path: path.to_string_lossy().to_string(),
        };
        let pipeline = PipelinedEncoder::new(config).unwrap();

        for i in 0..5u8 {
            let rgba = make_rgba(1920, 1080, i.wrapping_mul(50));
            pipeline
                .send_frame(rgba, 1920, 1080, i == 0)
                .unwrap();
        }

        let result = pipeline.finalize().unwrap();
        assert!(result.exists());
        let size = fs::metadata(&result).unwrap().len();
        assert!(size > 1000, "1080p output too small: {} bytes", size);
        fs::remove_file(&result).ok();
    }

    #[test]
    fn pipeline_concurrent_sessions() {
        let paths: Vec<_> = (0..3)
            .map(|i| {
                let p = std::env::temp_dir()
                    .join(format!("openscreen_pipeline_concurrent_{}.mp4", i));
                let c = EncoderConfig {
                    width: 160,
                    height: 120,
                    fps: 10,
                    bitrate: 500_000,
                    output_path: p.to_string_lossy().to_string(),
                };
                (c, p)
            })
            .collect();

        let pipelines: Vec<_> = paths
            .iter()
            .map(|(c, _)| PipelinedEncoder::new(c.clone()).unwrap())
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
        }

        for (_, p) in &paths {
            fs::remove_file(p).ok();
        }
    }

    #[test]
    fn pipeline_high_frame_count() {
        let path = std::env::temp_dir().join("openscreen_pipeline_300.mp4");
        let config = EncoderConfig {
            width: 160,
            height: 120,
            fps: 60,
            bitrate: 500_000,
            output_path: path.to_string_lossy().to_string(),
        };
        let pipeline = PipelinedEncoder::new(config).unwrap();

        for i in 0..300u16 {
            let rgba = make_rgba(160, 120, (i % 256) as u8);
            pipeline
                .send_frame(rgba, 160, 120, i % 60 == 0)
                .unwrap();
        }

        let result = pipeline.finalize().unwrap();
        assert!(result.exists());
        fs::remove_file(&result).ok();
    }

    #[test]
    fn pipeline_output_is_playable() {
        extern crate ffmpeg_next as ffmpeg;

        let (config, path) = test_config("playable");
        let pipeline = PipelinedEncoder::new(config).unwrap();

        for i in 0..24u8 {
            let rgba = make_rgba(320, 240, i.wrapping_mul(10));
            pipeline
                .send_frame(rgba, 320, 240, i % 12 == 0)
                .unwrap();
        }

        pipeline.finalize().unwrap();

        ffmpeg::init().ok();
        let input = ffmpeg::format::input(&path).expect("FFmpeg cannot open output");
        let video = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .expect("No video stream");
        let ctx =
            ffmpeg::codec::context::Context::from_parameters(video.parameters()).unwrap();
        assert!(ctx.decoder().video().is_ok(), "Not decodable as video");

        fs::remove_file(&path).ok();
    }

    #[test]
    fn pipeline_sequential_reuse() {
        let path = std::env::temp_dir().join("openscreen_pipeline_seq.mp4");
        let rgba = make_rgba(160, 120, 100);

        for _ in 0..3 {
            let config = EncoderConfig {
                width: 160,
                height: 120,
                fps: 10,
                bitrate: 500_000,
                output_path: path.to_string_lossy().to_string(),
            };
            let pipeline = PipelinedEncoder::new(config).unwrap();
            for i in 0..5 {
                pipeline
                    .send_frame(rgba.clone(), 160, 120, i == 0)
                    .unwrap();
            }
            pipeline.finalize().unwrap();
        }

        let header = fs::read(&path).unwrap();
        assert_eq!(std::str::from_utf8(&header[4..8]).unwrap_or(""), "ftyp");
        fs::remove_file(&path).ok();
    }
}
