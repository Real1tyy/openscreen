use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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
