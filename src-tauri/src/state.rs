use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct RecordingSession {
    pub screen_video_path: Option<String>,
    pub webcam_video_path: Option<String>,
    pub session_path: Option<String>,
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
}
