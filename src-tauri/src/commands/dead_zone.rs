use crate::dead_zone::{self, DetectionConfig, DetectionResult};
use crate::state::AppState;
use std::sync::Mutex;

#[tauri::command]
pub fn detect_dead_zones(
    video_path: Option<String>,
    config: DetectionConfig,
    app_state: tauri::State<'_, Mutex<AppState>>,
) -> Result<DetectionResult, String> {
    let path = video_path
        .or_else(|| {
            let state = app_state.lock().unwrap();
            state
                .current_session
                .as_ref()
                .map(|s| s.screen_video_path.clone())
                .or_else(|| state.current_video_path.clone())
        })
        .ok_or("No video path provided and no video loaded")?;

    dead_zone::detect(&path, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_deserialize() {
        let json = r#"{
            "silenceThresholdDb": -30.0,
            "silenceMinDurationMs": 500.0,
            "freezeNoiseThreshold": 0.003,
            "freezeMinDurationMs": 500.0,
            "minDeadZoneMs": 1000.0
        }"#;
        let config: DetectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.silence_threshold_db, -30.0);
    }
}
