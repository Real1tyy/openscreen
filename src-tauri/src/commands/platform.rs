use tauri::AppHandle;

#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub fn request_camera_access(_app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // TODO: Phase 3 — call AVCaptureDevice.requestAccessForMediaType via objc
        Ok("granted".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("granted".to_string())
    }
}
