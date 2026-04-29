#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use openscreen::commands;
use openscreen::commands::export::ExportState;
use openscreen::state::AppState;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(ExportState::default()))
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
            commands::file_io::store_recorded_session_from_files,
            commands::file_io::save_exported_video_from_file,
            commands::file_io::read_binary_file_to_temp,
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
            commands::windows::set_recording_state,
            // CLI
            commands::cli::get_cli_input_file,
            commands::cli::get_cli_editor_config,
            commands::cli::get_headless_export_config,
            // NVENC Export
            commands::export::check_nvenc_available,
            commands::export::start_nvenc_export,
            commands::export::feed_frame,
            commands::export::finish_export,
            commands::export::cancel_export,
            commands::export::get_frame_temp_dir,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Ensure recordings directory
            let recordings_dir = app_handle
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("recordings");
            std::fs::create_dir_all(&recordings_dir).ok();

            // Always log startup info to stderr
            eprintln!("[OpenScreen] Data dir: {:?}", recordings_dir);
            eprintln!("[OpenScreen] Args: {:?}", std::env::args().collect::<Vec<_>>());

            // Parse CLI arguments
            commands::cli::parse_cli_args(&app_handle);

            // Log parsed CLI state
            {
                let state = app_handle.state::<Mutex<AppState>>();
                let app_state = state.lock().unwrap();
                eprintln!("[OpenScreen] CLI input file: {:?}",
                    commands::cli::get_cli_input_file());
                eprintln!("[OpenScreen] Approved paths: {:?}", app_state.approved_paths);
            }

            // Devtools available in all builds (devtools Cargo feature enabled).
            // Open automatically when OPENSCREEN_DEVTOOLS=1 is set.
            if std::env::var("OPENSCREEN_DEVTOOLS").unwrap_or_default() == "1" {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.open_devtools();
                }
            }

            // Build application menu
            setup_app_menu(app)?;

            // Build system tray
            setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let label = window.label();
                if label == "editor" {
                    // Emit event to frontend to check for unsaved changes
                    window.emit("request-save-before-close", ()).ok();
                    // Don't prevent close — let the frontend decide via a command
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenScreen")
        .run(|_app_handle, _event| {
        });
}

fn setup_app_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let is_mac = cfg!(target_os = "macos");
    let mod_key = if is_mac { "Cmd" } else { "Ctrl" };

    let open_video = MenuItemBuilder::with_id("open-video", "Open Video...")
        .build(app)?;
    let load_project = MenuItemBuilder::with_id("load-project", "Open Project...")
        .accelerator(format!("{}+O", mod_key))
        .build(app)?;
    let save_project = MenuItemBuilder::with_id("save-project", "Save Project")
        .accelerator(format!("{}+S", mod_key))
        .build(app)?;
    let save_project_as = MenuItemBuilder::with_id("save-project-as", "Save Project As...")
        .accelerator(format!("{}+Shift+S", mod_key))
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_video)
        .item(&load_project)
        .item(&save_project)
        .item(&save_project_as)
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let preferences_item = MenuItemBuilder::with_id("preferences", "Preferences...")
        .accelerator(format!("{}+,", mod_key))
        .build(app)?;
    let fullscreen_item = MenuItemBuilder::with_id("toggle-fullscreen", "Toggle Fullscreen")
        .accelerator("F11")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&preferences_item)
        .separator()
        .item(&fullscreen_item)
        .build()?;

    let minimize_item = MenuItemBuilder::with_id("minimize-window", "Minimize")
        .build(app)?;
    let close_item = MenuItemBuilder::with_id("close-window", "Close Window")
        .accelerator(format!("{}+W", mod_key))
        .build(app)?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&minimize_item)
        .item(&close_item)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        match event.id().as_ref() {
            "open-video" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.emit("menu-open-video", ()).ok();
                }
            }
            "load-project" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.emit("menu-load-project", ()).ok();
                }
            }
            "save-project" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.emit("menu-save-project", ()).ok();
                }
            }
            "save-project-as" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.emit("menu-save-project-as", ()).ok();
                }
            }
            "preferences" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.emit("menu-preferences", ()).ok();
                }
            }
            "toggle-fullscreen" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    let is_fullscreen = editor.is_fullscreen().unwrap_or(false);
                    editor.set_fullscreen(!is_fullscreen).ok();
                }
            }
            "minimize-window" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.minimize().ok();
                }
            }
            "close-window" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.close().ok();
                }
            }
            _ => {}
        }
    });

    Ok(())
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItemBuilder::with_id("tray-open", "Open").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray-quit", "Quit").build(app)?;

    let tray_menu = MenuBuilder::new(app)
        .item(&open_item)
        .separator()
        .item(&quit_item)
        .build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("OpenScreen")
        .menu(&tray_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => {
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.unminimize().ok();
                    editor.show().ok();
                    editor.set_focus().ok();
                } else if let Some(hud) = app.get_webview_window("hud-overlay") {
                    hud.show().ok();
                    hud.set_focus().ok();
                }
            }
            "tray-quit" => {
                app.exit(0);
            }
            "tray-stop-recording" => {
                // Emit stop-recording event to the HUD window
                if let Some(hud) = app.get_webview_window("hud-overlay") {
                    hud.emit("stop-recording-from-tray", ()).ok();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(editor) = app.get_webview_window("editor") {
                    editor.unminimize().ok();
                    editor.show().ok();
                    editor.set_focus().ok();
                } else if let Some(hud) = app.get_webview_window("hud-overlay") {
                    hud.show().ok();
                    hud.set_focus().ok();
                }
            }
        })
        .build(app)?;

    Ok(())
}
