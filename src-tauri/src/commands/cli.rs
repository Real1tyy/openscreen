#[tauri::command]
pub fn get_cli_input_file() -> Option<String> {
    // Phase 2: parse CLI args from tauri.conf.json CLI config
    None
}

#[tauri::command]
pub fn get_cli_editor_config() -> Option<serde_json::Value> {
    None
}

#[tauri::command]
pub fn get_headless_export_config() -> Option<serde_json::Value> {
    None
}
