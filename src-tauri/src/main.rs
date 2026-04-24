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
            // Platform
            commands::platform::get_platform,
            commands::platform::request_camera_access,
            // File I/O
            commands::file_io::get_app_data_dir,
            commands::file_io::get_recordings_dir,
            commands::file_io::ensure_recordings_dir,
            commands::file_io::read_binary_file,
            commands::file_io::store_recorded_session,
            commands::file_io::set_current_recording_session,
            commands::file_io::get_current_recording_session,
            commands::file_io::set_current_video_path,
            commands::file_io::get_current_video_path,
            commands::file_io::clear_current_video_path,
            commands::file_io::get_recorded_video_path,
            commands::file_io::save_exported_video,
            commands::file_io::open_video_file_picker,
            commands::file_io::save_project_file,
            commands::file_io::load_project_file,
            commands::file_io::load_current_project_file,
            commands::file_io::get_cursor_telemetry,
            commands::file_io::get_shortcuts,
            commands::file_io::save_shortcuts,
            commands::file_io::write_text_file,
            commands::file_io::reveal_in_folder,
            // Windows
            commands::windows::switch_to_editor,
            commands::windows::switch_to_hud,
            commands::windows::start_new_recording,
            commands::windows::open_source_selector,
            commands::windows::select_source,
            commands::windows::get_selected_source,
            commands::windows::hud_overlay_hide,
            commands::windows::hud_overlay_close,
            commands::windows::set_has_unsaved_changes,
            commands::windows::open_external_url,
            commands::windows::set_locale,
            commands::windows::get_asset_base_path,
            // CLI
            commands::cli::get_cli_input_file,
            commands::cli::get_cli_editor_config,
            commands::cli::get_headless_export_config,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

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
