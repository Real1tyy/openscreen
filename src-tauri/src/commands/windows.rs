use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::file_io::CursorTelemetryPoint;
use crate::state::AppState;

#[derive(Serialize)]
pub struct GenericResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn switch_to_editor(app: AppHandle) -> GenericResult {
    // Close HUD if open
    if let Some(hud) = app.get_webview_window("hud-overlay") {
        hud.close().ok();
    }

    // Create editor window if it doesn't exist
    if app.get_webview_window("editor").is_none() {
        let _editor = WebviewWindowBuilder::new(
            &app,
            "editor",
            WebviewUrl::App("index.html?windowType=editor".into()),
        )
        .title("OpenScreen")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .maximized(true)
        .center()
        .build();
    } else if let Some(editor) = app.get_webview_window("editor") {
        editor.set_focus().ok();
    }

    GenericResult { success: true, error: None }
}

#[tauri::command]
pub fn switch_to_hud(app: AppHandle) -> GenericResult {
    // Close editor if open
    if let Some(editor) = app.get_webview_window("editor") {
        editor.close().ok();
    }

    // Create HUD if it doesn't exist
    if app.get_webview_window("hud-overlay").is_none() {
        let _hud = WebviewWindowBuilder::new(
            &app,
            "hud-overlay",
            WebviewUrl::App("index.html?windowType=hud-overlay".into()),
        )
        .title("OpenScreen")
        .inner_size(600.0, 160.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .build();
    }

    GenericResult { success: true, error: None }
}

#[tauri::command]
pub fn start_new_recording(
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> GenericResult {
    {
        let mut app_state = state.lock().unwrap();
        app_state.current_session = None;
    }
    switch_to_hud(app)
}

#[tauri::command]
pub fn open_source_selector(app: AppHandle) -> GenericResult {
    if let Some(existing) = app.get_webview_window("source-selector") {
        existing.set_focus().ok();
        return GenericResult { success: true, error: None };
    }

    match WebviewWindowBuilder::new(
        &app,
        "source-selector",
        WebviewUrl::App("index.html?windowType=source-selector".into()),
    )
    .title("Select Source")
    .inner_size(620.0, 420.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .center()
    .build()
    {
        Ok(_) => GenericResult { success: true, error: None },
        Err(e) => GenericResult {
            success: false,
            error: Some(e.to_string()),
        },
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ProcessedDesktopSource {
    pub id: String,
    pub name: String,
    pub display_id: String,
    pub thumbnail: Option<String>,
    #[serde(rename = "appIcon")]
    pub app_icon: Option<String>,
}

#[tauri::command]
pub fn select_source(
    source: ProcessedDesktopSource,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Option<ProcessedDesktopSource> {
    {
        let mut app_state = state.lock().unwrap();
        app_state.selected_source_id = Some(source.id.clone());
        app_state.selected_source_name = Some(source.name.clone());
    }

    // Close source selector window
    if let Some(selector) = app.get_webview_window("source-selector") {
        selector.close().ok();
    }

    Some(source)
}

#[tauri::command]
pub fn get_selected_source(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Option<ProcessedDesktopSource> {
    let app_state = state.lock().unwrap();
    match (&app_state.selected_source_id, &app_state.selected_source_name) {
        (Some(id), Some(name)) => Some(ProcessedDesktopSource {
            id: id.clone(),
            name: name.clone(),
            display_id: String::new(),
            thumbnail: None,
            app_icon: None,
        }),
        _ => None,
    }
}

#[tauri::command]
pub fn hud_overlay_hide(app: AppHandle) {
    if let Some(hud) = app.get_webview_window("hud-overlay") {
        hud.minimize().ok();
    }
}

#[tauri::command]
pub fn hud_overlay_close(app: AppHandle) {
    // Close all windows to quit
    for (_, window) in app.webview_windows() {
        window.close().ok();
    }
}

#[tauri::command]
pub fn set_has_unsaved_changes(_has_changes: bool) {
    // In Tauri, the close handler is managed differently.
    // The frontend handles unsaved-changes state directly.
}

#[tauri::command]
pub fn open_external_url(url: String) -> GenericResult {
    match open::that(&url) {
        Ok(_) => GenericResult { success: true, error: None },
        Err(e) => GenericResult {
            success: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn set_locale(_locale: String) {
    // In Tauri, menu/tray text rebuild would happen here.
    // For Phase 1, the frontend manages locale via I18nContext directly.
}

#[tauri::command]
pub fn get_asset_base_path(app: AppHandle) -> Option<String> {
    // In dev mode, assets are served from the Vite dev server
    if cfg!(debug_assertions) {
        return None;
    }

    // In production, resolve from the resource directory
    app.path()
        .resource_dir()
        .ok()
        .map(|p| {
            let asset_path = p.join("assets");
            format!("file://{}/", asset_path.to_string_lossy())
        })
}

#[tauri::command]
pub fn set_recording_state(
    recording: bool,
    app: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) {
    let mut app_state = state.lock().unwrap();
    app_state.is_recording = recording;

    if recording {
        app_state.pending_cursor_samples.clear();
        let start_time = std::time::Instant::now();

        // Spawn cursor capture thread at 10Hz
        let app_clone = app.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));

                let is_still_recording = {
                    let st: tauri::State<'_, Mutex<AppState>> = app_clone.state();
                    let guard = st.lock().unwrap();
                    guard.is_recording
                };
                if !is_still_recording {
                    break;
                }

                let elapsed_ms = start_time.elapsed().as_millis() as f64;
                // Cursor position capture is platform-specific.
                // On Linux/X11 we could use XQueryPointer, on macOS CGEvent.
                // For now, we record timestamps and let the frontend supply positions
                // via the existing browser-based cursor tracking.
                // The samples vector is populated when storeRecordedSession is called
                // with cursor data from the frontend.
                let _ = elapsed_ms;
            }
        });
    } else {
        // Recording stopped — samples are in pending_cursor_samples
        // (populated by storeRecordedSession from frontend data)
    }

    // Update tray menu to show stop option during recording
    update_tray_for_recording(&app, recording, &app_state);
}

fn update_tray_for_recording(app: &AppHandle, recording: bool, state: &AppState) {
    let source_name = state
        .selected_source_name
        .as_deref()
        .unwrap_or("Screen");

    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if recording {
            format!("OpenScreen - Recording {}", source_name)
        } else {
            "OpenScreen".to_string()
        };
        tray.set_tooltip(Some(&tooltip)).ok();
    }
}
