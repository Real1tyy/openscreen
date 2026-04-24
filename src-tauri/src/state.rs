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
