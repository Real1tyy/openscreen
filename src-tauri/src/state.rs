use serde::{Deserialize, Serialize};

use crate::commands::file_io::CursorTelemetryPoint;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct RecordingSession {
    #[serde(rename = "screenVideoPath")]
    pub screen_video_path: String,
    #[serde(rename = "webcamVideoPath", skip_serializing_if = "Option::is_none")]
    pub webcam_video_path: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: f64,
}

#[derive(Debug, Default)]
pub struct AppState {
    pub current_video_path: Option<String>,
    pub current_session: Option<RecordingSession>,
    pub current_project_path: Option<String>,
    pub selected_source_id: Option<String>,
    pub selected_source_name: Option<String>,
    pub is_recording: bool,
    pub approved_paths: Vec<String>,
    pub locale: String,
    pub pending_cursor_samples: Vec<CursorTelemetryPoint>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_default() {
        let state = AppState::default();
        assert!(state.current_session.is_none());
        assert!(state.current_project_path.is_none());
        assert!(!state.is_recording);
        assert!(state.approved_paths.is_empty());
        assert!(state.pending_cursor_samples.is_empty());
    }

    #[test]
    fn test_recording_session_serialization() {
        let session = RecordingSession {
            screen_video_path: "/tmp/screen.webm".to_string(),
            webcam_video_path: Some("/tmp/webcam.webm".to_string()),
            created_at: 1700000000.0,
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("screenVideoPath"));
        assert!(json.contains("webcamVideoPath"));
        assert!(json.contains("createdAt"));

        let deserialized: RecordingSession = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.screen_video_path, "/tmp/screen.webm");
        assert_eq!(deserialized.webcam_video_path.as_deref(), Some("/tmp/webcam.webm"));
    }

    #[test]
    fn test_recording_session_without_webcam() {
        let session = RecordingSession {
            screen_video_path: "/tmp/screen.webm".to_string(),
            webcam_video_path: None,
            created_at: 1700000000.0,
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(!json.contains("webcamVideoPath"));

        let deserialized: RecordingSession = serde_json::from_str(&json).unwrap();
        assert!(deserialized.webcam_video_path.is_none());
    }
}
