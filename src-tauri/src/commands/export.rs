use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::encoder::{EncoderConfig, NvencEncoder};

#[derive(Default)]
pub struct ExportState {
    pub sessions: HashMap<String, NvencEncoder>,
}

#[derive(Deserialize)]
pub struct NvencExportConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u64,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

#[derive(Serialize)]
pub struct StartExportResult {
    pub success: bool,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "usingNvenc")]
    pub using_nvenc: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct FrameResult {
    pub success: bool,
    #[serde(rename = "frameCount")]
    pub frame_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct FinishExportResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "totalFrames")]
    pub total_frames: i64,
}

#[tauri::command]
pub fn check_nvenc_available() -> bool {
    ffmpeg_next::init().ok();
    ffmpeg_next::encoder::find_by_name("h264_nvenc").is_some()
}

#[tauri::command]
pub fn start_nvenc_export(
    config: NvencExportConfig,
    export_state: tauri::State<'_, Mutex<ExportState>>,
) -> StartExportResult {
    let encoder_config = EncoderConfig {
        width: config.width,
        height: config.height,
        fps: config.fps,
        bitrate: config.bitrate,
        output_path: config.output_path,
    };

    match NvencEncoder::new(&encoder_config) {
        Ok(encoder) => {
            let using_nvenc = encoder.is_nvenc();
            let session_id = uuid::Uuid::new_v4().to_string();
            let mut state = export_state.lock().unwrap();
            state.sessions.insert(session_id.clone(), encoder);
            StartExportResult {
                success: true,
                session_id,
                using_nvenc,
                error: None,
            }
        }
        Err(e) => StartExportResult {
            success: false,
            session_id: String::new(),
            using_nvenc: false,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub fn feed_frame(
    session_id: String,
    frame_path: String,
    width: u32,
    height: u32,
    is_keyframe: bool,
    export_state: tauri::State<'_, Mutex<ExportState>>,
) -> FrameResult {
    let rgba_data = match std::fs::read(&frame_path) {
        Ok(data) => data,
        Err(e) => {
            return FrameResult {
                success: false,
                frame_count: 0,
                error: Some(format!("Failed to read frame file: {}", e)),
            }
        }
    };

    std::fs::remove_file(&frame_path).ok();

    let mut state = export_state.lock().unwrap();
    let encoder = match state.sessions.get_mut(&session_id) {
        Some(enc) => enc,
        None => {
            return FrameResult {
                success: false,
                frame_count: 0,
                error: Some("Invalid session ID".to_string()),
            }
        }
    };

    match encoder.encode_rgba_frame(&rgba_data, width, height, is_keyframe) {
        Ok(()) => FrameResult {
            success: true,
            frame_count: encoder.frame_count(),
            error: None,
        },
        Err(e) => FrameResult {
            success: false,
            frame_count: encoder.frame_count(),
            error: Some(e),
        },
    }
}

#[tauri::command]
pub fn finish_export(
    session_id: String,
    export_state: tauri::State<'_, Mutex<ExportState>>,
) -> FinishExportResult {
    let encoder = {
        let mut state = export_state.lock().unwrap();
        match state.sessions.remove(&session_id) {
            Some(enc) => enc,
            None => {
                return FinishExportResult {
                    success: false,
                    path: None,
                    error: Some("Invalid session ID".to_string()),
                    total_frames: 0,
                }
            }
        }
    };

    let total_frames = encoder.frame_count();

    match encoder.finalize() {
        Ok(path) => FinishExportResult {
            success: true,
            path: Some(path.to_string_lossy().to_string()),
            error: None,
            total_frames,
        },
        Err(e) => FinishExportResult {
            success: false,
            path: None,
            error: Some(e),
            total_frames,
        },
    }
}

#[tauri::command]
pub fn cancel_export(
    session_id: String,
    export_state: tauri::State<'_, Mutex<ExportState>>,
) {
    let mut state = export_state.lock().unwrap();
    state.sessions.remove(&session_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_state() -> Mutex<ExportState> {
        Mutex::new(ExportState::default())
    }

    #[test]
    fn test_export_session_lifecycle() {
        // Simulates the full TypeScript→Rust flow without Tauri runtime
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_export_lifecycle.mp4");

        // 1. Create encoder directly (bypassing tauri::State)
        let config = crate::encoder::EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let encoder = crate::encoder::NvencEncoder::new(&config)
            .expect("Failed to create encoder");
        let session_id = "test-session-1".to_string();

        {
            let mut s = state.lock().unwrap();
            s.sessions.insert(session_id.clone(), encoder);
        }

        // 2. Feed frames via temp files (simulating feed_frame command)
        let frame_size = (320 * 240 * 4) as usize;
        for i in 0..15 {
            let mut rgba = vec![0u8; frame_size];
            let v = ((i * 17) % 256) as u8;
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = v;
                pixel[1] = 128;
                pixel[2] = 255 - v;
                pixel[3] = 255;
            }

            let frame_path = std::env::temp_dir().join(format!("test_feed_{}.raw", i));
            fs::write(&frame_path, &rgba).unwrap();

            let read_data = fs::read(&frame_path).unwrap();
            fs::remove_file(&frame_path).unwrap();

            let mut s = state.lock().unwrap();
            let enc = s.sessions.get_mut(&session_id).unwrap();
            enc.encode_rgba_frame(&read_data, 320, 240, i % 15 == 0).unwrap();
        }

        // 3. Finalize
        let encoder = {
            let mut s = state.lock().unwrap();
            s.sessions.remove(&session_id).unwrap()
        };
        assert_eq!(encoder.frame_count(), 15);
        let result_path = encoder.finalize().expect("Failed to finalize");

        assert!(result_path.exists());
        let file_size = fs::metadata(&result_path).unwrap().len();
        assert!(file_size > 100);

        // Verify it's a valid MP4
        let header = fs::read(&result_path).unwrap();
        assert_eq!(std::str::from_utf8(&header[4..8]).unwrap_or(""), "ftyp");

        fs::remove_file(&result_path).ok();
    }

    #[test]
    fn test_cancel_removes_session() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_cancel.mp4");

        let config = crate::encoder::EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let encoder = crate::encoder::NvencEncoder::new(&config).unwrap();
        let session_id = "cancel-test".to_string();

        {
            let mut s = state.lock().unwrap();
            s.sessions.insert(session_id.clone(), encoder);
            assert!(s.sessions.contains_key(&session_id));
        }

        // Cancel
        {
            let mut s = state.lock().unwrap();
            s.sessions.remove(&session_id);
        }

        let s = state.lock().unwrap();
        assert!(!s.sessions.contains_key(&session_id));
        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_multiple_concurrent_sessions() {
        let state = make_state();

        let sessions: Vec<(String, String)> = (0..3)
            .map(|i| {
                let path = std::env::temp_dir()
                    .join(format!("openscreen_test_concurrent_{}.mp4", i))
                    .to_string_lossy()
                    .to_string();
                (format!("session-{}", i), path)
            })
            .collect();

        // Create all sessions
        for (id, path) in &sessions {
            let config = crate::encoder::EncoderConfig {
                width: 160,
                height: 120,
                fps: 10,
                bitrate: 500_000,
                output_path: path.clone(),
            };
            let encoder = crate::encoder::NvencEncoder::new(&config).unwrap();
            let mut s = state.lock().unwrap();
            s.sessions.insert(id.clone(), encoder);
        }

        {
            let s = state.lock().unwrap();
            assert_eq!(s.sessions.len(), 3);
        }

        // Feed frames to each and finalize
        let frame_size = (160 * 120 * 4) as usize;
        let rgba = vec![128u8; frame_size];

        for (id, _) in &sessions {
            let mut s = state.lock().unwrap();
            let enc = s.sessions.get_mut(id).unwrap();
            for i in 0..5 {
                enc.encode_rgba_frame(&rgba, 160, 120, i == 0).unwrap();
            }
        }

        for (id, _path) in &sessions {
            let encoder = {
                let mut s = state.lock().unwrap();
                s.sessions.remove(id).unwrap()
            };
            let result = encoder.finalize().unwrap();
            assert!(result.exists());
            fs::remove_file(result).ok();
        }

        let s = state.lock().unwrap();
        assert_eq!(s.sessions.len(), 0);
    }

    #[test]
    fn test_check_nvenc_available() {
        let result = check_nvenc_available();
        eprintln!("NVENC available: {}", result);
    }

    #[test]
    fn test_feed_frame_invalid_session_id() {
        let state = make_state();
        let frame_size = (160 * 120 * 4) as usize;
        let frame_path = std::env::temp_dir().join("test_invalid_session_frame.raw");
        fs::write(&frame_path, vec![0u8; frame_size]).unwrap();

        let mut s = state.lock().unwrap();
        // No sessions exist
        let enc = s.sessions.get_mut("nonexistent");
        assert!(enc.is_none());
        fs::remove_file(&frame_path).ok();
    }

    #[test]
    fn test_finish_export_invalid_session_id() {
        let state = make_state();
        let mut s = state.lock().unwrap();
        let removed = s.sessions.remove("nonexistent");
        assert!(removed.is_none());
    }

    #[test]
    fn test_feed_frame_with_wrong_size_data() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_wrong_frame.mp4");

        let config = crate::encoder::EncoderConfig {
            width: 320,
            height: 240,
            fps: 30,
            bitrate: 1_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let encoder = crate::encoder::NvencEncoder::new(&config).unwrap();
        let session_id = "wrong-size-test".to_string();

        {
            let mut s = state.lock().unwrap();
            s.sessions.insert(session_id.clone(), encoder);
        }

        // Write a frame file with wrong dimensions
        let wrong_data = vec![0u8; 100 * 100 * 4]; // 100x100 instead of 320x240
        let frame_path = std::env::temp_dir().join("wrong_size_frame.raw");
        fs::write(&frame_path, &wrong_data).unwrap();
        let read_data = fs::read(&frame_path).unwrap();
        fs::remove_file(&frame_path).ok();

        let mut s = state.lock().unwrap();
        let enc = s.sessions.get_mut(&session_id).unwrap();
        let result = enc.encode_rgba_frame(&read_data, 320, 240, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("size mismatch"));

        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_concurrent_sessions_interleaved_feeding() {
        let state = make_state();
        let frame_size = (160 * 120 * 4) as usize;

        // Create two sessions
        let paths: Vec<_> = (0..2)
            .map(|i| {
                let path = std::env::temp_dir()
                    .join(format!("openscreen_test_interleave_{}.mp4", i));
                let config = crate::encoder::EncoderConfig {
                    width: 160,
                    height: 120,
                    fps: 10,
                    bitrate: 500_000,
                    output_path: path.to_string_lossy().to_string(),
                };
                let encoder = crate::encoder::NvencEncoder::new(&config).unwrap();
                let id = format!("interleave-{}", i);
                state.lock().unwrap().sessions.insert(id.clone(), encoder);
                (id, path)
            })
            .collect();

        // Interleave frame feeding: session-0, session-1, session-0, session-1, ...
        for frame in 0..10 {
            let idx = frame % 2;
            let (ref id, _) = paths[idx];
            let mut rgba = vec![0u8; frame_size];
            let v = (frame * 25) as u8;
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = v;
                pixel[3] = 255;
            }
            let mut s = state.lock().unwrap();
            let enc = s.sessions.get_mut(id).unwrap();
            enc.encode_rgba_frame(&rgba, 160, 120, frame < 2).unwrap();
        }

        // Finalize both
        for (id, _path) in &paths {
            let enc = state.lock().unwrap().sessions.remove(id).unwrap();
            assert_eq!(enc.frame_count(), 5);
            let result = enc.finalize().unwrap();
            assert!(result.exists());
            fs::remove_file(result).ok();
        }
    }

    #[test]
    fn test_start_export_result_serialization() {
        let result = StartExportResult {
            success: true,
            session_id: "abc-123".to_string(),
            using_nvenc: false,
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"sessionId\":\"abc-123\""));
        assert!(json.contains("\"usingNvenc\":false"));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn test_frame_result_serialization() {
        let result = FrameResult {
            success: true,
            frame_count: 42,
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"frameCount\":42"));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn test_finish_export_result_serialization() {
        let result = FinishExportResult {
            success: true,
            path: Some("/tmp/output.mp4".to_string()),
            error: None,
            total_frames: 300,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"totalFrames\":300"));
        assert!(json.contains("\"path\":\"/tmp/output.mp4\""));
    }

    #[test]
    fn test_nvenc_export_config_deserialization() {
        let json = r#"{"width":1920,"height":1080,"fps":60,"bitrate":8000000,"outputPath":"/tmp/out.mp4"}"#;
        let config: NvencExportConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.width, 1920);
        assert_eq!(config.height, 1080);
        assert_eq!(config.fps, 60);
        assert_eq!(config.bitrate, 8_000_000);
        assert_eq!(config.output_path, "/tmp/out.mp4");
    }

    #[test]
    fn test_full_export_pipeline_produces_playable_mp4() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_pipeline_playable.mp4");

        let config = crate::encoder::EncoderConfig {
            width: 640,
            height: 480,
            fps: 30,
            bitrate: 2_000_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let encoder = crate::encoder::NvencEncoder::new(&config).unwrap();
        let session_id = "pipeline-test".to_string();
        state
            .lock()
            .unwrap()
            .sessions
            .insert(session_id.clone(), encoder);

        let frame_size = (640 * 480 * 4) as usize;
        for i in 0..60u32 {
            let mut rgba = vec![0u8; frame_size];
            for y in 0..480u32 {
                for x in 0..640u32 {
                    let idx = ((y * 640 + x) * 4) as usize;
                    rgba[idx] = ((x + i * 10) % 256) as u8;
                    rgba[idx + 1] = ((y + i * 5) % 256) as u8;
                    rgba[idx + 2] = 128;
                    rgba[idx + 3] = 255;
                }
            }

            let frame_path =
                std::env::temp_dir().join(format!("pipeline_frame_{}.raw", i));
            fs::write(&frame_path, &rgba).unwrap();
            let read_data = fs::read(&frame_path).unwrap();
            fs::remove_file(&frame_path).ok();

            let mut s = state.lock().unwrap();
            let enc = s.sessions.get_mut(&session_id).unwrap();
            enc.encode_rgba_frame(&read_data, 640, 480, i % 30 == 0)
                .unwrap();
        }

        let encoder = state.lock().unwrap().sessions.remove(&session_id).unwrap();
        assert_eq!(encoder.frame_count(), 60);
        let result_path = encoder.finalize().unwrap();

        // Verify with FFmpeg demuxer
        ffmpeg_next::init().ok();
        let input =
            ffmpeg_next::format::input(&result_path).expect("Cannot open output");
        let video = input
            .streams()
            .best(ffmpeg_next::media::Type::Video)
            .expect("No video stream");
        let params = video.parameters();
        let ctx = ffmpeg_next::codec::context::Context::from_parameters(params).unwrap();
        assert!(ctx.decoder().video().is_ok());

        fs::remove_file(&result_path).ok();
    }

    #[test]
    fn test_cancel_mid_encoding_cleans_up_session() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_cancel_mid.mp4");

        let config = crate::encoder::EncoderConfig {
            width: 160,
            height: 120,
            fps: 10,
            bitrate: 500_000,
            output_path: tmp_path.to_string_lossy().to_string(),
        };
        let mut encoder = crate::encoder::NvencEncoder::new(&config).unwrap();

        // Feed some frames
        let frame_size = (160 * 120 * 4) as usize;
        let rgba = vec![128u8; frame_size];
        for i in 0..5 {
            encoder
                .encode_rgba_frame(&rgba, 160, 120, i == 0)
                .unwrap();
        }
        assert_eq!(encoder.frame_count(), 5);

        let session_id = "cancel-mid".to_string();
        state
            .lock()
            .unwrap()
            .sessions
            .insert(session_id.clone(), encoder);

        // Cancel (drop the encoder without finalizing)
        state.lock().unwrap().sessions.remove(&session_id);

        assert!(!state.lock().unwrap().sessions.contains_key(&session_id));
        // The partial MP4 may or may not exist on disk (header was written)
        fs::remove_file(&tmp_path).ok();
    }
}
