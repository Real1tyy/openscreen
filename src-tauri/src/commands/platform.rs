use tauri::AppHandle;

#[tauri::command]
pub fn get_platform() -> String {
    match std::env::consts::OS {
        "macos" => "darwin".to_string(),
        "windows" => "win32".to_string(),
        other => other.to_string(),
    }
}

#[tauri::command]
pub fn request_camera_access(_app: AppHandle) -> serde_json::Value {
    // On macOS, the webview handles camera permissions natively.
    // This stub returns granted; Phase 3 adds native AVCaptureDevice support.
    serde_json::json!({
        "success": true,
        "granted": true,
        "status": "granted"
    })
}
