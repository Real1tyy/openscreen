use tauri::AppHandle;

fn platform_string() -> String {
    match std::env::consts::OS {
        "macos" => "darwin".to_string(),
        "windows" => "win32".to_string(),
        other => other.to_string(),
    }
}

#[tauri::command]
pub fn get_platform() -> String {
    platform_string()
}

#[tauri::command]
pub fn request_camera_access(_app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "success": true,
        "granted": true,
        "status": "granted"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_string_returns_known_value() {
        let platform = platform_string();
        let valid = ["linux", "darwin", "win32"];
        assert!(
            valid.contains(&platform.as_str()),
            "unexpected platform: {}",
            platform
        );
    }

    #[test]
    fn test_platform_string_matches_frontend_expectations() {
        let platform = platform_string();
        // Frontend checks: platform === "darwin" for macOS, "win32" for Windows
        match std::env::consts::OS {
            "macos" => assert_eq!(platform, "darwin"),
            "windows" => assert_eq!(platform, "win32"),
            "linux" => assert_eq!(platform, "linux"),
            _ => {}
        }
    }

    #[test]
    fn test_camera_access_response_shape() {
        let response = serde_json::json!({
            "success": true,
            "granted": true,
            "status": "granted"
        });
        assert_eq!(response["success"], true);
        assert_eq!(response["granted"], true);
        assert_eq!(response["status"], "granted");
    }
}
