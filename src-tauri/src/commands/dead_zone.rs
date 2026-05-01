use crate::dead_zone::{self, DetectionConfig, DetectionResult};
use crate::state::AppState;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct DeadZoneProgress {
	phase: String,
	percent: f64,
}

#[tauri::command]
pub async fn detect_dead_zones(
	video_path: Option<String>,
	config: DetectionConfig,
	app_state: tauri::State<'_, Mutex<AppState>>,
	app: AppHandle,
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

	let (tx, rx) = std::sync::mpsc::channel();

	let config_clone = config.clone();
	let path_clone = path.clone();
	std::thread::spawn(move || {
		let result = dead_zone::detect(&path_clone, &config_clone, |phase, pct| {
			let _ = app.emit(
				"dead-zone-progress",
				DeadZoneProgress {
					phase: phase.to_string(),
					percent: pct,
				},
			);
		});
		let _ = tx.send(result);
	});

	rx.recv()
		.map_err(|_| "Detection thread disconnected".to_string())?
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
            "minDeadZoneMs": 1000.0,
            "paddingStartMs": 150.0,
            "paddingEndMs": 100.0
        }"#;
		let config: DetectionConfig = serde_json::from_str(json).unwrap();
		assert_eq!(config.silence_threshold_db, -30.0);
		assert_eq!(config.padding_start_ms, 150.0);
		assert_eq!(config.padding_end_ms, 100.0);
	}
}
