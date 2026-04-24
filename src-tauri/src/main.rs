#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::platform::get_platform,
            commands::file_io::get_app_data_dir,
            commands::file_io::get_recordings_dir,
            commands::file_io::ensure_recordings_dir,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Ensure recordings directory exists on startup
            let recordings_dir = app_handle
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("recordings");
            std::fs::create_dir_all(&recordings_dir).ok();

            log::info!("OpenScreen started, data dir: {:?}", recordings_dir);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenScreen");
}
