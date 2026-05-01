use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::audio_muxer::{self, SpeedRegion, TrimRegion};
use crate::encoder::EncoderConfig;
use crate::pipeline::PipelinedEncoder;
use crate::state::AppState;

/// Resolves the source video path for audio muxing from the current app state.
/// Returns the screen_video_path from the active recording session.
pub fn resolve_source_video_path(app_state: &AppState) -> Option<String> {
    app_state
        .current_session
        .as_ref()
        .map(|s| s.screen_video_path.clone())
}

#[derive(Default)]
pub struct ExportState {
    pub sessions: HashMap<String, PipelinedEncoder>,
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

    match PipelinedEncoder::new(encoder_config) {
        Ok(pipeline) => {
            let using_nvenc = pipeline.is_nvenc();
            let session_id = uuid::Uuid::new_v4().to_string();
            let mut state = export_state.lock().unwrap();
            state.sessions.insert(session_id.clone(), pipeline);
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

    let state = export_state.lock().unwrap();
    let pipeline = match state.sessions.get(&session_id) {
        Some(p) => p,
        None => {
            return FrameResult {
                success: false,
                frame_count: 0,
                error: Some("Invalid session ID".to_string()),
            }
        }
    };

    match pipeline.send_frame(rgba_data, width, height, is_keyframe) {
        Ok(count) => FrameResult {
            success: true,
            frame_count: count,
            error: None,
        },
        Err(e) => FrameResult {
            success: false,
            frame_count: pipeline.frame_count(),
            error: Some(e),
        },
    }
}


#[tauri::command]
pub fn finish_export(
    session_id: String,
    trim_regions: Option<Vec<TrimRegion>>,
    speed_regions: Option<Vec<SpeedRegion>>,
    export_state: tauri::State<'_, Mutex<ExportState>>,
    app_state: tauri::State<'_, Mutex<AppState>>,
) -> FinishExportResult {
    let pipeline = {
        let mut state = export_state.lock().unwrap();
        match state.sessions.remove(&session_id) {
            Some(p) => p,
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

    let total_frames = pipeline.frame_count();

    let video_only_path = match pipeline.finalize() {
        Ok(path) => path,
        Err(e) => {
            return FinishExportResult {
                success: false,
                path: None,
                error: Some(e),
                total_frames,
            }
        }
    };

    // Get source video path from app state for audio muxing.
    // set_current_video_path stores the path in current_session.screen_video_path.
    let source_path = resolve_source_video_path(&app_state.lock().unwrap());

    eprintln!(
        "[finish_export] source_path for audio muxing: {:?}",
        source_path
    );

    if let Some(ref source) = source_path {
        let final_path = video_only_path.with_extension("final.mp4");
        let trims = trim_regions.unwrap_or_default();
        let speeds = speed_regions.unwrap_or_default();

        match audio_muxer::mux_audio_into_video(
            &video_only_path,
            source,
            &trims,
            &speeds,
            &final_path,
        ) {
            Ok(()) => {
                if video_only_path.exists() {
                    std::fs::remove_file(&video_only_path).ok();
                }
                FinishExportResult {
                    success: true,
                    path: Some(final_path.to_string_lossy().to_string()),
                    error: None,
                    total_frames,
                }
            }
            Err(e) => {
                eprintln!("[finish_export] Audio muxing failed: {}", e);
                FinishExportResult {
                    success: true,
                    path: Some(video_only_path.to_string_lossy().to_string()),
                    error: Some(format!("Video exported but audio muxing failed: {}", e)),
                    total_frames,
                }
            }
        }
    } else {
        eprintln!("[finish_export] No source video path in app state — skipping audio mux");
        FinishExportResult {
            success: true,
            path: Some(video_only_path.to_string_lossy().to_string()),
            error: None,
            total_frames,
        }
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

#[tauri::command]
pub fn get_frame_temp_dir() -> String {
    let mut dir = std::env::temp_dir().to_string_lossy().to_string();
    if !dir.ends_with('/') && !dir.ends_with('\\') {
        dir.push('/');
    }
    dir
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_state() -> Mutex<ExportState> {
        Mutex::new(ExportState::default())
    }

    fn make_pipeline(path: &std::path::Path, w: u32, h: u32) -> PipelinedEncoder {
        let config = crate::encoder::EncoderConfig {
            width: w,
            height: h,
            fps: 30,
            bitrate: 1_000_000,
            output_path: path.to_string_lossy().to_string(),
        };
        PipelinedEncoder::new(config).unwrap()
    }

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

    #[test]
    fn test_export_session_lifecycle() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_export_lifecycle.mp4");

        let pipeline = make_pipeline(&tmp_path, 320, 240);
        let session_id = "test-session-1".to_string();
        state.lock().unwrap().sessions.insert(session_id.clone(), pipeline);

        for i in 0..15u8 {
            let rgba = make_rgba(320, 240, i.wrapping_mul(17));

            let frame_path = std::env::temp_dir().join(format!("test_feed_{}.raw", i));
            fs::write(&frame_path, &rgba).unwrap();
            let read_data = fs::read(&frame_path).unwrap();
            fs::remove_file(&frame_path).unwrap();

            let s = state.lock().unwrap();
            let p = s.sessions.get(&session_id).unwrap();
            p.send_frame(read_data, 320, 240, i % 15 == 0).unwrap();
        }

        let pipeline = state.lock().unwrap().sessions.remove(&session_id).unwrap();
        let result_path = pipeline.finalize().expect("Failed to finalize");

        assert!(result_path.exists());
        let file_size = fs::metadata(&result_path).unwrap().len();
        assert!(file_size > 100);

        let header = fs::read(&result_path).unwrap();
        assert_eq!(std::str::from_utf8(&header[4..8]).unwrap_or(""), "ftyp");

        fs::remove_file(&result_path).ok();
    }

    #[test]
    fn test_cancel_removes_session() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_cancel.mp4");

        let pipeline = make_pipeline(&tmp_path, 160, 120);
        let session_id = "cancel-test".to_string();

        {
            let mut s = state.lock().unwrap();
            s.sessions.insert(session_id.clone(), pipeline);
            assert!(s.sessions.contains_key(&session_id));
        }

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

        let sessions: Vec<(String, std::path::PathBuf)> = (0..3)
            .map(|i| {
                let path = std::env::temp_dir()
                    .join(format!("openscreen_test_concurrent_{}.mp4", i));
                (format!("session-{}", i), path)
            })
            .collect();

        for (id, path) in &sessions {
            let pipeline = make_pipeline(path, 160, 120);
            state.lock().unwrap().sessions.insert(id.clone(), pipeline);
        }

        {
            let s = state.lock().unwrap();
            assert_eq!(s.sessions.len(), 3);
        }

        let rgba = make_rgba(160, 120, 128);
        for (id, _) in &sessions {
            let s = state.lock().unwrap();
            let p = s.sessions.get(id).unwrap();
            for i in 0..5 {
                p.send_frame(rgba.clone(), 160, 120, i == 0).unwrap();
            }
        }

        for (id, _path) in &sessions {
            let pipeline = state.lock().unwrap().sessions.remove(id).unwrap();
            let result = pipeline.finalize().unwrap();
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
        let s = state.lock().unwrap();
        assert!(s.sessions.get("nonexistent").is_none());
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

        let pipeline = make_pipeline(&tmp_path, 320, 240);
        let session_id = "wrong-size-test".to_string();
        state.lock().unwrap().sessions.insert(session_id.clone(), pipeline);

        let wrong_data = vec![0u8; 100 * 100 * 4];

        let s = state.lock().unwrap();
        let p = s.sessions.get(&session_id).unwrap();
        p.send_frame(wrong_data, 320, 240, true).ok();
        drop(s);

        // Error surfaces asynchronously — wait briefly then check
        std::thread::sleep(std::time::Duration::from_millis(50));
        let s = state.lock().unwrap();
        let p = s.sessions.get(&session_id).unwrap();
        let result = p.send_frame(vec![0u8; 100], 320, 240, false);
        assert!(result.is_err());

        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_concurrent_sessions_interleaved_feeding() {
        let state = make_state();

        let paths: Vec<_> = (0..2)
            .map(|i| {
                let path = std::env::temp_dir()
                    .join(format!("openscreen_test_interleave_{}.mp4", i));
                let pipeline = make_pipeline(&path, 160, 120);
                let id = format!("interleave-{}", i);
                state.lock().unwrap().sessions.insert(id.clone(), pipeline);
                (id, path)
            })
            .collect();

        for frame in 0..10usize {
            let idx = frame % 2;
            let (ref id, _) = paths[idx];
            let rgba = make_rgba(160, 120, (frame * 25) as u8);
            let s = state.lock().unwrap();
            let p = s.sessions.get(id).unwrap();
            p.send_frame(rgba, 160, 120, frame < 2).unwrap();
        }

        for (id, _path) in &paths {
            let pipeline = state.lock().unwrap().sessions.remove(id).unwrap();
            let result = pipeline.finalize().unwrap();
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
        let pipeline = PipelinedEncoder::new(config).unwrap();
        let session_id = "pipeline-test".to_string();
        state.lock().unwrap().sessions.insert(session_id.clone(), pipeline);

        for i in 0..60u32 {
            let mut rgba = vec![0u8; (640 * 480 * 4) as usize];
            for y in 0..480u32 {
                for x in 0..640u32 {
                    let idx = ((y * 640 + x) * 4) as usize;
                    rgba[idx] = ((x + i * 10) % 256) as u8;
                    rgba[idx + 1] = ((y + i * 5) % 256) as u8;
                    rgba[idx + 2] = 128;
                    rgba[idx + 3] = 255;
                }
            }

            let frame_path = std::env::temp_dir().join(format!("pipeline_frame_{}.raw", i));
            fs::write(&frame_path, &rgba).unwrap();
            let read_data = fs::read(&frame_path).unwrap();
            fs::remove_file(&frame_path).ok();

            let s = state.lock().unwrap();
            let p = s.sessions.get(&session_id).unwrap();
            p.send_frame(read_data, 640, 480, i % 30 == 0).unwrap();
        }

        let pipeline = state.lock().unwrap().sessions.remove(&session_id).unwrap();
        let result_path = pipeline.finalize().unwrap();

        ffmpeg_next::init().ok();
        let input = ffmpeg_next::format::input(&result_path).expect("Cannot open output");
        let video = input.streams().best(ffmpeg_next::media::Type::Video).expect("No video stream");
        let params = video.parameters();
        let ctx = ffmpeg_next::codec::context::Context::from_parameters(params).unwrap();
        assert!(ctx.decoder().video().is_ok());

        fs::remove_file(&result_path).ok();
    }

    #[test]
    fn test_cancel_mid_encoding_cleans_up_session() {
        let state = make_state();
        let tmp_path = std::env::temp_dir().join("openscreen_test_cancel_mid.mp4");

        let pipeline = make_pipeline(&tmp_path, 160, 120);
        let rgba = make_rgba(160, 120, 128);
        for i in 0..5 {
            pipeline.send_frame(rgba.clone(), 160, 120, i == 0).unwrap();
        }

        let session_id = "cancel-mid".to_string();
        state.lock().unwrap().sessions.insert(session_id.clone(), pipeline);

        state.lock().unwrap().sessions.remove(&session_id);
        assert!(!state.lock().unwrap().sessions.contains_key(&session_id));
        fs::remove_file(&tmp_path).ok();
    }

    #[test]
    fn test_get_frame_temp_dir_returns_valid_path() {
        let dir = get_frame_temp_dir();
        assert!(!dir.is_empty());
        assert!(dir.ends_with('/') || dir.ends_with('\\'));
        let p = std::path::Path::new(&dir);
        assert!(p.exists(), "Temp dir does not exist: {}", dir);
    }

    #[test]
    fn test_resolve_source_path_from_session() {
        let mut state = AppState::default();
        assert!(
            resolve_source_video_path(&state).is_none(),
            "Empty state should return None"
        );

        state.current_session = Some(crate::state::RecordingSession {
            screen_video_path: "/tmp/recording.mp4".to_string(),
            webcam_video_path: None,
            created_at: 0.0,
        });

        let path = resolve_source_video_path(&state);
        assert_eq!(
            path.as_deref(),
            Some("/tmp/recording.mp4"),
            "Must read from current_session.screen_video_path"
        );
    }

    #[test]
    fn test_resolve_source_path_ignores_stale_field() {
        let mut state = AppState::default();
        // The old current_video_path field should NOT be used
        state.current_video_path = Some("/tmp/stale.mp4".to_string());

        assert!(
            resolve_source_video_path(&state).is_none(),
            "Must NOT read from the stale current_video_path field"
        );

        // Only current_session matters
        state.current_session = Some(crate::state::RecordingSession {
            screen_video_path: "/tmp/correct.mp4".to_string(),
            webcam_video_path: None,
            created_at: 0.0,
        });

        let path = resolve_source_video_path(&state);
        assert_eq!(
            path.as_deref(),
            Some("/tmp/correct.mp4"),
            "Must use current_session, not current_video_path"
        );
    }

    #[test]
    fn test_resolve_source_path_matches_set_current_video_path() {
        // Simulates what set_current_video_path does: sets current_session
        let mut state = AppState::default();
        let video_path = "/home/user/Videos/screen-recording.mp4".to_string();

        state.current_session = Some(crate::state::RecordingSession {
            screen_video_path: video_path.clone(),
            webcam_video_path: None,
            created_at: 1700000000.0,
        });

        // resolve_source_video_path must return the same path
        assert_eq!(
            resolve_source_video_path(&state),
            Some(video_path),
            "resolve must return what set_current_video_path stored"
        );
    }
}
